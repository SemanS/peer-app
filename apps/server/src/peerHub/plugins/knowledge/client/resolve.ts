// @effect-diagnostics nodeBuiltinImport:off - hashes the operation ids kontext uses to tell a repeated request.
/**
 * Acting on a challenge with kontext: the entry as the checkout has it now, a replacement drafted
 * from the challenge's reasons (`drafts.revise`), and staging the replacement (`drafts.stage` with
 * `supersedes`) or the entry's retirement (`drafts.retire`). Each staging has an operation id, so a
 * retry after a failure replays what was staged instead of staging twice. Peer never commits.
 *
 * @module peerHub/plugins/knowledge/client/resolve
 */
import * as NodeCrypto from "node:crypto";

import type { PeerChallengeDraft, PeerKnowledgeChallenge } from "@t3tools/contracts";

import {
  asKnowledge,
  KontextApiError,
  kontextApi,
  type KontextClientShape,
  type KontextEntry,
} from "../../../kontext.ts";
import type { KnowledgeEntry } from "../../../knowledgeEntry.ts";
import { run } from "../../../core/local.ts";
import { reasonsOf } from "./challenges.ts";

/** The operations a challenge's actions need beyond what Peer always pins. */
export const REVISE = "drafts.revise";
export const RETIRE = "drafts.retire";
export const RELATED = "entries.related";

/** What a version of kontext without an operation is told. */
export const needsNewerKontext = (operation: string) =>
  `This needs kontext 0.3.0 or newer here (it has no ${operation}).`;

interface StageResult {
  readonly entry: KontextEntry;
  readonly path: string;
}

/** The entry as kontext reads it in the checkout now; null when the checkout has no such entry. */
export interface CurrentEntry {
  readonly entry: KnowledgeEntry;
  /** kontext's `publication.revision`: what its own conflict check compares. */
  readonly published: string | undefined;
  readonly state: string | undefined;
}

const hash = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

export class ChallengeRefused extends Error {}

export const challengeActions = (client: KontextClientShape, checkout: string) => {
  const api = <A>(operation: string, input: unknown = {}) =>
    kontextApi<A>(client, checkout, operation, input);

  const current = async (id: string): Promise<CurrentEntry | null> => {
    try {
      const { entry } = await api<{ entry: KontextEntry }>("entries.get", { id });
      const publication = entry.publication as
        | { readonly state?: unknown; readonly revision?: unknown }
        | undefined;
      return {
        entry: asKnowledge(entry),
        published: typeof publication?.revision === "string" ? publication.revision : undefined,
        state: typeof publication?.state === "string" ? publication.state : undefined,
      };
    } catch (error) {
      if (error instanceof KontextApiError && error.code === "not_found") return null;
      throw error;
    }
  };

  /**
   * The entry, when it may be acted on: one that changed since it was challenged is refused until
   * the person read it as it is now (`seenRevision`).
   */
  const actionable = async (challenge: PeerKnowledgeChallenge, seenRevision?: string) => {
    const now = await current(challenge.entry);
    if (now === null) throw new ChallengeRefused("This checkout does not have that entry.");
    const challenged = challenge.entryRevision;
    if (
      challenged !== undefined &&
      now.entry.revision !== undefined &&
      challenged !== now.entry.revision &&
      seenRevision !== now.entry.revision
    )
      throw new ChallengeRefused(
        "The entry changed since it was challenged: read it as it is now first.",
      );
    return now;
  };

  /** A write kontext may already have made under this operation id: its result, else null. */
  const replayed = async (operationId: string): Promise<StageResult | null> => {
    try {
      return await api<StageResult>("operations.get", { operation_id: operationId });
    } catch (error) {
      if (!(error instanceof KontextApiError)) throw error;
      if (error.code === "operation_incomplete")
        return api<StageResult>("drafts.stage", { operation_id: operationId });
      if (error.code === "not_found") return null;
      throw error;
    }
  };

  const keptAs = (staged: StageResult) => ({
    path: staged.path,
    title: staged.entry.title,
    kind: staged.entry.kind,
  });

  const objections = (challenge: PeerKnowledgeChallenge) =>
    reasonsOf(challenge)
      .slice(0, 20)
      .map((source) => source.text.slice(0, 300));

  return {
    current,
    actionable,

    /** kontext's draft of a replacement that answers the challenge's reasons; writes nothing. */
    draft: async (
      challenge: PeerKnowledgeChallenge,
      seenRevision: string | undefined,
    ): Promise<{ readonly draft: PeerChallengeDraft; readonly notes: ReadonlyArray<string> }> => {
      const now = await actionable(challenge, seenRevision);
      const result = await api<{ entry: Record<string, unknown>; notes?: string[] }>(REVISE, {
        entry_id: challenge.entry,
        entry_revision: now.published,
        objections: objections(challenge),
        llm: true,
      });
      const text = (value: unknown, fallback: string) =>
        typeof value === "string" && value.trim() !== "" ? value : fallback;
      const strings = (value: unknown, fallback: ReadonlyArray<string>) =>
        Array.isArray(value) ? value.filter((item) => typeof item === "string") : [...fallback];
      const entry = result.entry;
      return {
        draft: {
          kind: text(entry.kind, now.entry.kind),
          title: text(entry.title, now.entry.title),
          body: text(entry.body, ""),
          ...(typeof entry.summary === "string" ? { summary: entry.summary } : {}),
          ...(typeof entry.status === "string" ? { status: entry.status } : {}),
          paths: strings(entry.paths, now.entry.paths),
          tags: strings(entry.tags, now.entry.tags),
        },
        notes: Array.isArray(result.notes) ? result.notes : [],
      };
    },

    /**
     * Stages the person's replacement, superseding the entry. The same draft again replays; another
     * draft is another operation, so an abandoned one never blocks the next.
     */
    replace: async (input: {
      readonly challenge: PeerKnowledgeChallenge;
      readonly draft: PeerChallengeDraft;
      readonly seenRevision: string | undefined;
      readonly source: string;
    }) => {
      const operationId = `challenge:${input.challenge.id}:${hash(JSON.stringify(input.draft)).slice(0, 12)}`;
      const before = await replayed(operationId);
      if (before !== null) return keptAs(before);
      await actionable(input.challenge, input.seenRevision);
      const staged = await api<StageResult>("drafts.stage", {
        operation_id: operationId,
        source: input.source,
        entry: { ...input.draft, supersedes: [input.challenge.entry] },
      });
      return keptAs(staged);
    },

    /** Stages the entry itself as deprecated, with the challenge's reasons. */
    retire: async (input: {
      readonly challenge: PeerKnowledgeChallenge;
      readonly seenRevision: string | undefined;
    }) => {
      const now = await actionable(input.challenge, input.seenRevision);
      const operationId = `challenge:${input.challenge.id}:retire:${now.entry.revision ?? ""}`;
      const before = await replayed(operationId);
      if (before !== null) return keptAs(before);
      const staged = await api<StageResult>(RETIRE, {
        operation_id: operationId,
        entry_id: input.challenge.entry,
        entry_revision: now.published,
        reason: objections(input.challenge).join("; ").slice(0, 300),
      });
      return keptAs(staged);
    },
  };
};

/** Repository-relative file paths a finding's text names. */
export const pathsIn = (text: string): ReadonlyArray<string> => [
  ...new Set(
    [...text.matchAll(/(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,8}\b/g)].map(([path]) => path),
  ),
];

/**
 * The checkout's repository and revision, and which of the files `texts` name it has there; none
 * when it is not a Git checkout or names none of them.
 */
export async function codeIn(
  checkout: string,
  texts: ReadonlyArray<string>,
): Promise<
  { readonly repo: string; readonly rev: string; readonly files: ReadonlySet<string> } | undefined
> {
  const paths = [...new Set(texts.flatMap(pathsIn))].slice(0, 40);
  if (paths.length === 0) return undefined;
  try {
    const rev = await run("git", ["-C", checkout, "rev-parse", "HEAD"], { timeoutMs: 5000 });
    const listed = await run(
      "git",
      ["-C", checkout, "ls-tree", "--name-only", "HEAD", "--", ...paths],
      {
        timeoutMs: 5000,
      },
    );
    const top = await run("git", ["-C", checkout, "rev-parse", "--show-toplevel"], {
      timeoutMs: 5000,
    });
    const files = new Set(listed.split("\n").filter((line) => line !== ""));
    return files.size === 0 ? undefined : { repo: top.split(/[\\/]/).pop() ?? "repo", rev, files };
  } catch {
    return undefined;
  }
}

/**
 * Where a candidate's sources came from, as kontext keeps evidence (`extra.external_refs`): the
 * tasks it was found on, where a person's Peer read it, and the files its text names that the
 * checkout has, at the revision it has (`code:<repo>@<rev>:<path>`); and how many agents found it
 * on their own. Never an address or a session: those do not belong in Git.
 */
export function evidenceOf(input: {
  readonly sources: ReadonlyArray<{
    readonly text: string;
    readonly task?: string | undefined;
    readonly origin?: string | undefined;
  }>;
  readonly finders: number;
  /** The checkout's repository, revision and the files it has of those the sources name. */
  readonly code?: {
    readonly repo: string;
    readonly rev: string;
    readonly files: ReadonlySet<string>;
  };
}): { readonly external_refs: ReadonlyArray<string>; readonly finders: string } | undefined {
  const refs = new Set<string>();
  for (const source of input.sources) {
    if (source.task !== undefined) refs.add(`task:${source.task}`);
    if (source.origin !== undefined && /^[\w-]+:\S+$/.test(source.origin)) refs.add(source.origin);
    const code = input.code;
    if (code !== undefined)
      for (const path of pathsIn(source.text))
        if (code.files.has(path)) refs.add(`code:${code.repo}@${code.rev}:${path}`);
  }
  const external = [...refs].slice(0, 20);
  return external.length === 0 && input.finders < 2
    ? undefined
    : // kontext keeps `extra` values as strings.
      { external_refs: external, finders: String(input.finders) };
}

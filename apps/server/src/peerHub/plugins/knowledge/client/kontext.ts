// @effect-diagnostics nodeBuiltinImport:off - hashes the operation ids kontext uses to tell a repeated request.
/** Peer supplies task context and review actions; kontext owns extraction, wording and Git staging. */
import * as NodeCrypto from "node:crypto";

import {
  KontextApiError,
  kontextApi,
  type KontextClientShape,
  type KontextEntry,
} from "../../../kontext.ts";
import { projectGuidance } from "./store.ts";

export {
  KontextClient,
  runKontext,
  type KontextClientShape,
  type KontextRun,
} from "../../../kontext.ts";

export interface DistilledEntry {
  readonly kind: string;
  readonly title: string;
  readonly paths: ReadonlyArray<string>;
  readonly body: string;
}

export interface CandidateForKnowledge {
  readonly text: string;
  readonly finders: number;
  readonly paths?: ReadonlyArray<string> | undefined;
  readonly sources: ReadonlyArray<{
    readonly text: string;
    readonly task?: string | undefined;
    readonly tagged: boolean;
  }>;
}

export interface CandidateToKeep extends CandidateForKnowledge {
  readonly kind?: string | undefined;
  readonly detail?: string | undefined;
}

export function titleOf(text: string): string {
  const sentence = /^(.+?[.!?])(\s|$)/.exec(text.trim())?.[1] ?? text.trim();
  const plain = sentence.replace(/[.!?]$/, "");
  return plain.length > 90 ? `${plain.slice(0, 89).trimEnd()}…` : plain;
}

export function directBody(candidate: CandidateForKnowledge): string {
  return [
    candidate.text,
    `${candidate.finders > 1 ? `${candidate.finders} coding agents found it on their own` : "A coding agent marked it for the project"}; the team kept it in Peer.`,
  ].join("\n\n");
}

interface StageResult {
  readonly entry: KontextEntry;
  readonly path: string;
  readonly staged: boolean;
  readonly replayed: boolean;
  readonly related: ReadonlyArray<string>;
  readonly notes: ReadonlyArray<string>;
}

/** Model operations return rendered entries; staging accepts only their writable draft fields. */
function draftOf(worded: Record<string, unknown>, asked: Record<string, unknown>) {
  const text = (key: string) =>
    typeof worded[key] === "string" && worded[key].trim() !== "" ? { [key]: worded[key] } : {};
  const strings = (key: string) =>
    Array.isArray(worded[key])
      ? { [key]: worded[key].filter((item) => typeof item === "string") }
      : {};
  return {
    ...asked,
    ...text("kind"),
    ...text("title"),
    ...text("body"),
    ...text("summary"),
    ...text("status"),
    ...strings("paths"),
    ...strings("tags"),
  };
}

const hash = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

/** Whether kontext's model words an entry, with the shared context of the work it came from. */
type WordWith =
  | { readonly context: { readonly subject: string; readonly text: string } | undefined }
  | undefined;

/** An entry's writable draft fields and why it reads as the agents wrote it, when it does. */
export interface DraftedEntry {
  readonly entry: Readonly<Record<string, unknown>>;
  readonly asWritten: string | null;
}

/**
 * Adding a finding to an existing entry: kontext drafts the amended entry (`drafts.extend`, a
 * convention, learning or incident only) and stages it in place (`drafts.stage` with `amends`).
 * Listed in its capabilities from the release that has both.
 */
export const EXTEND = "drafts.extend";
export const extendsIn = (capabilities: ReadonlyArray<string>) => capabilities.includes(EXTEND);

/** An existing entry with a finding folded in, as `drafts.extend` drafts it; nothing is written. */
export interface ExtendedEntry {
  readonly entry: {
    readonly id: string;
    readonly kind: string;
    readonly title: string;
    readonly file: string;
    readonly body: string;
  } & Readonly<Record<string, unknown>>;
  readonly oldBody: string;
  /** No model worded it: the finding was appended under `## Added <date>`. */
  readonly asWritten: boolean;
  readonly notes: ReadonlyArray<string>;
}

export const kontextIn = (client: KontextClientShape, checkout: string) => {
  const api = <A>(operation: string, input: unknown = {}) =>
    kontextApi<A>(client, checkout, operation, input);
  /** A new entry as `keep` words it: the agents' text, worded by kontext's model when asked. */
  const wordNew = async (input: {
    readonly candidate: CandidateToKeep;
    readonly where: (task: string | undefined) => string;
    readonly word: WordWith;
  }): Promise<DraftedEntry> => {
    const { candidate, where } = input;
    const entry: Record<string, unknown> = {
      kind: candidate.kind ?? "learning",
      title: candidate.detail === undefined ? titleOf(candidate.text) : candidate.text,
      body: candidate.detail ?? directBody(candidate),
      paths: candidate.paths ?? [],
    };
    if (candidate.detail !== undefined || input.word === undefined)
      return { entry, asWritten: null };
    const refined = await api<{ entry: Record<string, unknown>; notes: string[] }>(
      "drafts.formalize",
      {
        entry,
        sources: candidate.sources.map((source) => `${source.text} (${where(source.task)})`),
        context: input.word.context?.text,
      },
    );
    return {
      entry: draftOf(refined.entry, entry),
      asWritten: refined.notes.length === 0 ? null : refined.notes.join("; "),
    };
  };
  return {
    init: async (): Promise<void> => {
      await api("setup");
    },

    keep: async (input: {
      readonly project: string;
      readonly operationId: string;
      readonly source: string;
      readonly candidate: CandidateToKeep;
      readonly where: (task: string | undefined) => string;
      readonly word: WordWith;
      /** What it stands on (`extra.external_refs`), and the entries the person chose it replaces. */
      readonly evidence?: Readonly<Record<string, unknown>> | undefined;
      readonly supersedes?: ReadonlyArray<string> | undefined;
      /** Kept entries the new entry builds on (its `extends`); kontext refuses an id it lacks. */
      readonly extends?: ReadonlyArray<string> | undefined;
      /** The entry as a person saw it drafted (`draft`), staged as it is instead of worded again. */
      readonly drafted?: DraftedEntry | undefined;
    }): Promise<{
      readonly keptAs: { readonly path: string; readonly title: string; readonly kind: string };
      readonly related: string | null;
      readonly asWritten: string | null;
    }> => {
      const { candidate, where, word } = input;
      const fingerprint = hash(
        JSON.stringify({
          text: candidate.text,
          kind: candidate.kind,
          detail: candidate.detail,
          paths: candidate.paths ?? [],
          sources: candidate.sources,
          finders: candidate.finders,
          supersedes: input.supersedes ?? [],
          // Absent when empty, so a keep without links replays under the fingerprint it always had.
          ...(input.extends === undefined || input.extends.length === 0
            ? {}
            : { extends: input.extends }),
        }),
      );
      const identity = { operation_id: input.operationId, fingerprint };
      let previous: StageResult | undefined;
      try {
        previous = await api<StageResult>("operations.get", identity);
      } catch (error) {
        if (!(error instanceof KontextApiError)) throw error;
        if (error.code === "operation_incomplete")
          previous = await api<StageResult>("drafts.stage", identity);
        else if (error.code !== "not_found") throw error;
      }
      if (previous !== undefined)
        return {
          keptAs: { path: previous.path, title: previous.entry.title, kind: previous.entry.kind },
          related: null,
          asWritten: previous.notes.length === 0 ? null : previous.notes.join("; "),
        };
      const related = await api<{ entries: KontextEntry[] }>("entries.search", {
        query: candidate.text,
        limit: 3,
        active_only: true,
      });
      const { entry, asWritten } = input.drafted ?? (await wordNew({ candidate, where, word }));
      // What the model worded keeps what the entry stands on, what it replaces and builds on.
      const extra = {
        ...(input.evidence === undefined ? {} : { extra: input.evidence }),
        ...(input.supersedes === undefined || input.supersedes.length === 0
          ? {}
          : { supersedes: input.supersedes }),
        ...(input.extends === undefined || input.extends.length === 0
          ? {}
          : { extends: input.extends }),
      };
      const staged = await api<StageResult>("drafts.stage", {
        entry: { ...entry, ...extra },
        ...identity,
        source: input.source,
      });
      return {
        keptAs: { path: staged.path, title: staged.entry.title, kind: staged.entry.kind },
        related: related.entries[0]?.title ?? null,
        asWritten,
      };
    },

    /** A new entry as `keep` would word it, without staging it. */
    word: wordNew,

    /** The entry with `text` folded in, at the revision the caller compared; writes nothing. */
    extend: async (input: {
      readonly entry: string;
      readonly revision: string;
      readonly text: string;
      readonly llm: boolean;
    }): Promise<ExtendedEntry> => {
      const result = await kontextApi<{
        entry: ExtendedEntry["entry"];
        old_body?: unknown;
        as_written?: unknown;
        notes?: unknown;
      }>(
        client,
        checkout,
        EXTEND,
        {
          entry_id: input.entry,
          entry_revision: input.revision,
          text: input.text,
          ...(input.llm ? { llm: true } : {}),
        },
        input.llm ? 600_000 : undefined,
      );
      return {
        entry: result.entry,
        oldBody: typeof result.old_body === "string" ? result.old_body : "",
        asWritten: result.as_written !== false,
        notes: Array.isArray(result.notes)
          ? result.notes.filter((note): note is string => typeof note === "string")
          : [],
      };
    },

    /**
     * Stages an amended entry over its own file, refused when the entry moved past `revision`
     * (`stale_entry`). The same draft again replays what was staged.
     */
    amend: async (input: {
      readonly operationId: string;
      readonly source: string;
      readonly entry: Readonly<Record<string, unknown>>;
      readonly amends: { readonly id: string; readonly revision: string };
    }): Promise<{ readonly path: string; readonly title: string; readonly kind: string }> => {
      const entry = { ...draftOf(input.entry, {}), amends: input.amends };
      const identity = {
        operation_id: input.operationId,
        fingerprint: hash(JSON.stringify(entry)),
      };
      let staged: StageResult | undefined;
      try {
        staged = await api<StageResult>("operations.get", identity);
      } catch (error) {
        if (!(error instanceof KontextApiError)) throw error;
        if (error.code === "operation_incomplete")
          staged = await api<StageResult>("drafts.stage", identity);
        else if (error.code !== "not_found") throw error;
      }
      staged ??= await api<StageResult>("drafts.stage", {
        entry,
        ...identity,
        source: input.source,
      });
      return { path: staged.path, title: staged.entry.title, kind: staged.entry.kind };
    },

    /** A successor that answers `text`, as `drafts.revise` drafts one; writes nothing. */
    revise: async (input: { readonly entry: string; readonly text: string }) => {
      const { entry } = await api<{ entry: KontextEntry }>("entries.get", { id: input.entry });
      const publication = entry.publication as { readonly revision?: unknown } | undefined;
      const result = await kontextApi<{ entry: Record<string, unknown>; notes?: unknown }>(
        client,
        checkout,
        "drafts.revise",
        {
          entry_id: input.entry,
          entry_revision:
            typeof publication?.revision === "string" ? publication.revision : undefined,
          objections: [input.text.slice(0, 300)],
          llm: true,
        },
      );
      return {
        entry: draftOf(result.entry, { kind: entry.kind, title: entry.title, paths: entry.paths }),
        notes: Array.isArray(result.notes)
          ? result.notes.filter((note): note is string => typeof note === "string")
          : [],
      };
    },

    /** The titles of kept entries, in order; kontext's `not_found` for an id it lacks. */
    titles: async (ids: ReadonlyArray<string>) =>
      Promise.all(
        ids.map(async (id) => {
          const { entry } = await api<{ entry: KontextEntry }>("entries.get", { id });
          return { entry: id, title: entry.title };
        }),
      ),

    harvest: async (input: {
      readonly project: string;
      readonly subject: string;
      readonly text: string;
    }): Promise<ReadonlyArray<DistilledEntry>> => {
      const result = await api<{ candidates: DistilledEntry[] }>("drafts.extract", {
        text: input.text,
        max: 3,
      });
      return result.candidates;
    },

    guidance: async (labels: {
      readonly project: string;
      readonly kept: ReadonlyArray<string>;
      readonly dismissed: ReadonlyArray<string>;
      readonly missed: ReadonlyArray<string>;
    }): Promise<{ readonly path: string; readonly title: string }> => {
      const fingerprint = hash(
        JSON.stringify({
          project: labels.project,
          kept: [...labels.kept].toSorted(),
          dismissed: [...labels.dismissed].toSorted(),
          missed: [...labels.missed].toSorted(),
        }),
      );
      const identity = { operation_id: `peer:guidance:${fingerprint}`, fingerprint };
      let previous: StageResult | undefined;
      try {
        previous = await api<StageResult>("operations.get", identity);
      } catch (error) {
        if (!(error instanceof KontextApiError)) throw error;
        if (error.code === "operation_incomplete")
          previous = await api<StageResult>("drafts.stage", identity);
        else if (error.code !== "not_found") throw error;
      }
      if (previous !== undefined) return { path: previous.path, title: previous.entry.title };
      const current = await projectGuidance(checkout, client);
      const result = await api<{ entry: Record<string, unknown> }>("guidance.propose", {
        kept: labels.kept,
        dismissed: labels.dismissed,
        missed: labels.missed,
        current: current?.text,
        profile_tag: "peer-skill",
      });
      const guidanceEntry = {
        ...draftOf(result.entry, {}),
        ...(current === null ? {} : { supersedes: [current.id] }),
      };
      const staged = await api<StageResult>("drafts.stage", {
        entry: guidanceEntry,
        ...identity,
      });
      return { path: staged.path, title: staged.entry.title };
    },
  };
};

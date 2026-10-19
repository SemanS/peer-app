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

/**
 * The draft `drafts.stage` takes, out of the entry `drafts.formalize` answers: kontext answers it as
 * it reads an entry (its id, rendered `markdown`, file and publication state), and refuses those
 * back, the multi-line `markdown` first.
 */
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

export const kontextIn = (client: KontextClientShape, checkout: string) => {
  const api = <A>(operation: string, input: unknown = {}) =>
    kontextApi<A>(client, checkout, operation, input);
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
      readonly word:
        | { readonly context: { readonly subject: string; readonly text: string } | undefined }
        | undefined;
      /** What it stands on (`extra.external_refs`), and the entries the person chose it replaces. */
      readonly evidence?: Readonly<Record<string, unknown>> | undefined;
      readonly supersedes?: ReadonlyArray<string> | undefined;
    }): Promise<{
      readonly keptAs: { readonly path: string; readonly title: string; readonly kind: string };
      readonly related: string | null;
      readonly asWritten: string | null;
    }> => {
      const { candidate, where } = input;
      const fingerprint = hash(
        JSON.stringify({
          text: candidate.text,
          kind: candidate.kind,
          detail: candidate.detail,
          paths: candidate.paths ?? [],
          sources: candidate.sources,
          finders: candidate.finders,
          supersedes: input.supersedes ?? [],
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
      const kind = candidate.kind ?? "learning";
      let entry: Record<string, unknown> = {
        kind,
        title: candidate.detail === undefined ? titleOf(candidate.text) : candidate.text,
        body: candidate.detail ?? directBody(candidate),
        paths: candidate.paths ?? [],
      };
      const related = await api<{ entries: KontextEntry[] }>("entries.search", {
        query: candidate.text,
        limit: 3,
        active_only: true,
      });
      let asWritten: string | null = null;
      if (candidate.detail === undefined && input.word !== undefined) {
        const refined = await api<{ entry: Record<string, unknown>; notes: string[] }>(
          "drafts.formalize",
          {
            entry,
            sources: candidate.sources.map((source) => `${source.text} (${where(source.task)})`),
            context: input.word.context?.text,
          },
        );
        entry = draftOf(refined.entry, entry);
        asWritten = refined.notes.length === 0 ? null : refined.notes.join("; ");
      }
      // What the model worded keeps what the entry stands on and what it replaces.
      const extra = {
        ...(input.evidence === undefined ? {} : { extra: input.evidence }),
        ...(input.supersedes === undefined || input.supersedes.length === 0
          ? {}
          : { supersedes: input.supersedes }),
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
      const result = await api<{ entry: unknown }>("guidance.propose", {
        kept: labels.kept,
        dismissed: labels.dismissed,
        missed: labels.missed,
        current: current?.text,
        profile_tag: "peer-skill",
      });
      const guidanceEntry = {
        ...(result.entry as Record<string, unknown>),
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

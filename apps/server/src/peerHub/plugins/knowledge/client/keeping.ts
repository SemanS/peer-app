// @effect-diagnostics nodeBuiltinImport:off - hashes the operation id a kept candidate is staged under.
/**
 * What people do with knowledge candidates: dismiss or propose one again (with why, for the
 * project's guidance), keep one (kontext writes it, staged, with what it stands on): as a new entry
 * linked to the entries it builds on, added into an existing entry, or replacing one, each shown
 * first as the draft Apply stages (`preview`); read a shared context for what to keep, and propose
 * the project's guidance from what people decided.
 *
 * @module peerHub/plugins/knowledge/client/keeping
 */
import * as NodeCrypto from "node:crypto";

import {
  PeerHubError,
  isCandidateKept,
  type PeerHubCandidatesInput,
  type PeerHubDecideCandidateInput,
  type PeerHubHarvestInput,
  type PeerHubKeepCandidateInput,
  type PeerKeepOperation,
  type PeerKeptCandidate,
  type PeerKnowledgeCandidate,
  type PeerKnowledgePreview,
  type PeerKnowledgePreviewInput,
  type PeerKnowledgeStatus,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type * as PeerAgents from "../../../core/coordination/PeerAgents.ts";
import type * as PeerHubClient from "../../../core/hub/PeerHubClient.ts";
import type * as PeerState from "../../../core/state/PeerState.ts";
import type * as PeerStatus from "../../../core/status/PeerStatus.ts";
import type * as PeerWork from "../../../core/work/PeerWork.ts";
import { KontextApiError } from "../../../kontext.ts";
import type { knowledgeHub } from "./hub.ts";
import { EXTEND, type DraftedEntry, type kontextIn } from "./kontext.ts";
import { codeIn, evidenceOf, needsNewerKontext } from "./resolve.ts";

const hubError = (detail: string) => new PeerHubError({ detail });
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What a person reads when the entry they add to changed after the finding was compared with it. */
export const STALE_ENTRY = "This entry changed since it was compared; compare again";

/**
 * kontext's refusals a person can act on keep their code, so a client can tell a stale entry
 * (compare again) from any other failure; a decision's refusal says why in kontext's words.
 */
const refusalOf = (failure: unknown) => {
  if (!(failure instanceof KontextApiError)) return hubError(messageOf(failure));
  switch (failure.code) {
    case "stale_entry":
      return new PeerHubError({ detail: STALE_ENTRY, code: failure.code, refused: true });
    case "decision_not_amended":
      return new PeerHubError({ detail: failure.message, code: failure.code, refused: true });
    case "unknown_entry":
      return new PeerHubError({
        detail: "An entry it links to is not in this checkout's knowledge: compare again.",
        code: failure.code,
        refused: true,
      });
    default:
      return hubError(failure.message);
  }
};
/** One of kontext's commands; what kontext did not do fails with what it said. */
const kontextDid = <A>(command: () => Promise<A>) =>
  Effect.tryPromise({ try: command, catch: refusalOf });

const sha = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

/** Words of a body as a reader counts them, for the long-entry hint. */
export const wordsIn = (body: string) => body.split(/\s+/).filter((word) => word !== "").length;

/** What a finding adds to an entry: its line, and its body when it came already written. */
const findingText = (candidate: { readonly text: string; readonly detail?: string | undefined }) =>
  candidate.detail === undefined ? candidate.text : `${candidate.text}\n\n${candidate.detail}`;

/** Drafts the server keeps for the cards people expanded, so Apply stages what they read. */
const DRAFTS_KEPT = 200;
interface Drafted {
  /** The entry revision it was drafted against; a moved revision is drafted again. */
  readonly revision: string;
  /** The text and links it was drafted from; other ones are drafted again. */
  readonly version: string;
  readonly preview: PeerKnowledgePreview;
  readonly drafted: DraftedEntry;
}

/** Why people dismissed candidates, for the project's guidance; the newest this many are kept. */
const DismissedReasons = Schema.Struct({ dismissed: Schema.Record(Schema.String, Schema.String) });
const REASONS_KEPT = 200;

/** The project's checkout here, with kontext in it. */
type Here = Omit<PeerKnowledgeStatus, "checkout" | "kontext"> & {
  readonly checkout: string;
  readonly kontext: ReturnType<typeof kontextIn>;
};

export function keepingFlows(deps: {
  readonly state: PeerState.PeerState["Service"];
  readonly client: PeerHubClient.PeerHubClient["Service"];
  readonly agents: PeerAgents.PeerAgents["Service"];
  readonly work: PeerWork.PeerWork["Service"];
  readonly status: PeerStatus.PeerStatus["Service"];
  readonly hub: ReturnType<typeof knowledgeHub>;
  readonly statusOf: (workspace: string, project: string) => Effect.Effect<PeerKnowledgeStatus>;
  readonly checkoutOf: (workspace: string, project: string) => Effect.Effect<Here, PeerHubError>;
  readonly storeOf: (workspace: string, project: string) => Effect.Effect<Here, PeerHubError>;
}) {
  const { state, client, agents, work, status, hub, statusOf, checkoutOf, storeOf } = deps;
  /** How people name the works of `tasks` here: a task's name, or the project's work outside tasks. */
  const workNames = (workspace: string, project: string, tasks: Iterable<string | undefined>) =>
    Effect.gen(function* () {
      const names = new Map<string, string>();
      for (const task of new Set(tasks)) {
        if (task !== undefined) names.set(task, yield* work.taskName(workspace, project, task));
      }
      return (task: string | undefined) =>
        task === undefined ? "work outside tasks" : (names.get(task) ?? task);
    });

  /** A shared context's text as the Hub keeps it; null when nobody wrote it. */
  const readContext = (workspace: string, project: string, contextScope: string) =>
    client.session.pipe(
      Effect.flatMap(({ hubUrl, session }) =>
        client.api.readContext(hubUrl, session, workspace, project, contextScope),
      ),
    );

  const reasons = state.pluginData("knowledge", DismissedReasons);
  const reasonKey = (workspace: string, project: string, id: string) =>
    `${workspace}/${project}/${id}`;
  const decide = Effect.fn("Knowledge.decide")(function* (input: PeerHubDecideCandidateInput) {
    yield* hub.decide(input.workspace, input.project, input.id, input.status);
    const reason = input.status === "dismissed" ? input.reason : undefined;
    if (reason !== undefined)
      yield* reasons.update((held) => {
        const dismissed = Object.entries(held._tag === "Some" ? held.value.dismissed : {});
        dismissed.push([reasonKey(input.workspace, input.project, input.id), reason]);
        return { dismissed: Object.fromEntries(dismissed.slice(-REASONS_KEPT)) };
      });
    // The count waiting in Work follows from the next view.
    yield* agents.hubChanged;
    return yield* status.publish;
  });

  const setup = Effect.fn("Knowledge.setup")(function* (input: PeerHubCandidatesInput) {
    const here = yield* checkoutOf(input.workspace, input.project);
    if (!here.store) yield* kontextDid(() => here.kontext.init());
    return yield* statusOf(input.workspace, input.project);
  });

  /** A candidate as the person keeps it, in their edited words, with how its works are named. */
  const keptOf = (store: Here, input: PeerHubKeepCandidateInput | PeerKnowledgePreviewInput) =>
    Effect.gen(function* () {
      const found = (yield* hub.candidates(input.workspace, input.project)).find(
        (one) => one.id === input.id,
      );
      if (found === undefined) return yield* hubError("That candidate is no longer there.");
      // A person who edited the text keeps their own words, as they wrote them.
      const edited = input.text !== undefined && input.text.trim() !== "";
      const candidate = edited ? { ...found, text: input.text!.trim() } : found;
      const where = yield* workNames(
        input.workspace,
        input.project,
        candidate.sources.map((source) => source.task),
      );
      // kontext's model words what came unworded, with the shared context of the work it came from.
      const task = candidate.sources[0]?.task;
      const word =
        !edited && candidate.detail === undefined && store.llm
          ? {
              context: yield* readContext(
                input.workspace,
                input.project,
                task === undefined ? "project" : `task:${task}`,
              ).pipe(
                Effect.map((context) =>
                  context === null ? undefined : { subject: where(task), text: context.text },
                ),
                Effect.orElseSucceed(() => undefined),
              ),
            }
          : undefined;
      return { candidate, where, word };
    });

  const drafts = new Map<string, Drafted>();
  const slotOf = (
    input: { readonly workspace: string; readonly project: string; readonly id: string },
    operation: PeerKeepOperation,
    entry: string | undefined,
  ) => [input.workspace, input.project, input.id, operation, entry ?? ""].join("\u0000");
  const versionOf = (text: string | undefined, links: ReadonlyArray<string> | undefined) =>
    sha(JSON.stringify([text ?? "", [...(links ?? [])].toSorted()]));
  /**
   * The draft a card showed, while its text and links are still those and its entry still at
   * `revision` (unchecked when the caller has none: kontext checks a replacement itself).
   */
  const heldDraft = (slot: string, version: string, revision: string | undefined) => {
    const held = drafts.get(slot);
    return held?.version === version && (revision === undefined || held.revision === revision)
      ? held
      : undefined;
  };
  /** A kept candidate's drafts are spent. */
  const forget = (input: {
    readonly workspace: string;
    readonly project: string;
    readonly id: string;
  }) => {
    const prefix = `${[input.workspace, input.project, input.id].join("\u0000")}\u0000`;
    for (const slot of drafts.keys()) if (slot.startsWith(prefix)) drafts.delete(slot);
  };

  /** Drafts what keeping the candidate by `operation` would stage; stages nothing. */
  const draftFor = (store: Here, input: PeerKnowledgePreviewInput) =>
    Effect.gen(function* () {
      const { candidate, where, word } = yield* keptOf(store, input);
      const target = input.entry;
      if (input.operation === "add" && target !== undefined) {
        const extended = yield* kontextDid(() =>
          store.kontext.extend({
            entry: target.entry,
            revision: target.revision,
            text: findingText(candidate),
            llm: store.llm,
          }),
        );
        const { entry } = extended;
        return {
          preview: {
            operation: "add",
            entry: { id: entry.id, title: entry.title, kind: entry.kind, path: entry.file },
            oldBody: extended.oldBody,
            body: entry.body,
            links: [],
            asWritten: extended.asWritten
              ? extended.notes.length === 0
                ? "no model worded it"
                : extended.notes.join("; ")
              : null,
            words: wordsIn(entry.body),
          },
          drafted: { entry, asWritten: null },
        } satisfies Omit<Drafted, "version" | "revision">;
      }
      const replaced = input.operation === "supersede" ? target?.entry : undefined;
      // A replacement answers the finding where kontext's model can write one; otherwise the
      // finding itself, worded as a new entry, replaces the entry.
      const drafted: DraftedEntry =
        replaced !== undefined && store.llm
          ? yield* kontextDid(() =>
              store.kontext.revise({ entry: replaced, text: findingText(candidate) }),
            ).pipe(
              Effect.map((revised) => ({
                entry: revised.entry,
                asWritten: revised.notes.length === 0 ? null : revised.notes.join("; "),
              })),
            )
          : yield* kontextDid(() => store.kontext.word({ candidate, where, word }));
      const linked = replaced === undefined ? (input.extends ?? []) : [replaced];
      const links = yield* kontextDid(() => store.kontext.titles(linked));
      const text = (key: string) =>
        typeof drafted.entry[key] === "string" ? (drafted.entry[key] as string) : "";
      return {
        preview: {
          operation: input.operation,
          entry: { id: null, title: text("title"), kind: text("kind"), path: null },
          oldBody: null,
          body: text("body"),
          links,
          asWritten: drafted.asWritten,
          words: wordsIn(text("body")),
        },
        drafted,
      } satisfies Omit<Drafted, "version" | "revision">;
    });

  /**
   * What a card shows before Apply: drafted once per candidate and entry revision (and the
   * person's text and links), reused until one of them moves, when it is drafted again.
   */
  const preview = Effect.fn("Knowledge.preview")(function* (input: PeerKnowledgePreviewInput) {
    const store = yield* storeOf(input.workspace, input.project);
    if (input.operation === "add" && store.extends !== true)
      return yield* hubError(needsNewerKontext(EXTEND, "0.9.0"));
    const slot = slotOf(input, input.operation, input.entry?.entry);
    const version = versionOf(input.text, input.operation === "new" ? input.extends : undefined);
    const revision = input.entry?.revision ?? "";
    const held = heldDraft(slot, version, revision);
    if (held !== undefined) return held.preview;
    const made = yield* draftFor(store, input);
    drafts.delete(slot);
    if (drafts.size >= DRAFTS_KEPT) drafts.delete(drafts.keys().next().value!);
    drafts.set(slot, { ...made, revision, version });
    return made.preview;
  });

  const keep = Effect.fn("Knowledge.keep")(function* (input: PeerHubKeepCandidateInput) {
    const store = yield* storeOf(input.workspace, input.project);
    const operationId = `peer:knowledge:${sha(`${input.workspace}/${input.project}/${input.id}`)}`;
    const source = `peer://knowledge/${encodeURIComponent(input.workspace)}/${encodeURIComponent(input.project)}/${encodeURIComponent(input.id)}`;
    const into = input.into;
    // An older kontext cannot add to an entry: the finding becomes a new entry, and says so.
    const note =
      into !== undefined && store.extends !== true
        ? "This kontext cannot add to an entry, so it was kept as a new entry."
        : undefined;
    if (into !== undefined && note === undefined) {
      const slot = slotOf(input, "add", into.entry);
      const shown =
        heldDraft(slot, versionOf(input.text, undefined), into.revision) ??
        (yield* draftFor(store, {
          workspace: input.workspace,
          project: input.project,
          id: input.id,
          operation: "add",
          entry: into,
          ...(input.text === undefined ? {} : { text: input.text }),
        }));
      const keptAs = yield* kontextDid(() =>
        store.kontext.amend({
          operationId: `${operationId}:into:${sha(`${into.entry}@${into.revision}`).slice(0, 16)}`,
          source,
          entry: shown.drafted.entry,
          amends: { id: into.entry, revision: into.revision },
        }),
      ).pipe(Effect.tapError(() => Effect.sync(() => drafts.delete(slot))));
      yield* hub.decide(input.workspace, input.project, input.id, "promoted", keptAs);
      forget(input);
      yield* agents.hubChanged;
      yield* status.publish;
      return {
        checkout: store.checkout,
        keptAs,
        related: null,
        asWritten: shown.preview.asWritten,
        way: "amended",
      } satisfies PeerKeptCandidate;
    }
    const { candidate, where, word } = yield* keptOf(store, input);
    const replaced = input.supersedes?.length === 1 ? input.supersedes[0] : undefined;
    const shown =
      note === undefined
        ? heldDraft(
            slotOf(input, replaced === undefined ? "new" : "supersede", replaced),
            versionOf(input.text, replaced === undefined ? input.extends : undefined),
            undefined,
          )
        : undefined;
    const code = yield* Effect.promise(() =>
      codeIn(
        store.checkout,
        candidate.sources.map((source) => source.text),
      ),
    );
    const kept = yield* kontextDid(() =>
      store.kontext.keep({
        project: input.project,
        operationId,
        source,
        candidate,
        where,
        word,
        evidence: evidenceOf({
          sources: candidate.sources,
          finders: candidate.finders,
          ...(code === undefined ? {} : { code }),
        }),
        supersedes: input.supersedes,
        extends: input.extends,
        drafted: shown?.drafted,
      }),
    );
    yield* hub.decide(input.workspace, input.project, input.id, "promoted", kept.keptAs);
    forget(input);
    yield* agents.hubChanged;
    yield* status.publish;
    return {
      checkout: store.checkout,
      ...kept,
      way: input.supersedes !== undefined && input.supersedes.length > 0 ? "superseding" : "new",
      ...(note === undefined ? {} : { note }),
    } satisfies PeerKeptCandidate;
  });

  const harvest = Effect.fn("Knowledge.harvest")(function* (input: PeerHubHarvestInput) {
    const store = yield* storeOf(input.workspace, input.project);
    if (!store.llm) {
      return yield* hubError("Reading a context for what to keep needs kontext's llm adapter.");
    }
    const task = input.scope.startsWith("task:") ? input.scope.slice("task:".length) : undefined;
    // Conversations are read as the person sees them; a context is read as its keeper saved it.
    const source =
      input.conversations === undefined
        ? yield* readContext(input.workspace, input.project, input.scope)
        : { text: input.conversations, origin: `conversations:${input.scope}` };
    if (source === null || source.text.trim() === "") {
      return yield* hubError("Nobody has written that context yet.");
    }
    const origin = "origin" in source ? source.origin : `context:${input.scope}@v${source.version}`;
    const where = yield* workNames(input.workspace, input.project, [task]);
    const entries = yield* kontextDid(() =>
      store.kontext.harvest({ project: input.project, subject: where(task), text: source.text }),
    );
    for (const entry of entries) {
      yield* hub.propose(input.workspace, input.project, {
        text: entry.title,
        kind: entry.kind,
        detail: entry.body,
        paths: entry.paths,
        ...(task === undefined ? {} : { task }),
        origin,
      });
    }
    yield* agents.hubChanged;
    return { proposed: entries.length };
  });

  const improve = Effect.fn("Knowledge.improve")(function* (input: PeerHubCandidatesInput) {
    const store = yield* storeOf(input.workspace, input.project);
    if (!store.llm) return yield* hubError("Proposing guidance needs kontext's llm adapter.");
    const candidates = yield* hub.candidates(input.workspace, input.project);
    // The labels are people's decisions on what agents marked; a harvest is not an agent's mark.
    const marked = (candidate: PeerKnowledgeCandidate) =>
      candidate.sources.some((source) => source.tagged && source.origin === undefined);
    const decided = candidates.filter((candidate) => candidate.status !== "proposed");
    if (decided.length < 3) {
      return yield* hubError(
        `Keep or dismiss a few more candidates first: ${decided.length} decided, 3 needed.`,
      );
    }
    const held = yield* reasons.read;
    const whys = held._tag === "Some" ? held.value.dismissed : {};
    const staged = yield* kontextDid(() =>
      store.kontext.guidance({
        project: input.project,
        kept: decided.filter((c) => isCandidateKept(c.status) && marked(c)).map((c) => c.text),
        // What people said of a dismissal ("already in …") is part of what they decided.
        dismissed: decided
          .filter((c) => c.status === "dismissed" && marked(c))
          .map((c) => {
            const why = whys[reasonKey(input.workspace, input.project, c.id)];
            return why === undefined ? c.text : `${c.text} (dismissed: ${why})`;
          }),
        missed: decided.filter((c) => isCandidateKept(c.status) && !marked(c)).map((c) => c.text),
      }),
    );
    return { checkout: store.checkout, ...staged };
  });

  return { decide, setup, keep, preview, harvest, improve };
}

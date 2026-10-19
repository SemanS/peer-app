// @effect-diagnostics nodeBuiltinImport:off globalDateInEffect:off preferSchemaOverJson:off - hashes what a candidate's relations are cached by; kontext's capabilities are asked again after a minute of wall-clock time.
/**
 * What people do with challenges from Peer's clients: a project's list with each entry as this
 * checkout has it, opening or seconding one, deciding one (dismiss, reopen, resolve), staging the
 * entry's retirement or a replacement, and drafting that replacement with kontext. Also a
 * candidate's relations to kept entries (`entries.related`), and the verification a refresh of a
 * project's book runs: a resolving challenge resolves only once a committed revision shows the
 * entry superseded or deprecated.
 *
 * @module peerHub/plugins/knowledge/client/challengeFlows
 */
import * as NodeCrypto from "node:crypto";

import {
  PeerHubError,
  type PeerChallengeAction,
  type PeerChallengeRow,
  type PeerHubCandidateInput,
  type PeerHubCandidatesInput,
  type PeerHubChallengeInput,
  type PeerHubDecideChallengeInput,
  type PeerHubOpenChallengeInput,
  type PeerKnowledgeCandidate,
  type PeerKnowledgeChallenge,
  type PeerKnowledgeChallenges,
  type PeerKnowledgeRelations,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { engineStatus, kontextApi, type KontextClientShape } from "../../../kontext.ts";
import type { KnowledgeEntry } from "../../../knowledgeEntry.ts";
import {
  challengeUpdates,
  type ChallengeCache,
  type ChallengesHub,
  type EntryNow,
} from "./challenges.ts";
import {
  ChallengeRefused,
  challengeActions,
  needsNewerKontext,
  RELATED,
  RETIRE,
  REVISE,
} from "./resolve.ts";

const hubError = (detail: string) => new PeerHubError({ detail });
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What the flows need of the plugin: the Hub, the project's store here, and how to log. */
export interface FlowDeps {
  readonly hub: ChallengesHub;
  readonly cache: ChallengeCache;
  readonly kontext: KontextClientShape;
  /** Whether the signed-in Hub serves challenges. */
  readonly served: Effect.Effect<boolean>;
  /** The project's checkout here that keeps its knowledge, and whether kontext's model may run. */
  readonly storeOf: (
    workspace: string,
    project: string,
  ) => Effect.Effect<{ readonly checkout: string; readonly llm: boolean }, PeerHubError>;
  /** The active entries of a checkout. */
  readonly book: (checkout: string) => Effect.Effect<ReadonlyArray<KnowledgeEntry>>;
  readonly candidates: (
    workspace: string,
    project: string,
  ) => Effect.Effect<ReadonlyArray<PeerKnowledgeCandidate>, PeerHubError>;
  readonly changed: Effect.Effect<void>;
  readonly log: (event: string, fields: Readonly<Record<string, unknown>>) => Effect.Effect<void>;
}

const off = (reason: string): PeerChallengeAction => ({ available: false, reason });
const on: PeerChallengeAction = { available: true, reason: null };

/** kontext's own words for why it refused, or Peer's for a challenge it would not act on. */
const failed = (error: unknown) =>
  hubError(error instanceof ChallengeRefused ? error.message : messageOf(error));

export function challengeFlows(deps: FlowDeps) {
  const capabilities = new Map<
    string,
    { readonly at: number; readonly ops: ReadonlySet<string> }
  >();
  /** The operations kontext offers in a checkout, asked at most once a minute. */
  const opsIn = (checkout: string) =>
    Effect.tryPromise(async () => {
      const held = capabilities.get(checkout);
      if (held !== undefined && Date.now() - held.at < 60_000) return held.ops;
      const status = await engineStatus(deps.kontext, checkout);
      const ops = new Set(status.capabilities);
      capabilities.set(checkout, { at: Date.now(), ops });
      return ops;
    }).pipe(Effect.orElseSucceed((): ReadonlySet<string> => new Set()));

  const servedOrFail = Effect.flatMap(deps.served, (served) =>
    served
      ? Effect.void
      : Effect.fail(
          new PeerHubError({
            detail: "This Hub does not take challenges of knowledge yet.",
            kind: "unsupported",
            refused: true,
          }),
        ),
  );

  const challengeOf = (workspace: string, project: string, id: string) =>
    Effect.flatMap(deps.hub.list(workspace, project), (list) => {
      deps.cache.put(workspace, project, list);
      const found = list.find((challenge) => challenge.id === id);
      return found === undefined
        ? Effect.fail(hubError("That challenge is no longer there."))
        : Effect.succeed(found);
    });

  /** The entries a project's challenges name, as the checkout reads them now. */
  const entriesNow = (checkout: string, list: ReadonlyArray<PeerKnowledgeChallenge>) =>
    Effect.tryPromise(async () => {
      const actions = challengeActions(deps.kontext, checkout);
      const now = new Map<string, Awaited<ReturnType<typeof actions.current>>>();
      for (const entry of new Set(list.map((challenge) => challenge.entry)))
        now.set(entry, await actions.current(entry).catch(() => undefined as never));
      return now;
    }).pipe(Effect.orElseSucceed(() => new Map()));

  /** Posts what the checkout says of the project's challenges (`challengeUpdates`). */
  const verifyWith = (
    workspace: string,
    project: string,
    list: ReadonlyArray<PeerKnowledgeChallenge>,
    now: ReadonlyMap<string, Awaited<ReturnType<ReturnType<typeof challengeActions>["current"]>>>,
  ) =>
    Effect.gen(function* () {
      const updates = challengeUpdates(list, (entry): EntryNow | null | undefined => {
        const found = now.get(entry);
        return found === null || found === undefined
          ? found
          : {
              file: found.entry.file,
              title: found.entry.title,
              kind: found.entry.kind,
              status: found.entry.status,
              state: found.state,
              revision: found.entry.revision,
            };
      });
      for (const { id, bodies } of updates) {
        for (const body of bodies) {
          const done = yield* deps.hub.decide(workspace, project, id, body).pipe(Effect.option);
          if (done._tag === "None") break;
        }
        yield* deps.log("knowledge.challenge-verified", {
          workspace,
          project,
          challenge: id,
          posted: bodies.map((body) => body.status),
        });
      }
      return updates.length;
    });

  /** On a refresh of a checkout's book: what it says of the project's challenges, posted. */
  const verify = (workspace: string, project: string, checkout: string) =>
    Effect.gen(function* () {
      if (!(yield* deps.served)) return;
      deps.cache.want(workspace, project);
      const list = deps.cache
        .of(workspace, project)
        .filter((challenge) => challenge.status === "open" || challenge.status === "resolving");
      if (list.length === 0) return;
      const posted = yield* verifyWith(workspace, project, list, yield* entriesNow(checkout, list));
      if (posted > 0) yield* deps.cache.refresh(workspace);
    });

  const list = (input: PeerHubCandidatesInput) =>
    Effect.gen(function* () {
      yield* servedOrFail;
      let challenges = yield* deps.hub.list(input.workspace, input.project);
      const store = yield* deps.storeOf(input.workspace, input.project).pipe(Effect.option);
      if (store._tag === "None") {
        deps.cache.put(input.workspace, input.project, challenges);
        const why = "This project keeps no knowledge on this computer.";
        return {
          rows: challenges.map((challenge) => ({ challenge, current: null, changed: false })),
          replace: off(why),
          retire: off(why),
          entries: [],
        } satisfies PeerKnowledgeChallenges;
      }
      const { checkout, llm } = store.value;
      const now = yield* entriesNow(checkout, challenges);
      if ((yield* verifyWith(input.workspace, input.project, challenges, now)) > 0)
        challenges = yield* deps.hub.list(input.workspace, input.project);
      deps.cache.put(input.workspace, input.project, challenges);
      const ops = yield* opsIn(checkout);
      const rows = challenges.map((challenge): PeerChallengeRow => {
        const found = now.get(challenge.entry);
        const entry = found?.entry;
        return {
          challenge,
          current:
            entry === undefined
              ? null
              : {
                  title: entry.title,
                  kind: entry.kind,
                  file: entry.file,
                  summary: entry.summary,
                  body: entry.body,
                  ...(entry.status === undefined ? {} : { status: entry.status }),
                  ...(entry.revision === undefined ? {} : { revision: entry.revision }),
                },
          changed:
            challenge.entryRevision !== undefined &&
            entry?.revision !== undefined &&
            challenge.entryRevision !== entry.revision,
        };
      });
      const book = yield* deps.book(checkout);
      return {
        rows,
        replace: !ops.has(REVISE)
          ? off(needsNewerKontext(REVISE))
          : llm
            ? on
            : off("Writing a replacement needs kontext's llm adapter on this computer."),
        retire: ops.has(RETIRE) ? on : off(needsNewerKontext(RETIRE)),
        entries: book.map((entry) => ({ id: entry.id, title: entry.title, kind: entry.kind })),
      } satisfies PeerKnowledgeChallenges;
    });

  const open = (input: PeerHubOpenChallengeInput) =>
    Effect.gen(function* () {
      yield* servedOrFail;
      // The revision a person challenged, when this checkout has the entry.
      const store = yield* deps.storeOf(input.workspace, input.project).pipe(Effect.option);
      const current =
        store._tag === "None"
          ? null
          : yield* Effect.tryPromise(() =>
              challengeActions(deps.kontext, store.value.checkout).current(input.entry),
            ).pipe(Effect.orElseSucceed(() => null));
      const opened = yield* deps.hub.open(input.workspace, input.project, {
        entry: input.entry,
        reason: input.reason,
        ...(current?.entry.revision === undefined ? {} : { entryRevision: current.entry.revision }),
      });
      yield* deps.cache.refresh(input.workspace);
      yield* deps.changed;
      return opened;
    });

  /** Stages through kontext, then tells the Hub; a Hub that fails after staging is retried by the person. */
  const staged = (
    input: PeerHubDecideChallengeInput,
    challenge: PeerKnowledgeChallenge,
    checkout: string,
  ) =>
    Effect.gen(function* () {
      const ops = yield* opsIn(checkout);
      const actions = challengeActions(deps.kontext, checkout);
      const kept = yield* Effect.tryPromise({
        try: async () => {
          if (input.decision === "retire") {
            if (!ops.has(RETIRE)) throw new ChallengeRefused(needsNewerKontext(RETIRE));
            return actions.retire({ challenge, seenRevision: input.seenRevision });
          }
          if (input.draft === undefined) throw new ChallengeRefused("Write the replacement first.");
          return actions.replace({
            challenge,
            draft: input.draft,
            seenRevision: input.seenRevision,
            source: `peer://knowledge/${encodeURIComponent(input.workspace)}/${encodeURIComponent(input.project)}/challenge/${encodeURIComponent(challenge.id)}`,
          });
        },
        catch: failed,
      });
      const revision =
        challenge.entryRevision === undefined
          ? (yield* Effect.tryPromise(() => actions.current(challenge.entry)).pipe(
              Effect.orElseSucceed(() => null),
            ))?.entry.revision
          : undefined;
      const decided = yield* deps.hub
        .decide(input.workspace, input.project, challenge.id, {
          status: "resolving",
          resolvedAs: kept,
          ...(revision === undefined ? {} : { entryRevision: revision }),
        })
        .pipe(
          Effect.mapError((error) =>
            hubError(
              `Staged ${kept.path} in ${checkout}, but the Hub did not take it: ${error.detail} Try again: nothing is staged twice.`,
            ),
          ),
        );
      return { challenge: decided, staged: { checkout, path: kept.path, title: kept.title } };
    });

  const decide = (input: PeerHubDecideChallengeInput) =>
    Effect.gen(function* () {
      yield* servedOrFail;
      const challenge = yield* challengeOf(input.workspace, input.project, input.id);
      const result =
        input.decision === "retire" || input.decision === "replace"
          ? yield* Effect.flatMap(deps.storeOf(input.workspace, input.project), (store) =>
              staged(input, challenge, store.checkout),
            )
          : {
              challenge: yield* Effect.gen(function* () {
                if (input.decision === "dismissed" || input.decision === "open")
                  return yield* deps.hub.decide(input.workspace, input.project, challenge.id, {
                    status: input.decision,
                  });
                // A person resolves what Peer cannot see: a change committed elsewhere, or an
                // entry this checkout does not have. The Hub resolves only what is resolving.
                if (challenge.status !== "resolving")
                  yield* deps.hub.decide(input.workspace, input.project, challenge.id, {
                    status: "resolving",
                    resolvedAs: challenge.resolvedAs ?? {
                      path: challenge.entry,
                      title: challenge.entry,
                      kind: "entry",
                    },
                  });
                return yield* deps.hub.decide(input.workspace, input.project, challenge.id, {
                  status: "resolved",
                });
              }),
              staged: null,
            };
      yield* deps.log("knowledge.challenge-decided", {
        workspace: input.workspace,
        project: input.project,
        challenge: challenge.id,
        decision: input.decision,
        ...(result.staged === null ? {} : { staged: result.staged.path }),
      });
      yield* deps.cache.refresh(input.workspace);
      yield* deps.changed;
      return result;
    });

  const draft = (input: PeerHubChallengeInput) =>
    Effect.gen(function* () {
      yield* servedOrFail;
      const store = yield* deps.storeOf(input.workspace, input.project);
      const ops = yield* opsIn(store.checkout);
      if (!ops.has(REVISE)) return yield* hubError(needsNewerKontext(REVISE));
      if (!store.llm)
        return yield* hubError(
          "Writing a replacement needs kontext's llm adapter on this computer.",
        );
      const challenge = yield* challengeOf(input.workspace, input.project, input.id);
      return yield* Effect.tryPromise({
        try: () =>
          challengeActions(deps.kontext, store.checkout).draft(challenge, input.seenRevision),
        catch: failed,
      });
    });

  const relatedSeen = new Map<string, PeerKnowledgeRelations>();
  /** How a candidate relates to kept entries; asked once per candidate text and book. */
  const related = (input: PeerHubCandidateInput) =>
    Effect.gen(function* () {
      const store = yield* deps.storeOf(input.workspace, input.project);
      const ops = yield* opsIn(store.checkout);
      if (!ops.has(RELATED))
        return {
          relations: [],
          unavailable: needsNewerKontext(RELATED),
        } satisfies PeerKnowledgeRelations;
      const candidate = (yield* deps.candidates(input.workspace, input.project)).find(
        (one) => one.id === input.id,
      );
      if (candidate === undefined) return yield* hubError("That candidate is no longer there.");
      const book = yield* deps.book(store.checkout);
      const key = NodeCrypto.createHash("sha256")
        .update(JSON.stringify([candidate.text, book.map((entry) => entry.revision ?? entry.id)]))
        .digest("hex");
      const held = relatedSeen.get(key);
      if (held !== undefined) return held;
      const titles = new Map(book.map((entry) => [entry.id, entry.title]));
      const answer = yield* Effect.tryPromise({
        try: () =>
          kontextApi<{ related?: unknown; entries?: unknown }>(
            deps.kontext,
            store.checkout,
            RELATED,
            {
              text: candidate.text,
              paths: candidate.paths ?? [],
              limit: 3,
              llm: store.llm,
            },
          ),
        catch: failed,
      });
      const rows = Array.isArray(answer.related)
        ? answer.related
        : Array.isArray(answer.entries)
          ? answer.entries
          : [];
      const relations = rows.flatMap((row: unknown) => {
        if (typeof row !== "object" || row === null) return [];
        const record = row as Record<string, unknown>;
        const nested = record.entry as Record<string, unknown> | undefined;
        const id = typeof record.id === "string" ? record.id : nested?.id;
        if (typeof id !== "string") return [];
        const title = typeof record.title === "string" ? record.title : nested?.title;
        return [
          {
            entry: id,
            title: typeof title === "string" ? title : (titles.get(id) ?? id),
            relation: typeof record.relation === "string" ? record.relation : "related",
            reason: typeof record.reason === "string" ? record.reason : "",
          },
        ];
      });
      const result = { relations, unavailable: null } satisfies PeerKnowledgeRelations;
      if (relatedSeen.size >= 200) relatedSeen.delete(relatedSeen.keys().next().value!);
      relatedSeen.set(key, result);
      return result;
    });

  return { list, open, decide, draft, related, verify };
}

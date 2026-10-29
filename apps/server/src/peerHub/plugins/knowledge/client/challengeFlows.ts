// @effect-diagnostics nodeBuiltinImport:off globalDateInEffect:off preferSchemaOverJson:off - hashes what a candidate's relations are cached by; kontext's capabilities are asked again after a minute of wall-clock time.
/**
 * What people do with challenges from Peer's clients: a project's list with each entry as this
 * checkout has it, opening or seconding one, deciding one (dismiss, reopen, resolve), staging the
 * entry's retirement or a replacement, and drafting that replacement with kontext. Also a
 * candidate's relations to kept entries (`entries.related`), and the verification a refresh of a
 * project's book runs: a resolving challenge resolves only once a committed revision shows the
 * entry superseded, deprecated or confirmed. The same refresh files what kontext's drift found
 * once the project's default branch moved (`./drift.ts`).
 *
 * @module peerHub/plugins/knowledge/client/challengeFlows
 */
import * as NodeCrypto from "node:crypto";

import {
  PeerHubError,
  type PeerChallengeAction,
  type PeerChallengeRow,
  type PeerChallengedEntry,
  type PeerHubCandidateInput,
  type PeerHubCandidatesInput,
  type PeerHubChallengeInput,
  type PeerHubDecideChallengeInput,
  type PeerHubOpenChallengeInput,
  type PeerKnowledgeCandidate,
  type PeerKnowledgeChallenge,
  type PeerKnowledgeChallenges,
  type PeerKnowledgeEntryInput,
  type PeerKnowledgeRelations,
  type PeerKnowledgeVerified,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import {
  engineStatus,
  isKnowledgeIdentity,
  KontextApiError,
  kontextApi,
  type KontextClientShape,
  type KontextEntry,
} from "../../../kontext.ts";
import type { KnowledgeEntry } from "../../../knowledgeEntry.ts";
import {
  challengeUpdates,
  type ChallengeCache,
  type ChallengesHub,
  type EntryNow,
} from "./challenges.ts";
import {
  CONFIRM,
  confirmEntry,
  driftBody,
  driftReason,
  driftWatch,
  entriesDrift,
  checkOutcome,
  localGit,
  UNCHECKED,
  VERIFY,
  VERIFY_RUNS,
  verifyEntry,
  type DriftEntry,
  type DriftGit,
} from "./drift.ts";
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
  /** Whether the signed-in Hub takes drift challenges and confirmations (revision 3); not by default. */
  readonly servesDrift?: Effect.Effect<boolean>;
  readonly git?: DriftGit;
}

/** How an entry was verified and what changed since, as kontext's ledger says; nothing from an older kontext. */
const provenance = (entry: KnowledgeEntry) => ({
  ...(entry.verification === undefined ? {} : { verification: entry.verification }),
  ...(entry.since === undefined ? {} : { since: entry.since }),
  ...(entry.verify === undefined ? {} : { verify: entry.verify }),
  ...(entry.premises === undefined ? {} : { premises: entry.premises }),
});

const off = (reason: string): PeerChallengeAction => ({ available: false, reason });
const on: PeerChallengeAction = { available: true, reason: null };

/** kontext's own words for why it refused, or Peer's for a challenge it would not act on. */
const failed = (error: unknown) =>
  hubError(error instanceof ChallengeRefused ? error.message : messageOf(error));

export function challengeFlows(deps: FlowDeps) {
  const servesDrift = deps.servesDrift ?? Effect.succeed(false);
  const git = deps.git ?? localGit;
  const watch = driftWatch();
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
              checked: found.entry.checked,
              verification: found.entry.verification,
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

  /**
   * Runs an entry's own check before its drift is filed, when kontext can and the entry names one:
   * what it came to, or unchecked (no command, no `drafts.verify`, a check that could not run).
   */
  const checkBefore = (checkout: string, entry: DriftEntry, canVerify: boolean) =>
    Effect.gen(function* () {
      const command = entry.verify;
      if (!canVerify || command === undefined) return UNCHECKED;
      const ran = yield* Effect.tryPromise(() =>
        verifyEntry(deps.kontext, checkout, entry.id),
      ).pipe(Effect.option);
      return ran._tag === "None" ? UNCHECKED : checkOutcome(command, ran.value);
    });

  /**
   * Once the default branch moved since this checkout was last seen, one drift challenge per entry
   * kontext lists over the move; a kontext without drift files nothing. Before filing, an entry
   * that names a check has it run (`VERIFY_RUNS` at most, one after another): a pass files the challenge already
   * resolving as verified, its ledger line staged in the checkout, and a failure files it with what
   * the check said. Returns how many it filed.
   */
  const fileDrift = (workspace: string, project: string, checkout: string) =>
    Effect.gen(function* () {
      if (!(yield* servesDrift)) return 0;
      const head = yield* Effect.promise(() => git.defaultHead(checkout).catch(() => null));
      if (head === null) return 0;
      const place = `${workspace}\u0000${project}`;
      const at = `${place}\u0000${checkout}`;
      // Checks take minutes and the book is read each minute: a refresh during a filing leaves it.
      if (watch.busy(at)) return 0;
      watch.start(at);
      return yield* Effect.gen(function* () {
        const stored = watch.knows(at)
          ? null
          : yield* Effect.promise(() => git.checkedHead(checkout).catch(() => null));
        const range = watch.moved(at, head, stored);
        const reached = (sha: string) =>
          Effect.promise(() => git.setCheckedHead(checkout, sha).catch(() => undefined));
        if (range === "baseline") yield* reached(head);
        if (range === null || range === "baseline") return 0;
        const drift = yield* Effect.tryPromise(() =>
          entriesDrift(deps.kontext, checkout, { base: range.base, head }),
        ).pipe(Effect.option);
        // A read that failed is tried again at the next refresh, from the same base.
        if (drift._tag === "None") return 0;
        const entries = drift.value?.entries ?? [];
        const canVerify =
          entries.some((entry) => entry.verify !== undefined) &&
          (yield* opsIn(checkout)).has(VERIFY);
        const checks = { checked: 0, passed: 0, failed: 0, skipped: 0 };
        let filed = 0;
        let missed = 0;
        for (const entry of entries) {
          const key = `${place}\u0000${entry.id}`;
          if (watch.filed(key, head)) continue;
          let outcome = watch.checked(key, head);
          if (outcome === undefined) {
            const runs = checks.checked;
            outcome =
              runs < VERIFY_RUNS ? yield* checkBefore(checkout, entry, canVerify) : UNCHECKED;
            if (canVerify && entry.verify !== undefined) {
              if (runs < VERIFY_RUNS) checks.checked += 1;
              else checks.skipped += 1;
            }
            watch.check(key, head, outcome);
          }
          if (outcome.kind === "passed") checks.passed += 1;
          if (outcome.kind === "failed") checks.failed += 1;
          const failed = outcome.kind === "failed" ? outcome.check : null;
          const done = yield* deps.hub
            .open(workspace, project, {
              entry: entry.id,
              reason: driftReason(entry, failed),
              origin: "drift",
              drift: { ...driftBody(head, entry), ...(failed === null ? {} : { verify: failed }) },
            })
            .pipe(Effect.result);
          // A Hub that could not be reached is asked again; one that refused the filing is not.
          if (Result.isFailure(done) && done.failure.refused !== true) {
            missed += 1;
            continue;
          }
          if (Result.isSuccess(done) && outcome.kind === "passed" && done.success.status === "open")
            // A Hub that does not take it leaves the challenge open: the committed pass resolves it.
            yield* deps.hub
              .decide(workspace, project, done.success.id, {
                status: "resolving",
                resolvedAs: { path: entry.path, title: entry.title, kind: "verified" },
              })
              .pipe(Effect.ignore);
          watch.file(key, head);
          if (Result.isSuccess(done)) filed += 1;
        }
        if (missed === 0) {
          watch.reached(at, head);
          yield* reached(head);
        }
        if (drift.value === null) return 0;
        yield* deps.log("knowledge.drift-filed", {
          workspace,
          project,
          base: range.base,
          head,
          listed: entries.length,
          filed,
          missed,
        });
        if (checks.checked + checks.skipped + checks.passed + checks.failed > 0)
          yield* deps.log("knowledge.drift-verified", { workspace, project, head, ...checks });
        return filed;
      }).pipe(Effect.ensuring(Effect.sync(() => watch.finish(at))));
    });

  /** On a refresh of a checkout's book: what it says of the project's challenges, posted. */
  const verify = (workspace: string, project: string, checkout: string) =>
    Effect.gen(function* () {
      if (!(yield* deps.served)) return;
      deps.cache.want(workspace, project);
      if ((yield* fileDrift(workspace, project, checkout)) > 0) {
        yield* deps.cache.refresh(workspace);
        yield* deps.changed;
      }
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
          ...((yield* servesDrift) ? { confirm: off(why) } : {}),
          entries: [],
        } satisfies PeerKnowledgeChallenges;
      }
      const { checkout, llm } = store.value;
      const now = yield* entriesNow(checkout, challenges);
      if ((yield* verifyWith(input.workspace, input.project, challenges, now)) > 0)
        challenges = yield* deps.hub.list(input.workspace, input.project);
      deps.cache.put(input.workspace, input.project, challenges);
      const ops = yield* opsIn(checkout);
      const subjects = yield* Effect.promise(() =>
        git
          .subjects(
            checkout,
            challenges.flatMap((challenge) => challenge.drift?.commits ?? []),
          )
          .catch((): ReadonlyMap<string, string> => new Map()),
      );
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
                  ...(entry.checked === undefined ? {} : { checked: entry.checked }),
                },
          changed:
            challenge.entryRevision !== undefined &&
            entry?.revision !== undefined &&
            challenge.entryRevision !== entry.revision,
          ...(challenge.drift === undefined
            ? {}
            : {
                commits: challenge.drift.commits.flatMap((sha) => {
                  const subject = subjects.get(sha);
                  return subject === undefined ? [] : [{ sha, subject }];
                }),
              }),
        };
      });
      const book = yield* deps.book(checkout);
      const query = (input.query ?? "").trim().toLocaleLowerCase();
      // The engine owns content/path matching; intersect with the authorized active checkout.
      const search =
        query === ""
          ? { entries: [] as KontextEntry[], total: 0 }
          : yield* Effect.tryPromise({
              try: () =>
                kontextApi<{ entries: KontextEntry[]; total: number }>(
                  deps.kontext,
                  checkout,
                  "entries.search",
                  { query, limit: 100, active_only: true },
                ),
              catch: failed,
            });
      const hitById = new Map(search.entries.map((entry) => [entry.id, entry]));
      const matching = query === "" ? book : book.filter((entry) => hitById.has(entry.id));
      return {
        rows,
        replace: !ops.has(REVISE)
          ? off(needsNewerKontext(REVISE))
          : llm
            ? on
            : off("Writing a replacement needs kontext's llm adapter on this computer."),
        retire: ops.has(RETIRE) ? on : off(needsNewerKontext(RETIRE)),
        ...((yield* servesDrift)
          ? { confirm: ops.has(CONFIRM) ? on : off(needsNewerKontext(CONFIRM, "0.4.0")) }
          : {}),
        searchLimited: search.total > 100,
        entries: matching.map((entry) => ({
          id: entry.id,
          title: entry.title,
          kind: entry.kind,
          summary: entry.summary.slice(0, 320),
          paths: entry.paths,
          tags: entry.tags,
          snippet: (() => {
            const text = (hitById.get(entry.id)?.body || entry.body || entry.summary)
              .replace(/\s+/g, " ")
              .trim();
            const match = query === "" ? 0 : Math.max(0, text.toLocaleLowerCase().indexOf(query));
            const start = Math.max(0, match - 70);
            return `${start > 0 ? "…" : ""}${text.slice(start, start + 240)}${text.length > start + 240 ? "…" : ""}`;
          })(),
          ...(entry.checked === undefined ? {} : { checked: entry.checked }),
          ...provenance(entry),
        })),
      } satisfies PeerKnowledgeChallenges;
    });

  const entry = (input: PeerKnowledgeEntryInput) =>
    Effect.gen(function* () {
      const store = yield* deps.storeOf(input.workspace, input.project);
      const current = yield* Effect.tryPromise({
        try: () => challengeActions(deps.kontext, store.checkout).current(input.entry),
        catch: failed,
      });
      if (current === null) return null;
      const saved = current.entry;
      return {
        title: saved.title,
        kind: saved.kind,
        file: saved.file,
        summary: saved.summary,
        body: saved.body,
        ...(saved.status === undefined ? {} : { status: saved.status }),
        ...(saved.revision === undefined ? {} : { revision: saved.revision }),
        ...(saved.checked === undefined ? {} : { checked: saved.checked }),
        ...provenance(saved),
        ...(current.trail === undefined ? {} : { trail: current.trail }),
      } satisfies PeerChallengedEntry;
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
          if (input.decision === "confirmed") {
            if (!ops.has(CONFIRM)) throw new ChallengeRefused(needsNewerKontext(CONFIRM, "0.4.0"));
            const now = await actions.actionable(challenge, input.seenRevision);
            const confirmed = await confirmEntry(
              deps.kontext,
              checkout,
              challenge.entry,
              input.because,
            );
            return { path: confirmed.path, title: now.entry.title, kind: "confirmed" };
          }
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
      if (input.decision === "confirmed" && !(yield* servesDrift))
        return yield* new PeerHubError({
          detail: "This Hub does not take confirmations of knowledge yet.",
          kind: "unsupported",
          refused: true,
        });
      const result =
        input.decision === "retire" ||
        input.decision === "replace" ||
        input.decision === "confirmed"
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
      // The model names the relation where kontext has one; without one, entries that read alike.
      const ask = (llm: boolean) =>
        kontextApi<{ relations?: unknown; candidates?: unknown }>(
          deps.kontext,
          store.checkout,
          RELATED,
          { text: candidate.text, paths: candidate.paths ?? [], ...(llm ? { llm: true } : {}) },
          llm ? 600_000 : undefined,
        );
      const answer = yield* Effect.tryPromise({
        try: () =>
          ask(store.llm).catch((error: unknown) => {
            if (error instanceof KontextApiError && error.code === "model_unavailable")
              return ask(false);
            throw error;
          }),
        catch: failed,
      });
      const rows = [
        ...(Array.isArray(answer.relations) ? answer.relations : []),
        ...(Array.isArray(answer.candidates) ? answer.candidates : []),
      ];
      // The model's relations name an entry only; its kind and the revision it was compared at
      // come with the candidate rows, which adding to it re-checks.
      const compared = new Map<string, Record<string, unknown>>();
      for (const row of Array.isArray(answer.candidates) ? answer.candidates : [])
        if (typeof row === "object" && row !== null && typeof row.id === "string")
          compared.set(row.id, row as Record<string, unknown>);
      const seen = new Set<string>();
      const relations = rows
        .flatMap((row: unknown) => {
          if (typeof row !== "object" || row === null) return [];
          const record = row as Record<string, unknown>;
          const id = record.id;
          // `new` names no entry; an entry is named once, by the model when it answered.
          if (typeof id !== "string" || seen.has(id)) return [];
          seen.add(id);
          const relation = typeof record.relation === "string" ? record.relation : "related";
          const reason = [record.reason, record.label].find((text) => typeof text === "string");
          const known = (key: string) => {
            const value = record[key] ?? compared.get(id)?.[key];
            return typeof value === "string" && value !== "" ? { [key]: value } : {};
          };
          return [
            {
              entry: id,
              title: typeof record.title === "string" ? record.title : (titles.get(id) ?? id),
              relation,
              reason: typeof reason === "string" ? reason : "",
              ...known("revision"),
              ...known("kind"),
            },
          ];
        })
        .slice(0, 5);
      const result = { relations, unavailable: null } satisfies PeerKnowledgeRelations;
      if (relatedSeen.size >= 200) relatedSeen.delete(relatedSeen.keys().next().value!);
      relatedSeen.set(key, result);
      return result;
    });

  /**
   * Runs an entry's own check in the project's checkout here; kontext records the outcome in its
   * ledger, which the entry's health reads next. Needs no Hub: the check and its record are local.
   */
  const verifyCheck = (input: PeerKnowledgeEntryInput) =>
    Effect.gen(function* () {
      if (!isKnowledgeIdentity(input.entry)) return yield* hubError("That entry cannot be named.");
      const store = yield* deps.storeOf(input.workspace, input.project);
      const verified: PeerKnowledgeVerified = yield* Effect.tryPromise({
        try: () => verifyEntry(deps.kontext, store.checkout, input.entry),
        catch: failed,
      });
      yield* deps.log("knowledge.entry-verified", {
        workspace: input.workspace,
        project: input.project,
        entry: input.entry,
        ...(verified.available
          ? { passed: verified.passed, exitCode: verified.exitCode, commit: verified.commit }
          : { available: false }),
      });
      return verified;
    });

  return { list, entry, open, decide, draft, related, verify, verifyCheck };
}

// @effect-diagnostics preferSchemaOverJson:off - the JSON text is only a stable key for what was already told.
/**
 * Knowledge: a project's reviewed knowledge (kontext, `.ai/` in its repository), for its agents
 * and for its people.
 *
 * An agent's index names the entries that stand in its checkout, `peer knowledge` lists, searches
 * and reads them, and an entry whose paths name a file the agent changes says so, once: a fact
 * about the file, as a lock is. A repository's `.ai` is read at most once a minute, and a step
 * waits for the read only a moment. A session's start carries the project's guidance on what to
 * mark [project].
 *
 * What agents mark for the project becomes a candidate on the Hub, weighed by independent finders.
 * A person dismisses it or keeps it; keeping writes it into the project's knowledge with kontext,
 * staged for the next commit. kontext also reads a shared context for what to keep, and proposes
 * the project's guidance from what people kept and dismissed.
 *
 * @module peerHub/plugins/knowledge/Knowledge
 */
import {
  PeerHubError,
  type PeerChallengeDecided,
  type PeerChallengeDrafted,
  type PeerChallengedEntry,
  type PeerHubCandidateInput,
  type PeerHubChallengeInput,
  type PeerHubDecideChallengeInput,
  type PeerHubOpenChallengeInput,
  type PeerKnowledgeChallenge,
  type PeerKnowledgeChallenges,
  type PeerKnowledgeEntryInput,
  type PeerKnowledgeRelations,
  type PeerHubCandidatesInput,
  type PeerHubDecideCandidateInput,
  type PeerHubHarvestInput,
  type PeerHubKeepCandidateInput,
  type PeerHubStatus,
  type PeerKeptCandidate,
  type PeerKnowledgeCandidate,
  type PeerKnowledgeStatus,
  type PeerStagedEntry,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import type { PeerHubListener, PeerIndexEntry, PeerSessionView } from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { clip, sinceText } from "../../peerText.ts";
import {
  asKnowledge,
  isKnowledgeIdentity,
  KontextApiError,
  kontextApi,
  type KontextEntry,
} from "../../kontext.ts";
import { KontextClient, kontextIn } from "./client/kontext.ts";
import { projectGuidance, readKnowledge, storesOn } from "./client/store.ts";
import { knowledgeHub } from "./client/hub.ts";
import { challengeFlows } from "./client/challengeFlows.ts";
import {
  CHALLENGES_REVISION,
  challengeCache,
  challengeKey,
  challengesHub,
  isOpen,
  reasonsOf,
} from "./client/challenges.ts";
import { keepingFlows } from "./client/keeping.ts";
import {
  entryText,
  governingText,
  known,
  knowledgeIndexText,
  knowledgeLine,
  projectGuidanceText,
  reasonsText,
  standing,
  whenItNoLongerHolds,
  type Governing,
  type Known,
} from "./knowledgeIndex.ts";

/** What agents type. */
const CLI = "peer";
/** A repository's `.ai` is read again after this long (`PEER_KNOWLEDGE_FRESH_MS`); a step waits for the read this long at most. */
const FRESH_MS = Number(process.env.PEER_KNOWLEDGE_FRESH_MS) || 60_000;
const READ_WAIT_MS = 400;
/** A computer's agents work in a handful of repositories: past this many, the oldest read goes. */
const SHELVES = 24;
/** How many of the files an agent changes are checked against `.ai`. */
const TOUCHING_KEPT = 100;
/** How many entries a step says govern what the agent changes; the rest come at the next. */
const GOVERNING_TOLD = 3;
/**
 * One budget of knowledge per session (tokens, about four characters each): what a start may carry
 * of Peer's and kontext's together, what Peer's own coordination text takes of it, and what a step
 * with a new governing entry or challenge adds. A step with nothing new adds nothing.
 */
const START_TOKENS = Number(process.env.PEER_KNOWLEDGE_START_TOKENS) || 1500;
const CORE_TOKENS = Number(process.env.PEER_KNOWLEDGE_CORE_TOKENS) || 300;
const STEP_TOKENS = Number(process.env.PEER_KNOWLEDGE_STEP_TOKENS) || 400;
/** How many entries a start's index names (core's `KNOWLEDGE_SHOWN`). */
const START_SHOWN = 20;
const tokensOf = (text: string | null) => Math.ceil((text ?? "").length / 4);
/** What a session was told of an entry: its id at the version told. */
const toldKey = (entry: { readonly id: string; readonly revision?: string | undefined }) =>
  entry.revision === undefined ? entry.id : `${entry.id}@${entry.revision}`;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A repository's `.ai` as last read, and the read in flight. */
interface Shelf {
  readonly at: number;
  readonly error: string | undefined;
  readonly book: ReadonlyArray<Known>;
  readonly reading: Deferred.Deferred<void> | undefined;
}

/** What an agent was told of the project's `.ai` (its session's plugin state). */
interface Told {
  /** The files it changes or is about to, as far as Peer saw: what the project's `.ai` may govern. */
  readonly touching: Set<string>;
  /** What was checked last: nothing new to check, nothing to say. */
  checked: number;
  book: ReadonlyArray<Known> | undefined;
  /** The entries it was told of or read (`toldKey`), and the challenges (`challengeKey`). */
  readonly entries: Set<string>;
  /** The version of its project's challenges it was checked against. */
  disputes: number;
  pending:
    | {
        readonly key: string;
        readonly book: ReadonlyArray<Known>;
        readonly request: Promise<ReadonlyArray<{
          entry: KontextEntry;
          pattern: string;
          path: string;
        }> | null>;
      }
    | undefined;
}

export class Knowledge extends Context.Service<
  Knowledge,
  {
    /** The entries that stand in a session's checkout, newest first. */
    readonly entries: (session: PeerSessionView) => Effect.Effect<ReadonlyArray<PeerIndexEntry>>;
    /**
     * A session's start: the project's guidance on what to mark [project] and what kontext's brief
     * may add to it; after a compaction, the entries that govern the files it works on again.
     */
    readonly guidance: (session: PeerSessionView, source?: string) => Effect.Effect<string | null>;
    /**
     * What the project's `.ai` says governs the files a session changes, each entry once; `paths`
     * are those it changes, or is about to, now.
     */
    readonly governs: (
      session: PeerSessionView,
      paths: ReadonlyArray<string>,
    ) => Effect.Effect<string | null>;
    /** `peer knowledge [<id or words>]`: the entries, a search of them, or one of them. */
    readonly read: (session: PeerSessionView, query: string) => Effect.Effect<string>;
    /** How many candidates wait for people, per project, as the coordination views last said. */
    readonly waiting: Effect.Effect<
      ReadonlyArray<{
        readonly workspace: string;
        readonly project: string;
        readonly proposed: number;
      }>
    >;
    /** What agents found that a project may want to keep, weighed by independent finders. */
    readonly candidates: (
      input: PeerHubCandidatesInput,
    ) => Effect.Effect<ReadonlyArray<PeerKnowledgeCandidate>, PeerHubError>;
    /** A person dismisses a candidate, promotes it, or proposes it again. */
    readonly decide: (
      input: PeerHubDecideCandidateInput,
    ) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** A project's knowledge on this computer: its checkout, kontext there, its guidance. */
    readonly status: (
      input: PeerHubCandidatesInput,
    ) => Effect.Effect<PeerKnowledgeStatus, PeerHubError>;
    /** Runs `kontext init` in the project's checkout here. */
    readonly setup: (
      input: PeerHubCandidatesInput,
    ) => Effect.Effect<PeerKnowledgeStatus, PeerHubError>;
    /** Writes a candidate into the project's knowledge, staged, and marks it kept for everyone. */
    /** Writes a candidate into the knowledge, staged, in the person's words when they edited it. */
    readonly keep: (
      input: PeerHubKeepCandidateInput,
    ) => Effect.Effect<PeerKeptCandidate, PeerHubError>;
    /** Reads a shared context with kontext for what the project should keep, and proposes it. */
    readonly harvest: (
      input: PeerHubHarvestInput,
    ) => Effect.Effect<{ readonly proposed: number }, PeerHubError>;
    /** Proposes the project's guidance for its agents from what people kept and dismissed. */
    readonly improve: (
      input: PeerHubCandidatesInput,
    ) => Effect.Effect<PeerStagedEntry, PeerHubError>;
    /** Follows `coord` pings: the projects' challenges agents hear of are read again. */
    readonly hubChanges: PeerHubListener;
    readonly challenges: (
      input: PeerHubCandidatesInput,
    ) => Effect.Effect<PeerKnowledgeChallenges, PeerHubError>;
    readonly entry: (
      input: PeerKnowledgeEntryInput,
    ) => Effect.Effect<PeerChallengedEntry | null, PeerHubError>;
    readonly openChallenge: (
      input: PeerHubOpenChallengeInput,
    ) => Effect.Effect<PeerKnowledgeChallenge, PeerHubError>;
    readonly decideChallenge: (
      input: PeerHubDecideChallengeInput,
    ) => Effect.Effect<PeerChallengeDecided, PeerHubError>;
    readonly draftReplacement: (
      input: PeerHubChallengeInput,
    ) => Effect.Effect<PeerChallengeDrafted, PeerHubError>;
    readonly related: (
      input: PeerHubCandidateInput,
    ) => Effect.Effect<PeerKnowledgeRelations, PeerHubError>;
  }
>()("t3/peerHub/plugins/knowledge/Knowledge") {}

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const client = yield* PeerHubClient.PeerHubClient;
  const agents = yield* PeerAgents.PeerAgents;
  const work = yield* PeerWork.PeerWork;
  const status = yield* PeerStatus.PeerStatus;
  const kontext = yield* KontextClient;
  const scope = yield* Effect.scope;
  const hub = knowledgeHub(client, (count) =>
    agents.log("knowledge.candidates-skipped", { count }),
  );

  const shelves = new Map<string, Shelf>();
  const challengesApi = challengesHub(client);
  const cache = challengeCache(challengesApi.list);
  const servesChallenges = Effect.map(
    client.features,
    (features) => (features.knowledge ?? 0) >= CHALLENGES_REVISION,
  );
  /** Where each project's agents work here: its book's refresh checks the project's challenges. */
  const at = new Map<string, string>();

  const readBook = (root: string, before: ReadonlyArray<Known>) =>
    Effect.tryPromise({ try: () => readKnowledge(root, kontext), catch: messageOf }).pipe(
      Effect.map((entries) => entries.map(known)),
      Effect.tap((book) =>
        book.length === before.length
          ? Effect.void
          : agents.log("knowledge.read", { root, entries: book.length }),
      ),
      Effect.map((book) => ({ book, error: undefined as string | undefined })),
      Effect.catch((error) =>
        agents.log("knowledge.failed", { root, error }).pipe(Effect.as({ book: before, error })),
      ),
    );

  /** A repository's `.ai`, read again when old; a step waits for the read only a moment. */
  const bookOf = (root: string, waitMs = READ_WAIT_MS) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      // Looked at and started at once, so two steps never read one repository twice.
      const reading = yield* Effect.suspend(
        (): Effect.Effect<Deferred.Deferred<void> | undefined> => {
          const have = shelves.get(root);
          if (have?.reading !== undefined) return Effect.succeed(have.reading);
          if (have !== undefined && now - have.at < FRESH_MS) return Effect.succeed(undefined);
          if (have === undefined && shelves.size >= SHELVES) {
            const oldest = [...shelves].toSorted(([, a], [, b]) => a.at - b.at)[0];
            if (oldest !== undefined) shelves.delete(oldest[0]);
          }
          const before = have?.book ?? [];
          const done = Deferred.makeUnsafe<void>();
          shelves.set(root, { at: have?.at ?? 0, book: before, error: have?.error, reading: done });
          return readBook(root, before).pipe(
            Effect.flatMap(({ book, error }) =>
              Effect.map(Clock.currentTimeMillis, (now) => {
                shelves.set(root, { at: now, book, error, reading: undefined });
              }),
            ),
            Effect.ensuring(Deferred.succeed(done, undefined)),
            // A new read of the book may show a challenged entry superseded in a commit.
            Effect.andThen(
              Effect.suspend(() =>
                Effect.forEach(
                  [...at].filter(([, where]) => where === root),
                  ([key]) => {
                    const [workspace = "", project = ""] = key.split("\u0000");
                    return flows.verify(workspace, project, root).pipe(Effect.ignore);
                  },
                  { discard: true },
                ),
              ),
            ),
            Effect.forkIn(scope),
            Effect.as(done),
          );
        },
      );
      // A slow disk costs the agent one telling, not a stalled hook.
      if (reading !== undefined) yield* Deferred.await(reading).pipe(Effect.timeoutOption(waitMs));
      return shelves.get(root)?.book ?? [];
    });

  const toldOf = (session: PeerSessionView) =>
    session.local("knowledge", (): Told => ({
      touching: new Set(),
      checked: 0,
      book: undefined,
      // Kept by core across Peer's restarts: an entry told, or read, is not said again.
      entries: session.told?.("knowledge") ?? new Set(),
      disputes: 0,
      pending: undefined,
    }));

  /** Told of this version: an older Peer kept only the id, which stands for the version it has now. */
  const toldThis = (
    told: Set<string>,
    entry: { readonly id: string; readonly revision?: string | undefined },
  ) => told.has(toldKey(entry)) || told.has(entry.id);
  /** Told of another version before. */
  const toldBefore = (told: Set<string>, id: string) =>
    [...told].some((key) => key.startsWith(`${id}@`));
  /** Keeps only the newest of what was told of an entry (or of its challenge, by `prefix`). */
  const remember = (told: Set<string>, prefix: string, key: string) => {
    for (const old of told) if (old === prefix || old.startsWith(`${prefix}@`)) told.delete(old);
    told.add(key);
  };

  /** The open challenges of a session's project, as last read (no I/O); none on an older Hub. */
  const disputesOf = (session: PeerSessionView, serves: boolean) =>
    Effect.gen(function* () {
      if (!serves || session.public === true) return [];
      at.set(`${session.workspace}\u0000${session.project}`, session.root);
      // A step waits a moment for a read of its project's challenges, as for its book.
      const first = cache.want(session.workspace, session.project)
        ? Fiber.await(yield* Effect.forkIn(cache.refresh(session.workspace), scope))
        : cache.settled(session.workspace, session.project);
      yield* Effect.timeoutOption(first, READ_WAIT_MS);
      return cache.of(session.workspace, session.project).filter(isOpen);
    });

  /** A challenge told to a session: its sources are heard, and said again only when it grows. */
  const tellChallenge = (
    session: PeerSessionView,
    told: Told,
    challenge: PeerKnowledgeChallenge,
  ) => {
    session.hear?.(challenge.sources.map((source) => source.finding));
    remember(told.entries, `${challenge.entry}#challenge`, challengeKey(challenge));
  };

  const governs: Knowledge["Service"]["governs"] = (session, paths) =>
    Effect.gen(function* () {
      const book = yield* bookOf(session.root);
      const told = toldOf(session);
      for (const file of [...session.files, ...paths]) {
        if (told.touching.size >= TOUCHING_KEPT) break;
        told.touching.add(file);
      }
      const serves = yield* servesChallenges;
      const challenges = yield* disputesOf(session, serves);
      const disputes = cache.version(session.workspace, session.project);
      if (
        book.length === 0 ||
        (told.touching.size === told.checked && book === told.book && disputes === told.disputes)
      ) {
        return null;
      }
      const key = JSON.stringify({ paths: [...told.touching].toSorted() });
      if (told.pending?.key !== key || told.pending.book !== book) {
        told.pending = {
          key,
          book,
          request: kontextApi<{
            matches: Array<{ entry: KontextEntry; pattern: string; path: string }>;
          }>(kontext, session.root, "entries.governing", {
            paths: [...told.touching],
            min_specificity: 3,
            limit: 5000,
          })
            .then((value) => value.matches)
            .catch(() => null),
        };
      }
      const pending = told.pending.request;
      const result = yield* Effect.promise(() => pending).pipe(Effect.timeoutOption(READ_WAIT_MS));
      if (result._tag === "None" || result.value === null) return null;
      told.checked = told.touching.size;
      told.book = book;
      told.disputes = disputes;
      const against = new Map(challenges.map((challenge) => [challenge.entry, challenge]));
      const unique = new Map<string, Governing & { challenge?: PeerKnowledgeChallenge }>();
      for (const match of result.value) {
        if (!isKnowledgeIdentity(match.entry.id) || unique.has(match.entry.id)) continue;
        const entry = asKnowledge(match.entry);
        const challenge = against.get(entry.id);
        const newChallenge = challenge !== undefined && !told.entries.has(challengeKey(challenge));
        if (toldThis(told.entries, entry) && !newChallenge) continue;
        unique.set(entry.id, {
          entry,
          pattern: match.pattern,
          path: match.path,
          changed: !toldThis(told.entries, entry) && toldBefore(told.entries, entry.id),
          ...(challenge === undefined
            ? {}
            : {
                challenge,
                disputed: { finders: challenge.finders, people: challenge.people.length },
              }),
        });
      }
      const all = [...unique.values()].toSorted((a, b) =>
        (b.entry.date ?? "").localeCompare(a.entry.date ?? ""),
      );
      const said = governingText(all.slice(0, GOVERNING_TOLD), CLI, {
        challenges: serves,
        maxChars: STEP_TOKENS * 4,
      });
      if (said === null) return null;
      const found = all.slice(0, said.shown);
      // Those left over are said at the next step.
      if (all.length > found.length) told.checked = -1;
      for (const { entry, pattern, path, challenge } of found) {
        remember(told.entries, entry.id, toldKey(entry));
        if (challenge !== undefined) tellChallenge(session, told, challenge);
        yield* agents.advise(session.id, {
          about: "knowledge",
          scope: `kx:${entry.id}`,
          name: entry.title,
          how: "governs",
          why: `it governs \`${pattern}\`, and you change \`${path}\``,
          entryKind: entry.kind,
          path: entry.file,
        });
      }
      yield* agents.log("knowledge.governs", {
        session: session.id,
        entries: found.map(({ entry, pattern, path, challenge }) => ({
          id: entry.id,
          revision: entry.revision,
          pattern,
          path,
          ...(challenge === undefined ? {} : { challenge: challenge.id }),
        })),
        text: said.text,
        tokens: tokensOf(said.text),
      });
      return said.text;
    });

  const read: Knowledge["Service"]["read"] = (session, query) =>
    Effect.gen(function* () {
      const book = yield* bookOf(session.root, 15_000);
      const shelf = shelves.get(session.root);
      if (book.length === 0 && shelf?.reading !== undefined)
        return "peer: project knowledge is still loading from kontext; try again shortly.";
      if (book.length === 0 && shelf?.error !== undefined)
        return "peer: project knowledge is unavailable. Check the compatible kontext installation (KONTEXT_BIN).";
      const cached =
        shelf?.error === undefined
          ? ""
          : "\n\nShowing the last successful knowledge index; kontext is currently unavailable.";
      if (book.length === 0) {
        return "peer: this checkout has no project knowledge entries.";
      }
      if (query === "") {
        return (
          (knowledgeIndexText(book, { cli: CLI, shown: 40 }) ??
            "peer: no project knowledge entries are active.") + cached
        );
      }
      const result = yield* Effect.tryPromise(async () => {
        const exact = await kontextApi<{ entry: KontextEntry }>(
          kontext,
          session.root,
          "entries.get",
          { id: query },
        ).catch((error) => {
          if (error instanceof KontextApiError && error.code === "not_found") return null;
          throw error;
        });
        return exact === null
          ? kontextApi<{ entries: KontextEntry[] }>(kontext, session.root, "entries.search", {
              query,
              limit: 15,
              active_only: true,
            })
          : { entries: [exact.entry] };
      }).pipe(Effect.option);
      if (result._tag === "None")
        return "peer: kontext could not search the project knowledge. Check the compatible kontext installation (KONTEXT_BIN).";
      const hits = result.value.entries
        .filter((entry) => isKnowledgeIdentity(entry.id))
        .map(asKnowledge);
      if (hits.length === 0) {
        return `peer: no entry matches "${clip(query, 80)}". ${CLI} knowledge lists them.`;
      }
      const [only] = hits;
      if (hits.length > 1 || only === undefined) {
        return [
          `Entries that match "${clip(query, 80)}" (\`${CLI} knowledge <id>\` reads one):`,
          ...hits.map((entry) => `- ${knowledgeLine(entry)}`),
        ].join("\n");
      }
      const serves = yield* servesChallenges;
      const challenge = (yield* disputesOf(session, serves)).find((open) => open.entry === only.id);
      let disputed = "";
      if (challenge !== undefined) {
        const now = yield* Clock.currentTimeMillis;
        const reasons = [];
        for (const source of reasonsOf(challenge).slice(0, 3)) {
          const who =
            source.session === "person"
              ? state.nameOf(session.workspace, source.email)
              : `an agent on ${source.task === undefined ? "work outside tasks" : yield* work.taskName(session.workspace, session.project, source.task)}`;
          reasons.push({ text: source.text, who, ago: sinceText(now - Date.parse(source.at)) });
        }
        disputed = `\n\n${reasonsText({ finders: challenge.finders, people: challenge.people.length }, reasons)}`;
        tellChallenge(session, toldOf(session), challenge);
      }
      if (session.public !== true) {
        remember(toldOf(session).entries, only.id, toldKey(only));
        yield* agents.log("knowledge.opened", { session: session.id, entry: only.id });
        yield* agents.advise(session.id, {
          about: "knowledge",
          scope: `kx:${only.id}`,
          name: only.title,
          how: "read",
          why: "read it",
          entryKind: only.kind,
          path: only.file,
        });
      }
      return `${entryText(only)}${disputed}\n\nThe project's people keep this in its knowledge store; check your change against it, and if it no longer holds, ${whenItNoLongerHolds(serves, only.id)}.`;
    });

  const guidance: Knowledge["Service"]["guidance"] = (session, source) =>
    Effect.gen(function* () {
      // A compacted conversation forgot what it was told: the entries governing the files it
      // works on are said again, the rest of the index is not.
      const told = toldOf(session);
      if (source === "compact") {
        told.entries.clear();
        told.checked = -1;
      }
      const again = source === "compact" ? yield* governs(session, []) : null;
      const found = yield* Effect.tryPromise(() => projectGuidance(session.root, kontext)).pipe(
        Effect.orElseSucceed(() => null),
      );
      const guided = found === null || found.text === "" ? null : projectGuidanceText(found.text);
      const book = yield* bookOf(session.root);
      if (book.length === 0)
        return [again, guided].filter((part) => part !== null).join("\n\n") || null;
      // One budget: kontext's brief gets what Peer's own start text leaves of it.
      const index = knowledgeIndexText(book, { cli: CLI, shown: START_SHOWN, titles: true });
      const spent = CORE_TOKENS + tokensOf(index) + tokensOf(guided) + tokensOf(again);
      const brief = Math.max(200, START_TOKENS - spent);
      yield* agents.log("knowledge.start-budget", {
        session: session.id,
        source: source ?? "startup",
        total: START_TOKENS,
        core: CORE_TOKENS,
        index: tokensOf(index),
        guidance: tokensOf(guided),
        repeated: tokensOf(again),
        brief,
      });
      return [
        again,
        `If you call kontext's ctx_brief, pass budget_tokens: ${brief}; Peer gave you about ${spent} tokens of the project's knowledge and work already.`,
        guided,
      ]
        .filter((part) => part !== null)
        .join("\n\n");
    });

  /** Wording entries with kontext's llm adapter runs on this person's own account; off for tests. */
  const knowledgeLlm = process.env.PEER_KNOWLEDGE_LLM !== "off";

  const { statusOf, checkoutOf, storeOf } = storesOn(state, kontext, knowledgeLlm, kontextIn);
  const flows = challengeFlows({
    hub: challengesApi,
    cache,
    kontext,
    served: servesChallenges,
    storeOf,
    book: (checkout) => Effect.map(bookOf(checkout, 15_000), standing),
    candidates: hub.candidates,
    changed: Effect.andThen(agents.hubChanged, status.publish).pipe(Effect.asVoid),
    log: agents.log,
  });

  const { decide, setup, keep, harvest, improve } = keepingFlows({
    state,
    client,
    agents,
    work,
    status,
    hub,
    statusOf,
    checkoutOf,
    storeOf,
  });

  return Knowledge.of({
    entries: (session) => Effect.map(bookOf(session.root), standing),
    guidance,
    governs,
    read,
    waiting: Effect.map(agents.hubViews, (views) =>
      views.flatMap(({ workspace, view }) =>
        (view.candidates ?? []).map(({ project, proposed }) => ({ workspace, project, proposed })),
      ),
    ),
    candidates: (input) => hub.candidates(input.workspace, input.project),
    decide,
    status: (input) => statusOf(input.workspace, input.project),
    setup,
    keep: (input) =>
      keep(input).pipe(Effect.tap((kept) => Effect.sync(() => shelves.delete(kept.checkout)))),
    harvest,
    improve,
    hubChanges: {
      changes: ["coord"],
      ownEcho: true,
      onPing: (ping) =>
        Effect.flatMap(servesChallenges, (serves) =>
          serves
            ? Effect.asVoid(
                Effect.suspend(() => Effect.forkIn(cache.refresh(ping.workspace), scope)),
              )
            : Effect.sync(cache.clear),
        ),
    },
    challenges: flows.list,
    entry: flows.entry,
    openChallenge: flows.open,
    decideChallenge: flows.decide,
    draftReplacement: flows.draft,
    related: flows.related,
  });
});

export const layer = Layer.effect(Knowledge, make);

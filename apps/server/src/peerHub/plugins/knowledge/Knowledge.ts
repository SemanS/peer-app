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
  type PeerKnowledgePreview,
  type PeerKnowledgePreviewInput,
  type PeerKnowledgeRelations,
  type PeerKnowledgeVerified,
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
import {
  CliError,
  refused,
  uncertain,
  type PeerCommandError,
  type PeerHubListener,
  type PeerIndexEntry,
  type PeerSessionView,
  type PeerToolContext,
  type PeerVerdict,
} from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { checkoutKind, runJj } from "../../core/vcs.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { clip, plain, sinceText } from "../../peerText.ts";
import {
  asKnowledge,
  engineStatus,
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
  challengedIn,
  DRIFT_REVISION,
  entriesDrift,
  reviewRefusal,
  verifyEntry,
} from "./client/drift.ts";
import { reviewChecks } from "./client/reviewChecks.ts";
import { trailerFlows, type PreparedTrailers } from "./client/trailers.ts";
import { captureAnswer, captureEntry, parseCapture } from "./client/capture.ts";
import { changeNotices } from "./client/changes.ts";
import {
  isHarnessMemoryPath,
  memoryPolicyOf,
  memoryRefusal,
  memoryStartLine,
} from "./client/memory.ts";
import {
  captureOf,
  isTestRun,
  proofNudge,
  wantsProof,
  withTestRun,
  type TestRun,
} from "./client/proof.ts";
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
/** Whom a preference goes to: the agent's person, named as the start text names them. */
const PERSON = "your person";
/** A repository's `.ai` is read again after this long (`PEER_KNOWLEDGE_FRESH_MS`); a step waits for the read this long at most. */
const FRESH_MS = Number(process.env.PEER_KNOWLEDGE_FRESH_MS) || 60_000;
const READ_WAIT_MS = 400;
/** What a step after a tool call may say (core's postTool budget). */
const POST_TOOL_MAX = 1200;
/** What a review keeps of its budget to answer after waiting for entries' checks. */
const REVIEW_MARGIN_MS = 1000;
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
  /** Its last test runs that did not fail, newest last: what a capture without a check is asked about. */
  tests: ReadonlyArray<TestRun>;
  /** Asking for a capture's proof, when the step that captured it had too much to say already. */
  proof: string | undefined;
  /** The knowledge trailers of the jj landing command about to run, for the step after it. */
  trailers: PreparedTrailers | undefined;
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
    /**
     * After a tool call: what governs the files it changed (`governs`), and, after a capture of a
     * learning or decision without a check, the test the agent ran that may prove it. At most 1,200
     * characters.
     */
    readonly afterTool: (ctx: PeerToolContext) => Effect.Effect<string | null>;
    /**
     * Before a shell command: in a jj checkout with a store, the knowledge trailers a `jj commit`,
     * `describe` or `squash` should carry, read from kontext for the step after it. Never a verdict.
     */
    readonly beforeShell: (ctx: PeerToolContext) => Effect.Effect<null>;
    /**
     * Before an edit: a write into the agent's harness memory (Claude Code's auto memory) on a
     * project whose agents keep none is refused in one line naming where the text belongs. Every
     * other edit passes without a word.
     */
    readonly beforeEdit: (ctx: PeerToolContext) => Effect.Effect<PeerVerdict | null>;
    /**
     * `peer capture`: a decision, convention or learning into the project's kontext inbox, the
     * candidate `ctx_capture` makes, for a person to promote and commit.
     */
    readonly capture: (
      session: PeerSessionView,
      args: ReadonlyArray<string>,
    ) => Effect.Effect<string, CliError | PeerCommandError>;
    /** Why `peer review` waits: entries the session's change drifted from, not settled yet. */
    readonly review: (
      session: PeerSessionView,
      remainingMs: number,
    ) => Effect.Effect<{ readonly reason: string; readonly next: string } | null>;
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
    /** What keeping a candidate one way would stage, drafted once per entry revision; writes nothing. */
    readonly preview: (
      input: PeerKnowledgePreviewInput,
    ) => Effect.Effect<PeerKnowledgePreview, PeerHubError>;
    /** Runs an entry's own check and records the outcome in kontext's ledger. */
    readonly verifyEntry: (
      input: PeerKnowledgeEntryInput,
    ) => Effect.Effect<PeerKnowledgeVerified, PeerHubError>;
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
  const servesDrift = Effect.map(
    client.features,
    (features) => (features.knowledge ?? 0) >= DRIFT_REVISION,
  );
  /** Where each project's agents work here: its book's refresh checks the project's challenges. */
  const at = new Map<string, string>();
  const changes = changeNotices({ kontext, agents, cli: CLI });

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
            // The same read follows the checkout's default branch for what landed in its knowledge:
            // a step waiting for the read hears of it at once, before drift's checks take minutes.
            Effect.andThen(Effect.promise(() => changes.refresh(root))),
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
      tests: [],
      proof: undefined,
      trailers: undefined,
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

  /** What governs the files, then what changed on the default branch, in one step's budget. */
  const governs: Knowledge["Service"]["governs"] = (session, paths) =>
    Effect.gen(function* () {
      const said = yield* governing(session, paths);
      const room = Math.min(STEP_TOKENS * 4, POST_TOOL_MAX) - (said === null ? 0 : said.length + 2);
      const book = yield* bookOf(session.root);
      const changed = yield* changes.notice(session, toldOf(session), book, room);
      return [said, changed].filter((part) => part !== null).join("\n\n") || null;
    });

  const governing = (session: PeerSessionView, paths: ReadonlyArray<string>) =>
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
      // Said once at the start: the environment and the refusal hold after a compaction too.
      const memory =
        source !== "compact" && (yield* memoryPolicy(session)) === "off"
          ? memoryStartLine(CLI, PERSON)
          : null;
      const found = yield* Effect.tryPromise(() => projectGuidance(session.root, kontext)).pipe(
        Effect.orElseSucceed(() => null),
      );
      const guided = found === null || found.text === "" ? null : projectGuidanceText(found.text);
      const book = yield* bookOf(session.root);
      if (book.length === 0)
        return [again, memory, guided].filter((part) => part !== null).join("\n\n") || null;
      // One budget: kontext's brief gets what Peer's own start text leaves of it.
      const index = knowledgeIndexText(book, { cli: CLI, shown: START_SHOWN, titles: true });
      const spent =
        CORE_TOKENS + tokensOf(index) + tokensOf(guided) + tokensOf(again) + tokensOf(memory);
      const brief = Math.max(200, START_TOKENS - spent);
      yield* agents.log("knowledge.start-budget", {
        session: session.id,
        source: source ?? "startup",
        total: START_TOKENS,
        core: CORE_TOKENS,
        index: tokensOf(index),
        guidance: tokensOf(guided),
        repeated: tokensOf(again),
        memory: tokensOf(memory),
        brief,
      });
      return [
        again,
        memory,
        `If you call kontext's ctx_brief, pass budget_tokens: ${brief}; Peer gave you about ${spent} tokens of the project's knowledge and work already.`,
        guided,
      ]
        .filter((part) => part !== null)
        .join("\n\n");
    });

  /** Wording entries with kontext's llm adapter runs on this person's own account; off for tests. */
  const knowledgeLlm = process.env.PEER_KNOWLEDGE_LLM !== "off";

  const checkReview = reviewChecks((checkout, id) => verifyEntry(kontext, checkout, id));

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
    servesDrift,
  });

  const { decide, setup, keep, preview, harvest, improve } = keepingFlows({
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

  /** Keeps a session's test runs, and asks a capture without a check for its proof, once. */
  const proofAfter = (ctx: PeerToolContext) =>
    Effect.gen(function* () {
      const told = toldOf(ctx.session);
      const now = yield* Clock.currentTimeMillis;
      if (
        ctx.tool === "Bash" &&
        ctx.command !== undefined &&
        ctx.failed !== true &&
        isTestRun(ctx.command)
      )
        told.tests = withTestRun(told.tests, plain(ctx.command, 500), now);
      if (ctx.failed === true) return null;
      const capture = captureOf(ctx);
      const run = told.tests.at(-1);
      if (capture === null || run === undefined || !wantsProof(capture)) return null;
      yield* agents.log("knowledge.proof-asked", {
        session: ctx.session.id,
        kind: capture.kind,
        draft: capture.id,
      });
      return proofNudge(capture, run, now);
    });

  const trailers = trailerFlows({
    kontext,
    jj: (cwd, args, timeoutMs) => runJj(cwd, args, { timeoutMs }),
    checkout: checkoutKind,
    freshMs: FRESH_MS,
    log: agents.log,
    slot: toldOf,
  });

  const afterTool: Knowledge["Service"]["afterTool"] = (ctx) =>
    Effect.gen(function* () {
      const told = toldOf(ctx.session);
      const added = yield* trailers.after(ctx);
      const governed = yield* governs(ctx.session, ctx.paths);
      const said = [added, governed].filter((part) => part !== null).join("\n\n") || null;
      const asked = (yield* proofAfter(ctx)) ?? told.proof ?? null;
      told.proof = undefined;
      if (asked === null) return said;
      if (said === null) return asked;
      const both = `${said}\n\n${asked}`;
      if (both.length <= POST_TOOL_MAX) return both;
      // What governs the files comes first; the question waits for the next step.
      told.proof = asked;
      return said;
    });

  /** The project's word on its agents' harness memory, as this Peer last synced it; `off` when it says nothing. */
  const memoryPolicy = (session: PeerSessionView) =>
    state.project(session.workspace, session.project).pipe(
      Effect.map(({ project }) => memoryPolicyOf(project)),
      Effect.orElseSucceed(() => memoryPolicyOf(undefined)),
    );

  const beforeEdit: Knowledge["Service"]["beforeEdit"] = (ctx) =>
    Effect.gen(function* () {
      const memory = (ctx.outside ?? []).filter((path) =>
        isHarnessMemoryPath(path, [process.env.CLAUDE_CONFIG_DIR]),
      );
      if (memory.length === 0 || (yield* memoryPolicy(ctx.session)) !== "off") return null;
      const verdict = memoryRefusal(CLI, PERSON);
      // What the refusal costs the agent is logged like any text Peer gives it.
      yield* agents.log("knowledge.memory-refused", {
        session: ctx.session.id,
        tool: ctx.tool,
        paths: memory,
        chars: verdict.reason.length,
      });
      return verdict;
    });

  const capture: Knowledge["Service"]["capture"] = (session, args) =>
    Effect.gen(function* () {
      const request = yield* Effect.try({
        try: () => parseCapture(args),
        catch: (error) =>
          error instanceof CliError ? error : uncertain("capture", messageOf(error)),
      });
      const engine = yield* Effect.promise(() =>
        engineStatus(kontext, session.root).catch(() => null),
      );
      if (engine === null)
        return yield* Effect.fail(
          refused(
            "kontext is not installed on this computer, or is too old for Peer",
            "ask your person to install a compatible kontext (or set KONTEXT_BIN), then repeat the command.",
          ),
        );
      if (!engine.store.configured)
        return yield* Effect.fail(
          refused(
            "this project keeps no kontext store in its repository",
            "ask a lead to run `kontext init` in the repository, then repeat the command.",
          ),
        );
      const result = yield* Effect.tryPromise({
        try: () =>
          kontextApi<{
            readonly id: string;
            readonly related_entries?: ReadonlyArray<unknown>;
          }>(kontext, session.root, "drafts.capture", captureEntry(request, `peer:${session.id}`)),
        catch: (error) =>
          error instanceof KontextApiError && error.code === "not_initialized"
            ? refused(
                "this project keeps no kontext store in its repository",
                "ask a lead to run `kontext init` in the repository, then repeat the command.",
              )
            : error instanceof KontextApiError && error.code === "incompatible"
              ? refused(
                  error.message,
                  "ask your person to install a compatible kontext, then repeat the command.",
                )
              : uncertain(
                  "capture",
                  messageOf(error),
                  "check kontext's inbox (`kontext inbox`) before capturing again.",
                ),
      });
      if (!isKnowledgeIdentity(result.id))
        return yield* Effect.fail(
          uncertain("capture", "kontext answered with an id Peer cannot name"),
        );
      // A learning or decision without a check is asked for its proof at the next step, as after `ctx_capture`.
      const told = toldOf(session);
      const run = told.tests.at(-1);
      const made = {
        kind: request.kind,
        verify: request.verify !== undefined,
        private: false,
        id: result.id,
        promoted: false,
      };
      if (run !== undefined && wantsProof(made))
        told.proof = proofNudge(made, run, yield* Clock.currentTimeMillis);
      yield* agents.log("knowledge.captured", {
        session: session.id,
        kind: request.kind,
        draft: result.id,
        paths: request.paths,
      });
      return captureAnswer(result.id, request.kind, result.related_entries?.length ?? 0);
    });

  return Knowledge.of({
    entries: (session) => Effect.map(bookOf(session.root), standing),
    guidance,
    governs,
    afterTool,
    beforeShell: trailers.before,
    beforeEdit,
    capture,
    review: (session, remainingMs) =>
      Effect.gen(function* () {
        if (session.public === true || !(yield* servesDrift)) return null;
        const started = yield* Clock.currentTimeMillis;
        const drift = yield* Effect.tryPromise(() =>
          entriesDrift(kontext, session.root, {}, Math.max(1, remainingMs)),
        ).pipe(Effect.orElseSucceed(() => null));
        if (drift === null) return null;
        const challenged = challengedIn(session.team ?? []);
        // An entry the agent settled itself needs no check; the rest that name one have it run.
        const unsettled = {
          ...drift,
          entries: drift.entries.filter((entry) => !challenged.has(entry.id)),
        };
        const spent = (yield* Clock.currentTimeMillis) - started;
        const checked = yield* checkReview(
          session.id,
          session.root,
          unsettled,
          remainingMs - spent - REVIEW_MARGIN_MS,
        );
        const refusal = reviewRefusal(
          { ...drift, entries: drift.entries.filter((entry) => !checked.passed.has(entry.id)) },
          challenged,
          checked.checks,
        );
        const states = [...checked.checks.values()];
        yield* agents.log("knowledge.drift-review", {
          session: session.id,
          entries: drift.entries.map((entry) => entry.id),
          settled: refusal === null,
          checks: {
            started: checked.started,
            passed: checked.passed.size,
            failed: states.filter((check) => check.state === "failed").length,
            running: states.filter((check) => check.state === "running").length,
          },
        });
        return refusal;
      }),
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
    preview,
    verifyEntry: flows.verifyCheck,
  });
});

export const layer = Layer.effect(Knowledge, make);

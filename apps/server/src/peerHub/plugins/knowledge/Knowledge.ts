// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - kontext's version is asked from the person's home; the JSON text is only a stable key for what was already told.
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
import * as NodeCrypto from "node:crypto";

import {
  PeerHubError,
  isCandidateKept,
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
import * as Layer from "effect/Layer";

import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import { hasGitCheckout } from "../../core/local.ts";
import type { PeerIndexEntry, PeerSessionView } from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import { safeId, type PersistedState } from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { clip } from "../../peerText.ts";
import {
  asKnowledge,
  engineStatus,
  isKnowledgeIdentity,
  KontextApiError,
  kontextApi,
  type KontextEntry,
} from "../../kontext.ts";
import { KontextClient, kontextIn } from "./client/kontext.ts";
import { projectGuidance, readKnowledge } from "./client/store.ts";
import { knowledgeHub } from "./client/hub.ts";
import {
  entryText,
  governingText,
  known,
  knowledgeIndexText,
  knowledgeLine,
  projectGuidanceText,
  standing,
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

const hubError = (detail: string) => new PeerHubError({ detail });
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** One of kontext's commands; what kontext did not do fails with what it said. */
const kontextDid = <A>(command: () => Promise<A>) =>
  Effect.tryPromise({ try: command, catch: (failure) => hubError(messageOf(failure)) });

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
  /** The entries it was told of or read (ids). */
  readonly entries: Set<string>;
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
    /** The project's guidance on what to mark [project], as a session's start says it; null without one. */
    readonly guidance: (session: PeerSessionView) => Effect.Effect<string | null>;
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
              Effect.map(Clock.currentTimeMillis, (at) => {
                shelves.set(root, { at, book, error, reading: undefined });
              }),
            ),
            Effect.ensuring(Deferred.succeed(done, undefined)),
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
      pending: undefined,
    }));

  const governs: Knowledge["Service"]["governs"] = (session, paths) =>
    Effect.gen(function* () {
      const book = yield* bookOf(session.root);
      const told = toldOf(session);
      for (const file of [...session.files, ...paths]) {
        if (told.touching.size >= TOUCHING_KEPT) break;
        told.touching.add(file);
      }
      if (book.length === 0 || (told.touching.size === told.checked && book === told.book)) {
        return null;
      }
      const key = JSON.stringify({
        paths: [...told.touching].toSorted(),
        exclude_ids: [...told.entries].toSorted(),
      });
      if (told.pending?.key !== key || told.pending.book !== book) {
        told.pending = {
          key,
          book,
          request: kontextApi<{
            matches: Array<{ entry: KontextEntry; pattern: string; path: string }>;
          }>(kontext, session.root, "entries.governing", {
            paths: [...told.touching],
            exclude_ids: [...told.entries],
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
      const unique = new Map<
        string,
        { entry: ReturnType<typeof asKnowledge>; pattern: string; path: string }
      >();
      for (const match of result.value) {
        if (
          isKnowledgeIdentity(match.entry.id) &&
          !told.entries.has(match.entry.id) &&
          !unique.has(match.entry.id)
        )
          unique.set(match.entry.id, { ...match, entry: asKnowledge(match.entry) });
      }
      const all = [...unique.values()].toSorted((a, b) =>
        (b.entry.date ?? "").localeCompare(a.entry.date ?? ""),
      );
      const found = all.slice(0, GOVERNING_TOLD);
      if (found.length === 0) return null;
      // Those left over are said at the next step.
      if (all.length > found.length) told.checked = -1;
      for (const { entry, pattern, path } of found) {
        told.entries.add(entry.id);
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
      const text = governingText(found, CLI);
      yield* agents.log("knowledge.governs", {
        session: session.id,
        entries: found.map(({ entry, pattern, path }) => ({ id: entry.id, pattern, path })),
        text,
      });
      return text;
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
      if (session.public !== true) {
        toldOf(session).entries.add(only.id);
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
      return `${entryText(only)}\n\nThe project's people keep this in its knowledge store; check your change against it, and if it no longer holds, say so to your person.`;
    });

  const guidance: Knowledge["Service"]["guidance"] = (session) =>
    Effect.tryPromise(() => projectGuidance(session.root, kontext)).pipe(
      Effect.map((found) =>
        found === null || found.text === "" ? null : projectGuidanceText(found.text),
      ),
      Effect.orElseSucceed(() => null),
    );

  /** Wording entries with kontext's llm adapter runs on this person's own account; off for tests. */
  const knowledgeLlm = process.env.PEER_KNOWLEDGE_LLM !== "off";

  /** A workspace project's checkouts on this computer, the one that keeps kontext knowledge first. */
  const checkoutsOf = (persisted: PersistedState, workspace: string, projectId: string) => {
    const project = persisted.workspaces
      .find((candidate) => candidate.slug === workspace)
      ?.manifest?.projects.find((candidate) => candidate.id === projectId);
    return (project?.repositories ?? [])
      .filter((repo) => safeId(repo.id))
      .map((repo) => state.checkoutPath(persisted, workspace, projectId, repo.id))
      .filter((path) => hasGitCheckout(path));
  };

  const statusOf = (workspace: string, projectId: string) =>
    Effect.gen(function* () {
      const checkouts = checkoutsOf((yield* state.read).persisted, workspace, projectId);
      const states = yield* Effect.promise(() =>
        Promise.all(
          checkouts.map(async (checkout) => ({
            checkout,
            engine: await engineStatus(kontext, checkout).catch(() => null),
          })),
        ),
      );
      const selected = states.find(({ engine }) => engine?.store.configured) ?? states[0];
      const checkout = selected?.checkout;
      const installed = selected?.engine !== null && selected?.engine !== undefined;
      const store = selected?.engine?.store.configured === true;
      const guided =
        checkout !== undefined && store
          ? yield* Effect.promise(() => projectGuidance(checkout, kontext).catch(() => null))
          : null;
      return {
        checkout: checkout ?? null,
        store,
        kontext: installed,
        llm: selected?.engine?.llm.available === true && knowledgeLlm,
        guidance: guided?.text ?? null,
      } satisfies PeerKnowledgeStatus;
    });

  /** The project's checkout here and kontext in it, or why there is none. */
  const checkoutOf = (workspace: string, projectId: string) =>
    Effect.gen(function* () {
      const here = yield* statusOf(workspace, projectId);
      if (here.checkout === null) {
        return yield* hubError("This project is not on this computer: clone it first.");
      }
      if (!here.kontext) {
        return yield* hubError(
          "A compatible kontext machine API v1 is required here. Install kontext (semans.github.io/kontext) or set KONTEXT_BIN.",
        );
      }
      return { ...here, checkout: here.checkout, kontext: kontextIn(kontext, here.checkout) };
    });

  /** The checkout keeping the project's knowledge here, or why there is none. */
  const storeOf = (workspace: string, projectId: string) =>
    Effect.flatMap(checkoutOf(workspace, projectId), (here) =>
      here.store
        ? Effect.succeed(here)
        : Effect.fail(
            hubError(
              `This project keeps no knowledge yet: set it up (kontext init in ${here.checkout}).`,
            ),
          ),
    );

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

  const decide: Knowledge["Service"]["decide"] = Effect.fn("Knowledge.decide")(function* (input) {
    yield* hub.decide(input.workspace, input.project, input.id, input.status);
    // The count waiting in Work follows from the next view.
    yield* agents.hubChanged;
    return yield* status.publish;
  });

  const setup: Knowledge["Service"]["setup"] = Effect.fn("Knowledge.setup")(function* (input) {
    const here = yield* checkoutOf(input.workspace, input.project);
    if (!here.store) yield* kontextDid(() => here.kontext.init());
    return yield* statusOf(input.workspace, input.project);
  });

  const keep: Knowledge["Service"]["keep"] = Effect.fn("Knowledge.keep")(function* (input) {
    const store = yield* storeOf(input.workspace, input.project);
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
    const kept = yield* kontextDid(() =>
      store.kontext.keep({
        project: input.project,
        operationId: `peer:knowledge:${NodeCrypto.createHash("sha256").update(`${input.workspace}/${input.project}/${input.id}`).digest("hex")}`,
        source: `peer://knowledge/${encodeURIComponent(input.workspace)}/${encodeURIComponent(input.project)}/${encodeURIComponent(input.id)}`,
        candidate,
        where,
        word,
      }),
    );
    yield* hub.decide(input.workspace, input.project, input.id, "promoted", kept.keptAs);
    yield* agents.hubChanged;
    yield* status.publish;
    return { checkout: store.checkout, ...kept };
  });

  const harvest: Knowledge["Service"]["harvest"] = Effect.fn("Knowledge.harvest")(
    function* (input) {
      const store = yield* storeOf(input.workspace, input.project);
      if (!store.llm) {
        return yield* hubError("Reading a context for what to keep needs kontext's llm adapter.");
      }
      const context = yield* readContext(input.workspace, input.project, input.scope);
      if (context === null || context.text.trim() === "") {
        return yield* hubError("Nobody has written that context yet.");
      }
      const task = input.scope.startsWith("task:") ? input.scope.slice("task:".length) : undefined;
      const where = yield* workNames(input.workspace, input.project, [task]);
      const entries = yield* kontextDid(() =>
        store.kontext.harvest({ project: input.project, subject: where(task), text: context.text }),
      );
      for (const entry of entries) {
        yield* hub.propose(input.workspace, input.project, {
          text: entry.title,
          kind: entry.kind,
          detail: entry.body,
          paths: entry.paths,
          ...(task === undefined ? {} : { task }),
          origin: `context:${input.scope}@v${context.version}`,
        });
      }
      yield* agents.hubChanged;
      return { proposed: entries.length };
    },
  );

  const improve: Knowledge["Service"]["improve"] = Effect.fn("Knowledge.improve")(
    function* (input) {
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
      const staged = yield* kontextDid(() =>
        store.kontext.guidance({
          project: input.project,
          kept: decided.filter((c) => isCandidateKept(c.status) && marked(c)).map((c) => c.text),
          dismissed: decided
            .filter((c) => c.status === "dismissed" && marked(c))
            .map((c) => c.text),
          missed: decided.filter((c) => isCandidateKept(c.status) && !marked(c)).map((c) => c.text),
        }),
      );
      return { checkout: store.checkout, ...staged };
    },
  );

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
    keep,
    harvest,
    improve,
  });
});

export const layer = Layer.effect(Knowledge, make);

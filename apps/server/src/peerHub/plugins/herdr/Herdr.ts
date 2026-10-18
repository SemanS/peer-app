// @effect-diagnostics nodeBuiltinImport:off - agents' directories as the file system knows them.
/**
 * Herdr: the coding agents herdr (https://herdr.dev) runs on this computer, beside Peer's own
 * threads. Peer shows them, reports them to each workspace as work on the project whose checkout
 * they run in (with the files they changed as observations in a coordination report), shows their
 * work from their transcripts or terminals, brings one forward or prompts it, wakes an idle one
 * that must answer a teammate's agent, and starts one on a task (`launcher.ts`). It follows herdr
 * only while the plugin is active (`follower.ts`): while it is not, Peer shows no herdr agent,
 * reports none and wakes none, and news waits for an agent's next step.
 *
 * @module peerHub/plugins/herdr/Herdr
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  PeerAgentView,
  PeerHubError,
  type PeerHubAgentInput,
  type PeerHubFocusAgentInput,
  type PeerHubPromptAgentInput,
  type PeerHubStatus,
  type PeerLocalAgent,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as AgentTranscript from "../../agentTranscript.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import {
  PeerPromptStale,
  type PeerPromptExpect,
  type PeerRuntimeProvider,
  type PeerTaskLauncher,
  type ReportedSession,
  type ReportedThread,
} from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { herdrAgentChange, herdrViewHint, herdrWorkStatus } from "./client/herdr.ts";
import { boundHerdrClient, HerdrClient } from "./client/HerdrClient.ts";
import { boundHerdrObservations } from "./client/observations.ts";
import { makeHerdrAgents, type HerdrAgentState } from "./follower.ts";
import { makeLauncher } from "./launcher.ts";
import * as Runtime from "./runtime.ts";

const sameAgentView = Schema.toEquivalence(PeerAgentView);
const hubError = (detail: string) => new PeerHubError({ detail });

/** A directory as the file system knows it (macOS keeps /var under /private). */
function realDirectory(path: string): string {
  try {
    return NodeFS.realpathSync(path);
  } catch {
    return NodePath.resolve(path);
  }
}

export class Herdr extends Context.Service<
  Herdr,
  {
    /** herdr's agents on this computer, as the status shows them. */
    readonly agents: Effect.Effect<PeerHubStatus["agents"]>;
    /** Follows herdr's agents until interrupted (the plugin's background work). */
    readonly follow: Effect.Effect<never, never, Scope.Scope>;
    /** herdr runs agents beside Peer's own threads: their titles, panes, states, wake and threads. */
    readonly runtime: PeerRuntimeProvider;
    /** Starts an agent on a task in herdr. */
    readonly launcher: PeerTaskLauncher;
    /** Brings a herdr agent's pane forward in herdr. */
    readonly focus: (input: PeerHubFocusAgentInput) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /** A herdr agent's work as it happens: its view now, then each change. */
    readonly watch: (input: PeerHubAgentInput) => Stream.Stream<PeerAgentView>;
    /** Sends one of this computer's herdr agents a prompt, as if typed in its terminal. */
    readonly prompt: (input: PeerHubPromptAgentInput) => Effect.Effect<PeerHubStatus, PeerHubError>;
    /**
     * A coordination report with herdr's agents that Peer's hooks did not report, and the files
     * they changed as seen after the fact, within the Hub's bound.
     */
    readonly reportSessions: (
      workspace: string,
      reported: ReadonlyArray<ReportedSession>,
    ) => Effect.Effect<ReadonlyArray<ReportedSession>>;
  }
>()("t3/peerHub/plugins/herdr/Herdr") {}

const make = Effect.gen(function* () {
  const state = yield* PeerState.PeerState;
  const status = yield* PeerStatus.PeerStatus;
  const work = yield* PeerWork.PeerWork;
  const sessions = yield* PeerAgents.PeerAgents;
  const client = yield* HerdrClient;
  const runtime = yield* Runtime.HerdrRuntime;
  const agents = yield* makeHerdrAgents;
  const launcher = yield* makeLauncher(agents);
  const { keyOf, sessionOf } = agents;
  /** Workspace → how many of herdr's observations its last report could not carry. */
  const skipped = new Map<string, number>();
  /**
   * Terminal → the agent in it that Peer's hooks reported. It is theirs while it runs there, also
   * once its session ended (it exits, or they report its next one): observed under its terminal,
   * what they reported would open overlaps anew, and wake the agents that settled them.
   */
  const hooked = new Map<string, string | undefined>();
  /** Where Peer found agents' transcripts: session id → file, or null, rechecked after a while. */
  const transcripts = new Map<string, { readonly path: string | null; readonly at: number }>();

  /** The agent behind a thread key, as it is now or as its terminal was first known. */
  const agentOf = (agentId: string) =>
    (agents.current() ?? []).find(
      (candidate) => keyOf(candidate) === agentId || `herdr:${candidate.terminalId}` === agentId,
    );

  /** The task one of herdr's agents was put on in a workspace project, if any. */
  const taskOf = (thread: string, workspace: string, projectId: string) =>
    work
      .assignment(thread)
      .pipe(
        Effect.map((assignment) =>
          Option.isSome(assignment) &&
          assignment.value.workspace === workspace &&
          assignment.value.project === projectId
            ? assignment.value.task
            : undefined,
        ),
      );

  const localAgentView = (
    persisted: PeerState.PersistedState,
    agent: HerdrAgentState,
  ): PeerLocalAgent => {
    const place = agent.place ?? state.projectOfPath(persisted, agent.cwd);
    const session = sessionOf(agent)?.id;
    return {
      id: keyOf(agent),
      paneId: agent.paneId,
      ...(agent.agent === undefined ? {} : { agent: agent.agent }),
      title: agent.title,
      status: agent.status,
      ...(agent.cwd === undefined ? {} : { cwd: agent.cwd }),
      ...(agent.branch === undefined ? {} : { branch: agent.branch }),
      ...(agent.vcs === undefined ? {} : { vcs: agent.vcs }),
      ...(session === undefined ? {} : { session }),
      ...(agent.completionSeq === undefined ? {} : { turn: agent.completionSeq }),
      coordinationLevel: sessions.level(keyOf(agent).replace(/^herdr:/, "")),
      ...(agent.postHocPaths === undefined ? {} : { postHocPaths: agent.postHocPaths }),
      ...(agent.postHocPathsTruncated === undefined
        ? {}
        : { postHocPathsTruncated: agent.postHocPathsTruncated }),
      ...(place === undefined ? {} : place),
    };
  };

  const agentsNow: Herdr["Service"]["agents"] = Effect.gen(function* () {
    const { persisted } = yield* state.read;
    const list = agents.current();
    return {
      herdr: list === null ? "not-running" : "running",
      list: (list ?? []).map((agent) => localAgentView(persisted, agent)),
      postHocSkipped: persisted.workspaces.reduce(
        (count, workspace) => count + (skipped.get(workspace.slug) ?? 0),
        0,
      ),
    };
  });

  /** A herdr agent as its view shows it: its transcript when Peer can read it, else its terminal. */
  const agentView = (agentId: string) =>
    Effect.gen(function* () {
      const agent = agentOf(agentId);
      if (agent === undefined) {
        return { agentId, title: "", status: "unknown", gone: true } satisfies PeerAgentView;
      }
      const base = {
        agentId,
        title: agent.title,
        status: agent.status,
        paneId: agent.paneId,
        gone: false,
        ...(agent.agent === undefined ? {} : { agent: agent.agent }),
        ...(agent.cwd === undefined ? {} : { cwd: agent.cwd }),
        ...(agent.branch === undefined ? {} : { branch: agent.branch }),
        ...(agent.vcs === undefined ? {} : { vcs: agent.vcs }),
      } satisfies PeerAgentView;
      const session = sessionOf(agent);
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      let path: string | null = null;
      if (session !== undefined && agent.agent === "claude") {
        const key = session.id ?? session.path ?? "";
        const known = transcripts.get(key);
        if (known !== undefined && (known.path !== null || now - known.at < 10_000)) {
          path = known.path;
        } else {
          path = yield* Effect.promise(() => AgentTranscript.findClaudeTranscript(session));
          transcripts.set(key, { path, at: now });
        }
      }
      if (path !== null) {
        const transcriptPath = path;
        const lines = yield* Effect.tryPromise(() =>
          AgentTranscript.readTranscriptTail(transcriptPath),
        ).pipe(Effect.orElseSucceed(() => [] as string[]));
        return {
          ...base,
          entries: AgentTranscript.transcriptEntries(
            lines,
            agent.cwd === undefined ? {} : { cwd: agent.cwd },
          ),
        } satisfies PeerAgentView;
      }
      // herdr will not read a working full-screen agent's history. Say so rather than show nothing;
      // the view is read again every second, so its output appears once herdr reports it idle or done.
      const terminal = yield* Effect.promise(() => client.read(agent.paneId));
      const { runtime: herdrRuntime } = yield* runtime.status;
      const hint = herdrViewHint(agent, terminal, herdrRuntime.source);
      return {
        ...base,
        ...(terminal.kind === "text" ? { terminal: terminal.text } : {}),
        ...(hint === "" ? {} : { hint }),
      } satisfies PeerAgentView;
    });

  /** Where to type into an agent now: its pane, unless it is gone or waits for an answer. */
  const plainTarget = (agent: HerdrAgentState | undefined) =>
    agent === undefined || agent.status === "blocked"
      ? Effect.fail(hubError("That agent stopped or waits for an answer."))
      : Effect.succeed(agent.paneId);

  /**
   * Where to type into an agent a caller read earlier: its live name (which follows the terminal's
   * occupant), else its pane, once a new read of its terminal shows it is still the session at the
   * turn `expect` names, idle or done, as `wakeHerdrAgent` checks before it types. Otherwise the
   * caller is told it is stale and nothing is typed. What `expect` leaves out is compared with what
   * Peer last read of the agent.
   */
  const confirmedTarget = (known: HerdrAgentState | undefined, expect: PeerPromptExpect) =>
    Effect.gen(function* () {
      if (known === undefined) return yield* new PeerPromptStale({ reason: "gone" });
      const listed = yield* Effect.tryPromise(() => client.list()).pipe(
        Effect.orElseSucceed(() => null),
      );
      const found = listed?.find((candidate) => candidate.terminalId === known.terminalId);
      const fresh = found === undefined ? undefined : { ...found, session: sessionOf(found) };
      const read = sessionOf(known);
      const change = herdrAgentChange(fresh, {
        ...known,
        session: { id: expect.session ?? read?.id, path: read?.path },
        completionSeq: expect.turn ?? known.completionSeq,
      });
      if (fresh === undefined || change !== undefined) {
        return yield* new PeerPromptStale({ reason: change ?? "gone" });
      }
      return fresh.name ?? fresh.paneId;
    });

  const provider: PeerRuntimeProvider = {
    prefix: "herdr:",
    title: (pane) => agents.current()?.find((agent) => agent.paneId === pane)?.title,
    pane: (agent, cwd, named) => {
      const here = realDirectory(cwd);
      const panes = (agents.current() ?? []).filter((candidate) => {
        if (candidate.agent !== agent || candidate.cwd === undefined) return false;
        const there = realDirectory(candidate.cwd);
        return here === there || here.startsWith(`${there}/`) || there.startsWith(`${here}/`);
      });
      if (named !== undefined && panes.some((candidate) => candidate.paneId === named)) {
        return named;
      }
      return panes.length === 1 ? panes[0]?.paneId : undefined;
    },
    status: (sessionId, pane) =>
      agents
        .current()
        ?.find(
          (candidate) =>
            keyOf(candidate) === `herdr:${sessionId}` &&
            (pane === undefined || candidate.paneId === pane),
        )?.status,
    wake: (sessionId, _pane, text) =>
      Effect.promise(() => {
        const agent = agents
          .current()
          ?.find((candidate) => keyOf(candidate) === `herdr:${sessionId}`);
        if (agent === undefined) return Promise.resolve({ status: "unavailable" as const });
        return client.wake({ ...agent, session: sessionOf(agent) }, text);
      }),
    view: (threadKey) => agentView(threadKey),
    prompt: (id, text, expect) =>
      Effect.gen(function* () {
        const agent = agentOf(id);
        const target = yield* expect === undefined
          ? plainTarget(agent)
          : confirmedTarget(agent, expect);
        yield* Effect.tryPromise(() => client.prompt(target, text)).pipe(
          Effect.mapError(() =>
            hubError("herdr could not confirm the prompt. Read the agent before retrying."),
          ),
        );
        yield* agents.refresh;
      }),
    notify: (title, body) => Effect.sync(() => void client.notify(title, body)),
    threads: (workspace) =>
      Effect.gen(function* () {
        const { persisted } = yield* state.read;
        const reported: Array<ReportedThread> = [];
        for (const agent of agents.current() ?? []) {
          const place = agent.place ?? state.projectOfPath(persisted, agent.cwd);
          if (place === undefined || place.workspace !== workspace) continue;
          const id = keyOf(agent);
          const task =
            (yield* taskOf(id, workspace, place.projectId)) ??
            (yield* taskOf(`herdr:${agent.terminalId}`, workspace, place.projectId));
          reported.push({
            id,
            project: place.projectId,
            repository: place.repositoryId,
            ...(task === undefined ? {} : { task }),
            title: agent.title.slice(0, 300),
            // Finished work is "done" like a Peer thread's, whether or not someone looked in
            // herdr. The local list keeps herdr's own state: Needs you clears once looked at.
            status: herdrWorkStatus(agent),
            ...(agent.agent === undefined ? {} : { harness: agent.agent }),
            ...(agent.branch === undefined ? {} : { branch: agent.branch }),
            ...(agent.vcs === undefined ? {} : { vcs: agent.vcs }),
            source: "herdr",
            ...(id === `herdr:${agent.terminalId}`
              ? {}
              : { previousId: `herdr:${agent.terminalId}` }),
          });
        }
        return reported;
      }),
  };

  /**
   * herdr's agents a coordination report carries besides the sessions reported before them, with
   * the files they changed as seen after the fact. Each is on a task as a hook session is: the one
   * it was put on, else the one its branch or title names.
   */
  const observations = (workspace: string, reported: ReadonlyArray<ReportedSession>) =>
    Effect.gen(function* () {
      const observed: Array<ReportedSession> = [];
      if (hooked.size > 500) hooked.delete(hooked.keys().next().value!);
      for (const agent of agents.current() ?? []) {
        if (agent.place?.workspace !== workspace) continue;
        const id = keyOf(agent).replace(/^herdr:/, "");
        if (reported.some((session) => session.id === id))
          hooked.set(agent.terminalId, agent.agent);
        if (hooked.has(agent.terminalId) && hooked.get(agent.terminalId) === agent.agent) continue;
        const project = agent.place.projectId;
        const task =
          (yield* taskOf(keyOf(agent), workspace, project)) ??
          PeerWork.taskNamed(yield* work.tasks(workspace, project), [agent.branch, agent.title]);
        observed.push({
          id,
          project,
          label: agent.title,
          ...(agent.agent === undefined ? {} : { agent: agent.agent }),
          status: agent.status,
          ...(agent.branch === undefined ? {} : { branch: agent.branch }),
          files: agent.postHocPaths ?? [],
          claims: [],
          ...(task === undefined ? {} : { task }),
        });
      }
      return observed;
    });

  const reportSessions: Herdr["Service"]["reportSessions"] = (workspace, reported) =>
    Effect.gen(function* () {
      const report = boundHerdrObservations(reported, yield* observations(workspace, reported));
      skipped.set(workspace, report.skipped);
      return report.sessions;
    });

  const focus: Herdr["Service"]["focus"] = Effect.fn("Herdr.focus")(function* (input) {
    const noWindow = input.openWindow === true ? yield* runtime.ensureWindow : undefined;
    yield* Effect.tryPromise(() => client.focus(input.paneId)).pipe(
      Effect.mapError(() =>
        hubError("herdr could not bring that agent forward. Is herdr running?"),
      ),
    );
    return noWindow === undefined ? yield* status.publish : yield* hubError(noWindow);
  });

  const watch: Herdr["Service"]["watch"] = (input) =>
    Stream.tick("1 second").pipe(
      Stream.mapEffect(() => agentView(input.agentId)),
      Stream.changesWith(sameAgentView),
    );

  const prompt: Herdr["Service"]["prompt"] = Effect.fn("Herdr.prompt")(function* (input) {
    const agent = agentOf(input.agentId);
    if (agent === undefined) return yield* hubError("That agent no longer runs in herdr.");
    if (agent.status === "blocked") {
      return yield* hubError(
        "It is waiting for an answer in its terminal. Answer it in herdr first.",
      );
    }
    yield* Effect.tryPromise(() => client.prompt(agent.paneId, input.text)).pipe(
      Effect.mapError((error) =>
        hubError(
          `herdr did not take the prompt${error.cause instanceof Error ? `: ${error.cause.message}` : "."}`,
        ),
      ),
    );
    yield* agents.refresh;
    return yield* status.publish;
  });

  return Herdr.of({
    agents: agentsNow,
    follow: agents.follow,
    runtime: provider,
    launcher,
    focus,
    watch,
    prompt,
    reportSessions,
  });
});

/** The agents' client goes to the socket of the herdr in use; the runtime is the plugin's too. */
export const layer = Layer.effect(Herdr, make).pipe(
  Layer.provide(
    Layer.effect(
      HerdrClient,
      Effect.gen(function* () {
        return boundHerdrClient(yield* HerdrClient, (yield* Runtime.HerdrRuntime).socketPath);
      }),
    ),
  ),
  Layer.provideMerge(Runtime.layer),
);

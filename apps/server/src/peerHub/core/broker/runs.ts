// @effect-diagnostics nodeBuiltinImport:off - session files keyed by run, and the socket's run routes.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * Runs in the broker (design D2, D3, D5): which run a session joins when it starts (the run its
 * process names with a matching token, else the one its thread, pane or branch puts it on), the
 * session files kept by run so a new session of the run continues what the last one read and was
 * told, `peer run`, and the socket's `/runs` routes the terminal's Peer Core process uses.
 *
 * @module peerHub/core/broker/runs
 */
import * as NodeFSP from "node:fs/promises";
import type * as NodeHttp from "node:http";
import * as NodePath from "node:path";

import { PEER_LOCAL_WORKSPACE, type PeerRunOutcome, type PeerRunRuntime } from "@t3tools/contracts";

import { agentNamed } from "../coordination/edits.ts";
import { type CreateRun, stateOf, toPeerRun } from "../work/runs.ts";
import type { CoordinationBroker } from "./Broker.ts";
import { MEMORY_FILE } from "./sessionMemory.ts";
import { headerOf, parseJson } from "./server.ts";
import { type LocalSession, safePart } from "./sessions.ts";

/** The run a process names (`PEER_RUN`) and the token it proves it with (`PEER_RUN_TOKEN`). */
export interface RunClaim {
  readonly id: string;
  readonly token: string | undefined;
}

export const runClaimOf = (headers: NodeHttp.IncomingHttpHeaders): RunClaim | undefined => {
  const id = headerOf(headers, "x-peer-run");
  return id === undefined ? undefined : { id, token: headerOf(headers, "x-peer-run-token") };
};

/** Which run a starting session is in, decided before anything is written (`planRun`). */
export interface RunPlan {
  readonly id?: string;
  readonly task: string | undefined;
  /** The run to create under `id` once the session is installed. */
  readonly create?: CreateRun;
  readonly notice?: string;
}

/**
 * Design D3, in order: the run the process names with a matching token (a new run on the same task
 * when that one ended); else the task resolved as before, and on it the run that holds one of the
 * session's keys, this person's detached run it continues, or a new one. A lookup only: the broker
 * writes it once the session is installed (`enterRun`), so a hook never waits on it.
 */
export function planRun(
  this: CoordinationBroker,
  input: {
    readonly agent: string;
    readonly session: string;
    readonly workspace: string;
    readonly project: string;
    readonly thread: string | undefined;
    readonly pane: string | undefined;
    readonly adapter: "hooks" | "mcp";
    readonly claim: RunClaim | undefined;
    /** The session's branch and title, which may name a task by its key. */
    readonly texts: ReadonlyArray<string | undefined>;
    /** A task already known (`adoptRun`), else it is resolved as before runs. */
    readonly task?: string;
  },
): RunPlan {
  const resolve = () =>
    input.task ??
    this.host.taskOf(
      input.workspace,
      input.project,
      [...(input.thread === undefined ? [] : [input.thread]), `herdr:${input.session}`],
      input.texts,
    );
  const book = this.host.runs;
  if (book === undefined || input.workspace === PEER_LOCAL_WORKSPACE) return { task: resolve() };
  const place = { workspace: input.workspace, project: input.project };
  const join = (task: string) =>
    book.adoptable({
      ...place,
      task,
      agent: input.agent,
      session: input.session,
      thread: input.thread,
      pane: input.pane,
    });
  let notice: string | undefined;
  if (input.claim !== undefined) {
    const named = book.get(input.claim.id);
    if (
      named !== undefined &&
      named.workspace === input.workspace &&
      named.project === input.project &&
      book.claim(named.id, input.claim.token)
    ) {
      if (named.endedAt === undefined) return { id: named.id, task: named.task };
      const continuing = join(named.task);
      if (continuing !== undefined) return { id: continuing.id, task: continuing.task };
      const id = book.mintId();
      return {
        id,
        task: named.task,
        notice: `Peer: run ${named.id} ended (${named.outcome ?? "ended"}); this session starts a new run on the same task.`,
        create: { ...place, task: named.task, agent: input.agent, runtime: "terminal", id },
      };
    }
    notice = `Peer: PEER_RUN names run ${input.claim.id}, but its token does not match; this session runs without it.`;
  }
  const task = resolve();
  if (task === undefined) return { task, ...(notice === undefined ? {} : { notice }) };
  const holder = [input.thread, `herdr:${input.session}`, input.session]
    .flatMap((key) => (key === undefined ? [] : [book.holderOf(key)]))
    .find(
      (run) =>
        run !== undefined &&
        run.task === task &&
        run.workspace === input.workspace &&
        run.project === input.project &&
        (stateOf(run) !== "running" || run.sessions.at(-1)?.id === input.session),
    );
  const found = holder ?? join(task);
  if (found !== undefined)
    return { id: found.id, task, ...(notice === undefined ? {} : { notice }) };
  const id = book.mintId();
  const runtime: PeerRunRuntime =
    input.thread !== undefined
      ? "peer"
      : input.pane !== undefined
        ? "herdr"
        : input.adapter === "mcp"
          ? "mcp"
          : "terminal";
  return {
    id,
    task,
    ...(notice === undefined ? {} : { notice }),
    create: {
      ...place,
      task,
      agent: input.agent,
      runtime,
      ...(input.thread === undefined ? {} : { thread: input.thread }),
      ...(input.pane === undefined ? {} : { pane: input.pane }),
      id,
    },
  };
}

const exists = (path: string) =>
  NodeFSP.stat(path).then(
    () => true,
    () => false,
  );

/**
 * A session's working context file: `<run id>.md` in a run, so the run's next session continues
 * it, else `<session id>.md`. A run's first session that already had files of its own (Peer met it
 * before runs) brings them along.
 */
export async function contextPathFor(
  this: CoordinationBroker,
  place: { readonly workspace: string; readonly project: string },
  sid: string,
  run: string | undefined,
): Promise<string> {
  const dir = NodePath.join(
    this.host.contextsDir,
    safePart(place.workspace),
    safePart(place.project),
  );
  const own = NodePath.join(dir, `${safePart(sid)}.md`);
  if (run === undefined) return own;
  const path = NodePath.join(dir, `${safePart(run)}.md`);
  if (!(await exists(path)) && (await exists(own))) {
    const memory = (file: string) => file.replace(/\.md$/, MEMORY_FILE);
    await NodeFSP.copyFile(own, path).catch(() => undefined);
    await NodeFSP.copyFile(memory(own), memory(path)).catch(() => undefined);
  }
  return path;
}

const tell = (session: LocalSession, line: string) => {
  session.runNotice = session.runNotice === undefined ? line : `${session.runNotice}\n${line}`;
};

/** Writes the plan of an installed session: the run created or joined, and what it is told once. */
export async function enterRun(this: CoordinationBroker, session: LocalSession, plan: RunPlan) {
  if (plan.notice !== undefined) tell(session, plan.notice);
  const book = this.host.runs;
  if (book === undefined || plan.id === undefined) return;
  try {
    if (plan.create !== undefined) await book.create(plan.create);
    const { replaced } = await book.attach(plan.id, session.id, {
      agent: session.agent,
      pane: session.pane,
    });
    session.run = plan.id;
    if (replaced.length > 0)
      tell(
        session,
        `Peer: run ${plan.id} had another live session (${replaced.join(", ")}); the run's record ends it, and this session carries the run now.`,
      );
    this.record("run.attached", { session: session.id, run: plan.id, replaced });
  } catch {
    // Only a class goes to the log; the error's own text may carry a path.
    this.record("run.failed", { session: session.id, run: plan.id, reasonClass: "error" });
  }
}

/**
 * A person puts a live session in a run from the terminal (`peer core runs attach`): what a matching
 * `X-Peer-Run` token does at a session's start (design D3, step 1), for a session already running.
 */
export async function attachRun(this: CoordinationBroker, session: LocalSession, id: string) {
  const book = this.host.runs;
  const run = book?.get(id);
  if (book === undefined || run === undefined) return;
  if (session.run !== undefined && session.run !== id) this.leaveRun(session);
  await this.enterRun(session, { id, task: run.task });
  if (session.task === run.task) return;
  // Its work changes as when its person puts it on another task: what it kept for the old one goes.
  await this.release(session);
  const from = session.task;
  session.task = run.task;
  session.read.clear();
  session.marked.clear();
  session.sharedHeard = 0;
  session.sharedHeardText = "";
  const name = (task: string | undefined) =>
    task === undefined ? "no task" : this.host.taskName(session.workspace, session.project, task);
  session.pending.push(
    `Peer: your person put this session in run ${id} on ${name(run.task)} (you were on ${name(from)}).`,
  );
}

/** A session that gained a task (an assignment, a branch) gets a run as it would at its start. */
export async function adoptRun(this: CoordinationBroker, session: LocalSession) {
  if (session.run !== undefined || session.task === undefined) return;
  const task = session.task;
  const plan = this.planRun({
    agent: session.agent,
    session: session.id,
    workspace: session.workspace,
    project: session.project,
    thread: session.thread,
    pane: session.pane,
    adapter: session.adapter ?? "hooks",
    claim: undefined,
    texts: [],
    task,
  });
  await this.enterRun(session, plan);
}

/** The session's task while it is in a run: the run's, which a person may move. */
export function runTask(this: CoordinationBroker, session: LocalSession): string | undefined {
  return session.run === undefined ? undefined : this.host.runs?.get(session.run)?.task;
}

/** A session ended, expired or was superseded: its run stays, detached. */
export function leaveRun(this: CoordinationBroker, session: LocalSession) {
  if (session.run === undefined) return;
  void this.host.runs?.detach(session.run, session.id).catch(() => undefined);
}

/** Ending a run releases what its live session held, as a session end does (design D5). */
export function runEnded(this: CoordinationBroker, run: string) {
  for (const session of this.sessions.values()) {
    if (session.run !== run) continue;
    session.claims = [];
    void this.release(session);
    this.markDirty();
    this.record("run.ended", { session: session.id, run });
  }
}

/** `peer review` and `peer done` the Hub accepted end the session's run. */
export async function endRunOf(
  this: CoordinationBroker,
  session: LocalSession,
  outcome: PeerRunOutcome,
) {
  if (session.run !== undefined)
    await this.host.runs?.end(session.run, outcome).catch(() => undefined);
}

/** Events whose answer may carry text for the agent. */
const CONTEXT_EVENTS = new Set([
  "SessionStart",
  "UserPromptSubmit",
  "PostToolUse",
  "PostToolUseFailure",
]);

/**
 * What a run told a session once (design D2) goes with this hook's answer when the answer may carry
 * text, else with its next step.
 */
export function withRunNotice(
  this: CoordinationBroker,
  body: Record<string, unknown>,
  headers: NodeHttp.IncomingHttpHeaders,
  out: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const agent = agentNamed(headerOf(headers, "x-peer-agent"));
  const session = this.sessions.get(`${agent}:${String(body.session_id)}`);
  const notice = session?.runNotice;
  if (session === undefined || notice === undefined) return out;
  delete session.runNotice;
  const event = typeof body.hook_event_name === "string" ? body.hook_event_name : "";
  const answer = out?.hookSpecificOutput;
  if (headerOf(headers, "x-peer-adapter") === "mod" || !CONTEXT_EVENTS.has(event)) {
    session.pending.push(notice);
    return out;
  }
  if (out === null)
    return { hookSpecificOutput: { hookEventName: event, additionalContext: notice } };
  if (typeof answer !== "object" || answer === null) {
    session.pending.push(notice);
    return out;
  }
  const said = (answer as { readonly additionalContext?: unknown }).additionalContext;
  return {
    ...out,
    hookSpecificOutput: {
      ...answer,
      hookEventName: event,
      additionalContext: typeof said === "string" && said !== "" ? `${notice}\n\n${said}` : notice,
    },
  };
}

/** `peer run`: the session's run, as the agent and its person read it. */
export function runCommand(this: CoordinationBroker, session: LocalSession): string {
  const run = session.run === undefined ? undefined : this.host.runs?.get(session.run);
  if (run === undefined)
    return session.task === undefined
      ? "This session has no run: it is on no task. Your person puts it on one in Peer."
      : "This session has no run yet; Peer starts one at its next step.";
  const count = run.sessions.length + run.sessionsBefore;
  return [
    `Run ${run.id} on ${this.host.taskName(run.workspace, run.project, run.task)}`,
    `State: ${stateOf(run)}${run.outcome === undefined ? "" : ` (${run.outcome})`} · runtime: ${run.runtime} · agent: ${run.agent} · ${count} session${count === 1 ? "" : "s"}, this one ${session.id}`,
  ].join("\n");
}

type Reply = { readonly status: number; readonly body: unknown };

/**
 * The socket's `/runs` routes, for the terminal's Peer Core process, which never writes
 * `peer-hub.json` while a broker owns the socket (design D5): `POST /runs` creates a run
 * (`RunBook.create`, as every start path does; `thread` and `pane` optional),
 * `GET /runs?workspace=&project=&task=` lists them, `POST /runs/<id>/end` ends one (`stopped`),
 * `POST /runs/<id>/attach` puts a live session in it, and `POST /runs/<id>/continue` gives a new
 * process of a detached run its identity.
 * Undefined for a path that is not one of them.
 */
export async function runsRoute(
  this: CoordinationBroker,
  method: string | undefined,
  url: string,
  raw: string,
): Promise<Reply | undefined> {
  const parsed = new URL(url, "http://peer");
  if (parsed.pathname !== "/runs" && !parsed.pathname.startsWith("/runs/")) return undefined;
  const book = this.host.runs;
  if (book === undefined) return { status: 404, body: { error: "runs are not kept here" } };
  if (parsed.pathname === "/runs" && method === "GET") {
    const workspace = parsed.searchParams.get("workspace") ?? undefined;
    const project = parsed.searchParams.get("project") ?? undefined;
    const task = parsed.searchParams.get("task") ?? undefined;
    return { status: 200, body: { runs: book.list({ workspace, project, task }).map(toPeerRun) } };
  }
  if (parsed.pathname === "/runs" && method === "POST") {
    const input = parseJson(raw);
    const text = (key: string) =>
      typeof input[key] === "string" && input[key] !== "" ? (input[key] as string) : undefined;
    const runtime = text("runtime") ?? "terminal";
    const [workspace, project, task, agent] = [
      text("workspace"),
      text("project"),
      text("task"),
      text("agent"),
    ];
    if (
      workspace === undefined ||
      project === undefined ||
      task === undefined ||
      agent === undefined
    )
      return { status: 400, body: { error: "workspace, project, task and agent are required" } };
    if (!["terminal", "herdr", "peer", "mcp"].includes(runtime))
      return { status: 400, body: { error: "runtime is terminal, herdr, peer or mcp" } };
    // The same creation as every start path's: `thread` and `pane` say where the run shows.
    const created = await book.create({
      workspace,
      project,
      task,
      agent,
      runtime: runtime as PeerRunRuntime,
      requestId: text("requestId"),
      thread: text("thread"),
      pane: text("pane"),
    });
    this.record("run.created", {
      run: created.run.id,
      task,
      agent,
      runtime,
      created: created.created,
    });
    return {
      status: created.created ? 201 : 200,
      body: {
        id: created.run.id,
        ...(created.token === undefined ? {} : { token: created.token }),
        task,
      },
    };
  }
  const attaching = /^\/runs\/([^/]+)\/attach$/.exec(parsed.pathname);
  if (attaching !== null && method === "POST") {
    const run = book.get(decodeURIComponent(attaching[1]!));
    const named = parseJson(raw).session;
    const session =
      typeof named === "string" && named !== ""
        ? [...this.sessions.values()].find((s) => s.id === named || s.id.endsWith(`:${named}`))
        : undefined;
    if (run === undefined) return { status: 404, body: { error: "no such run on this computer" } };
    if (session === undefined)
      return { status: 404, body: { error: "no live session by that id" } };
    if (run.endedAt !== undefined) return { status: 409, body: { error: `run ${run.id} ended` } };
    await this.attachRun(session, run.id);
    return { status: 200, body: { run: toPeerRun(book.get(run.id) ?? run) } };
  }
  const continuing = /^\/runs\/([^/]+)\/continue$/.exec(parsed.pathname);
  if (continuing !== null && method === "POST") {
    const run = book.get(decodeURIComponent(continuing[1]!));
    if (run === undefined) return { status: 404, body: { error: "no such run on this computer" } };
    const state = stateOf(run);
    if (state !== "detached")
      return {
        status: 409,
        body: { error: `run ${run.id} is ${state}; only a detached run continues` },
      };
    const identity = await book.continueEnv(run.id);
    if (identity === undefined) return { status: 409, body: { error: `run ${run.id} ended` } };
    return {
      status: 200,
      body: {
        env: identity.env,
        ...(identity.resume === undefined
          ? {}
          : { resume: { agent: identity.resume.agent, session: identity.resume.nativeId } }),
      },
    };
  }
  const ending = /^\/runs\/([^/]+)\/end$/.exec(parsed.pathname);
  if (ending !== null && method === "POST") {
    const id = decodeURIComponent(ending[1]!);
    const ended = await book.end(id, "stopped");
    return ended === undefined
      ? { status: 404, body: { error: `no run ${id} on this computer` } }
      : { status: 200, body: toPeerRun(ended) };
  }
  return { status: 404, body: { error: "no such run route" } };
}

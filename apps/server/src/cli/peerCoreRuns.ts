// @effect-diagnostics nodeBuiltinImport:off - the broker's unix socket.
/**
 * Runs from the terminal (design D5–D7): the run Start a task creates and hands its editor, and
 * `peer core runs [--task <id>] [--all] | end <id> | continue <id> | attach <run>`. The runs live
 * where the broker keeps them: a broker that owns the socket (the app or Peer Core) is asked over
 * `/runs`, since this process never writes `peer-hub.json` beside it; with none, this process
 * reads and writes them itself (`PeerRuns`) and Peer Core starts afterwards.
 *
 * @module cli/peerCoreRuns
 */
import * as NodeHttp from "node:http";

import type { PeerRun } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as CliError from "effect/cli/CliError";

import * as PeerRuns from "../peerHub/core/work/runs.ts";
import { toPeerRun } from "../peerHub/core/work/runs.ts";
import { fail, type OneShotIo, outcome } from "./peerCoreIo.ts";
import { scopePrompt } from "./peerCoreTasks.ts";

/** The variables a process of a run carries (design D2). */
export interface RunEnv {
  readonly PEER_RUN?: string;
  readonly PEER_RUN_TOKEN?: string;
  readonly PEER_TASK: string;
}

export interface RunRequest {
  readonly workspace: string;
  readonly project: string;
  readonly task: string;
  readonly agent: string;
  /** The menu's nonce per Start a task: a retry of it creates no second run. */
  readonly requestId: string;
}

/** What creating a run answers: the token only to the request that created it. */
export interface CreatedRun {
  readonly id: string;
  readonly token?: string;
}

/** The variables of a run just created or continued; without its token the run cannot be named. */
export const envOf = (task: string, run: CreatedRun | undefined): RunEnv =>
  run?.token === undefined
    ? { PEER_TASK: task }
    : { PEER_RUN: run.id, PEER_RUN_TOKEN: run.token, PEER_TASK: task };

/** Where this computer's runs are kept, as `peer core` reaches them. */
export interface RunsAccess<R = never> {
  /** Every run this computer keeps, newest first. */
  readonly list: Effect.Effect<ReadonlyArray<PeerRun>, CliError.UserError, R>;
  readonly create: (input: RunRequest) => Effect.Effect<CreatedRun, CliError.UserError, R>;
  /** Ends a run (`stopped`); null when this computer has no such run. */
  readonly end: (id: string) => Effect.Effect<PeerRun | null, CliError.UserError, R>;
  /**
   * A new process of a detached run: its variables with a token minted now, and the session to
   * resume when its native id is known.
   */
  readonly continue: (id: string) => Effect.Effect<Continued, CliError.UserError, R>;
  /** Puts a live agent session (its native id, or `<agent>:<id>`) in a run. */
  readonly attach: (id: string, session: string) => Effect.Effect<PeerRun, CliError.UserError, R>;
}

export interface Continued {
  readonly env: Required<RunEnv>;
  readonly resume?: { readonly agent: string; readonly session: string };
}

interface Answer {
  readonly status: number;
  readonly json: Record<string, unknown>;
}

/** One JSON request on the coordination socket. */
export function socketJson(
  socketPath: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<Answer> {
  const text = body === undefined ? "" : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = NodeHttp.request(
      {
        socketPath,
        method,
        host: "peer",
        path,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) },
        timeout: 30_000,
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          raw += chunk;
        });
        response.on("end", () => {
          let json: Record<string, unknown> = {};
          try {
            const value: unknown = JSON.parse(raw || "{}");
            if (typeof value === "object" && value !== null)
              json = value as Record<string, unknown>;
          } catch {
            json = { error: raw.trim() };
          }
          resolve({ status: response.statusCode ?? 0, json });
        });
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new Error("Peer did not answer within 30 s.")));
    request.on("error", reject);
    request.end(text);
  });
}

const errorOf = (answer: Answer) =>
  typeof answer.json.error === "string" && answer.json.error !== ""
    ? answer.json.error
    : `Peer answered HTTP ${answer.status}`;

/** A broker that predates runs answers `/runs` as an unknown route. */
const OLD_BROKER = "this Peer does not keep runs yet; update it";

const NEXT_RUNS = "peer core runs lists this computer's runs and their state.";

/** The broker's refusal of a run route, as the CLI says it. */
const routeRefusal = (answer: Answer, id: string, session?: string) => {
  const error = errorOf(answer);
  if (answer.status === 404 && error === "no such run on this computer")
    return outcome("refused", `no run ${id} on this computer`, NEXT_RUNS);
  if (answer.status === 404 && error === "no live session by that id")
    return outcome(
      "refused",
      `Peer holds no live agent session ${session ?? ""} here`,
      "run it in the shell of an agent this computer's Peer coordinates.",
    );
  if (answer.status === 404 && answer.json.error === undefined)
    return outcome("refused", OLD_BROKER, "update the Peer app or Peer Core, then repeat it.");
  return outcome(answer.status === 409 ? "refused" : "uncertain", error, NEXT_RUNS);
};

/** The runs of the broker that owns the socket. */
export const socketRuns = (socketPath: string): RunsAccess => {
  const call = (method: "GET" | "POST", path: string, body?: unknown) =>
    Effect.tryPromise({
      try: () => socketJson(socketPath, method, path, body),
      catch: (cause) =>
        fail(
          `peer core: could not reach Peer: ${cause instanceof Error ? cause.message : String(cause)}`,
        ),
    });
  const create: RunsAccess["create"] = (input) =>
    Effect.gen(function* () {
      const answer = yield* call("POST", "/runs", { ...input, runtime: "terminal" });
      if (answer.status !== 200 && answer.status !== 201)
        return yield* fail(
          `peer core: ${answer.status === 404 && answer.json.error === undefined ? OLD_BROKER : errorOf(answer)}`,
        );
      return {
        id: String(answer.json.id),
        ...(typeof answer.json.token === "string" ? { token: answer.json.token } : {}),
      };
    });
  return {
    list: Effect.gen(function* () {
      const answer = yield* call("GET", "/runs");
      if (answer.status !== 200) return yield* fail(`peer core: ${errorOf(answer)}`);
      return (answer.json.runs ?? []) as ReadonlyArray<PeerRun>;
    }),
    create,
    end: (id) =>
      Effect.gen(function* () {
        const answer = yield* call("POST", `/runs/${encodeURIComponent(id)}/end`);
        if (answer.status === 404 && String(answer.json.error).startsWith("no run ")) return null;
        if (answer.status !== 200) return yield* fail(`peer core: ${errorOf(answer)}`);
        return answer.json as unknown as PeerRun;
      }),
    continue: (id) =>
      Effect.gen(function* () {
        const answer = yield* call("POST", `/runs/${encodeURIComponent(id)}/continue`);
        if (answer.status !== 200) return yield* routeRefusal(answer, id);
        return answer.json as unknown as Continued;
      }),
    attach: (id, session) =>
      Effect.gen(function* () {
        const answer = yield* call("POST", `/runs/${encodeURIComponent(id)}/attach`, { session });
        if (answer.status !== 200) return yield* routeRefusal(answer, id, session);
        return answer.json.run as PeerRun;
      }),
  };
};

/** The runs of `peer-hub.json`, written by this process: no broker owns the socket. */
export const localRuns: RunsAccess<PeerRuns.PeerRuns> = {
  list: Effect.gen(function* () {
    const runs = yield* PeerRuns.PeerRuns;
    return runs.book.list({}).map(toPeerRun);
  }),
  create: (input) =>
    Effect.gen(function* () {
      const runs = yield* PeerRuns.PeerRuns;
      const created = yield* runs
        .create({ ...input, runtime: "terminal" })
        .pipe(Effect.mapError((error) => fail(`peer core: ${error.detail}`)));
      return {
        id: created.run.id,
        ...(created.token === undefined ? {} : { token: created.token }),
      };
    }),
  end: (id) =>
    Effect.gen(function* () {
      const runs = yield* PeerRuns.PeerRuns;
      const ended = yield* Effect.tryPromise({
        try: () => runs.book.end(id, "stopped"),
        catch: () => fail("peer core: could not save the run."),
      });
      if (ended === undefined) return null;
      // The Hub hears of it now when it can, else when Peer next runs.
      yield* runs.sync;
      return toPeerRun(ended);
    }),
  continue: (id) =>
    Effect.gen(function* () {
      const runs = yield* PeerRuns.PeerRuns;
      const continued = yield* Effect.tryPromise({
        try: () => runs.book.continueEnv(id),
        catch: () => fail("peer core: could not save the run."),
      });
      if (continued === undefined)
        return yield* outcome("refused", `run ${id} has ended`, NEXT_RUNS);
      return {
        env: continued.env,
        ...(continued.resume === undefined
          ? {}
          : { resume: { agent: continued.resume.agent, session: continued.resume.nativeId } }),
      };
    }),
  // The session lives in the broker that holds it; with none running there is none to attach.
  attach: () =>
    Effect.fail(
      outcome(
        "refused",
        "no Peer runs here, and an agent's session lives in the Peer app or Peer Core",
        "open the Peer app or start Peer Core (peer core serve --detach), then repeat it in the agent's shell.",
      ),
    ),
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const startedAt = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

/** A run as `peer core runs` prints it: id, task, agent, runtime, state, sessions, started. */
export const runLine = (run: PeerRun, title: string) =>
  [
    run.id,
    title,
    run.agent,
    run.runtime,
    `${run.state}${run.outcome === undefined ? "" : ` (${run.outcome})`}`,
    plural(run.sessions.length + run.sessionsBefore, "session"),
    `started ${startedAt(run.startedAt)}`,
  ].join(" · ");

/** The run's task as a person reads it: `KEY · title` when the Hub said, else its id. */
export type TitleOf = (run: Pick<PeerRun, "workspace" | "project" | "task">) => string;

/** Whether a run is this person's: an older run kept no address. */
const mine = (run: PeerRun, email: string | null) =>
  run.email === "" || (email !== null && run.email.toLowerCase() === email);

/** `peer core runs [--task <id>] [--all]`: this person's runs here, newest first. */
export const listRuns = <R>(
  access: RunsAccess<R>,
  input: {
    readonly email: string | null;
    /** A task's id, or its key as the title names it. */
    readonly task?: string;
    readonly all: boolean;
    readonly titleOf: TitleOf;
  },
  io: OneShotIo,
) =>
  Effect.gen(function* () {
    const wanted = input.task?.trim();
    const runs = (yield* access.list).filter(
      (run) =>
        mine(run, input.email) &&
        (input.all || run.state !== "ended") &&
        (wanted === undefined ||
          run.task === wanted ||
          input.titleOf(run).split(" · ")[0] === wanted),
    );
    if (runs.length === 0) {
      yield* io.say(
        `Runs: none${input.all ? "" : " that has not ended"}${wanted === undefined ? "" : ` on ${wanted}`} on this computer.${input.all ? "" : " --all lists the ended ones too."}`,
      );
      return;
    }
    for (const run of runs) yield* io.say(runLine(run, input.titleOf(run)));
  });

const NEXT_LIST = "peer core runs lists this computer's runs; repeat the command with one of them.";

const findRun = <R>(access: RunsAccess<R>, id: string, email: string | null) =>
  Effect.gen(function* () {
    const run = (yield* access.list).find((candidate) => candidate.id === id.trim());
    if (run === undefined)
      return yield* outcome("refused", `no run ${id} on this computer`, NEXT_LIST);
    if (!mine(run, email))
      return yield* outcome(
        "refused",
        `run ${run.id} is ${run.email}'s`,
        "its person ends or continues it.",
      );
    return run;
  });

/** `peer core runs end <id>`: the run ends (`stopped`); what its session held is released. */
export const endRun = <R>(
  access: RunsAccess<R>,
  input: { readonly id: string; readonly email: string | null; readonly titleOf: TitleOf },
  io: OneShotIo,
) =>
  Effect.gen(function* () {
    const run = yield* findRun(access, input.id, input.email);
    if (run.state === "ended") {
      yield* io.say(
        `Run ${run.id} on ${input.titleOf(run)} has ended already (${run.outcome ?? "ended"}).`,
      );
      return;
    }
    const ended = yield* access.end(run.id);
    if (ended === null)
      return yield* outcome("refused", `no run ${run.id} on this computer`, NEXT_LIST);
    yield* io.say(`Ended run ${run.id} on ${input.titleOf(run)} (stopped).`);
  });

/** How a terminal run's agent starts again: its command, words, folder and variables. */
export interface Relaunch {
  readonly editor: "claude" | "codex";
  readonly args: ReadonlyArray<string>;
  readonly folder: string;
  readonly env: RunEnv;
}

const isTerminalAgent = (agent: string): agent is "claude" | "codex" =>
  agent === "claude" || agent === "codex";

/**
 * `peer core runs continue <id>` (design D6): a detached terminal run starts again in the run's
 * checkout with the run's variables, resuming its last session where its native id is known
 * (`claude --resume <id>`, `codex resume <id>`), else on the task's prompt. A run of the app's
 * (herdr, a Peer thread) continues in the app.
 */
export const continueRun = <R, RC>(
  access: RunsAccess<R>,
  input: {
    readonly id: string;
    readonly email: string | null;
    readonly titleOf: TitleOf;
    /** The task's title alone, for the prompt. */
    readonly taskTitle: (run: PeerRun) => string;
    readonly checkoutOf: (
      workspace: string,
      project: string,
    ) => Effect.Effect<string | null, never, RC>;
  },
  io: OneShotIo,
) =>
  Effect.gen(function* () {
    const run = yield* findRun(access, input.id, input.email);
    if (run.state === "ended")
      return yield* outcome(
        "refused",
        `run ${run.id} has ended (${run.outcome ?? "ended"})`,
        "start a new one: peer core login, then Start a task.",
      );
    if (run.state === "running")
      return yield* outcome(
        "refused",
        `run ${run.id} is running now (session ${run.sessions.findLast((s) => s.to === undefined)?.id ?? "unknown"})`,
        "go to that agent, or end the run with peer core runs end first.",
      );
    if (run.runtime === "herdr" || run.runtime === "peer")
      return yield* outcome(
        "refused",
        `run ${run.id} ran in the Peer app (${run.runtime === "herdr" ? "herdr" : "a Peer thread"})`,
        "continue it on its task's page in the Peer app.",
      );
    if (run.runtime === "mcp")
      return yield* outcome(
        "refused",
        `run ${run.id} ran in ${run.agent} through Peer's tools`,
        "continue it from that editor.",
      );
    const lastAgent = run.sessions.at(-1)?.id.split(":")[0];
    const planned = lastAgent !== undefined && isTerminalAgent(lastAgent) ? lastAgent : run.agent;
    if (!isTerminalAgent(planned))
      return yield* outcome(
        "refused",
        `peer core starts Claude Code and Codex, not ${run.agent}`,
        `start ${run.agent} on the task yourself; Peer gives it a run of its own.`,
      );
    const folder = yield* input.checkoutOf(run.workspace, run.project);
    if (folder === null)
      return yield* outcome(
        "refused",
        `${run.workspace}/${run.project} has no checkout on this computer`,
        "clone it, bind one with peer core bind, or run peer core runs continue in its folder.",
      );
    const { env, resume } = yield* access.continue(run.id);
    const resumes =
      resume !== undefined && resume.session !== "" && isTerminalAgent(resume.agent)
        ? { agent: resume.agent, session: resume.session }
        : undefined;
    const editor = resumes?.agent ?? planned;
    const args =
      resumes === undefined
        ? [scopePrompt({ kind: "task", id: run.task, title: input.taskTitle(run) })]
        : editor === "claude"
          ? ["--resume", resumes.session]
          : ["resume", resumes.session];
    yield* io.say(
      `Continuing run ${run.id} on ${input.titleOf(run)} — ${editor === "claude" ? "Claude Code" : "Codex"}${resumes === undefined ? ", on the task's prompt" : `, resuming session ${resumes.session}`}.`,
    );
    return { editor, args, folder, env } satisfies Relaunch;
  });

/**
 * `peer core runs attach <run>`: the agent session of the shell it runs in (`PEER_SESSION`, else
 * Codex's `CODEX_THREAD_ID`) joins the run in the broker that holds the session.
 */
export const attachRun = <R>(
  access: RunsAccess<R>,
  input: {
    readonly id: string;
    readonly session: string | undefined;
    readonly titleOf: TitleOf;
  },
  io: OneShotIo,
) =>
  Effect.gen(function* () {
    const session = input.session?.trim();
    if (session === undefined || session === "")
      return yield* outcome(
        "refused",
        "this shell is not an agent's (neither PEER_SESSION nor CODEX_THREAD_ID is set)",
        `run it from inside the agent's shell, or start the agent on the run with peer core runs continue ${input.id}.`,
      );
    const run = yield* access.attach(input.id.trim(), session);
    yield* io.say(`Attached this session to run ${run.id} on ${input.titleOf(run)}.`);
  });

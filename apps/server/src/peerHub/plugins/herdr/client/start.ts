// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - herdr's socket, a pane's new agent checked on the wall clock until it is ready.
/**
 * Starting an agent in herdr: a pane of Peer's own herdr workspace, the agent in it once its shell
 * is ready, and its first prompt once the agent is.
 *
 * @module peerHub/plugins/herdr/client/start
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  call,
  herdrSocketPath,
  HerdrRefused,
  HerdrTransportError,
  NullableString,
  promptHerdrAgent,
} from "./herdr.ts";

export type HerdrHarness = "claude" | "codex";
const HARNESSES: ReadonlySet<string> = new Set<HerdrHarness>(["claude", "codex"]);

/** The herdr workspace Peer starts agents in, so they stay out of the person's own. */
const PEER_WORKSPACE = "Peer agents";

export interface StartHerdrAgentInput {
  readonly cwd: string;
  readonly harness: HerdrHarness;
  /** The first thing the agent is asked, once it is ready for it. */
  readonly prompt?: string | undefined;
  /** Set in the pane's shell, so the agent has it too. */
  readonly env?: Readonly<Record<string, string>> | undefined;
}

export interface StartedHerdrAgent {
  readonly paneId: string;
  readonly terminalId: string;
  /** Set when the agent runs but did not take its prompt (it may wait on an answer first). */
  readonly promptError?: string;
}

export interface StartHerdrAgentOptions {
  readonly socketPath?: string;
  /** Between asking herdr whether the shell or the agent is ready yet. */
  readonly pollMs?: number;
  /** How long a new pane's shell may take to reach its prompt. */
  readonly shellMs?: number;
  /** How long the agent may take to be ready for input. */
  readonly readyMs?: number;
}

const PaneIds = Schema.Struct({ pane_id: Schema.String, terminal_id: Schema.String });
const decodeWorkspaceList = Schema.decodeUnknownOption(
  Schema.Struct({
    type: Schema.Literal("workspace_list"),
    workspaces: Schema.Array(Schema.Struct({ workspace_id: Schema.String, label: Schema.String })),
  }),
);
const decodeSplit = Schema.decodeUnknownOption(
  Schema.Struct({ type: Schema.Literal("pane_info"), pane: PaneIds }),
);
const decodeWorkspaceCreated = Schema.decodeUnknownOption(
  Schema.Struct({
    type: Schema.Literal("workspace_created"),
    workspace: Schema.Struct({ workspace_id: Schema.String }),
    root_pane: PaneIds,
  }),
);
const decodeAgentGet = Schema.decodeUnknownOption(
  Schema.Struct({
    type: Schema.Literal("agent_info"),
    agent: Schema.Struct({
      terminal_id: Schema.String,
      agent_status: Schema.String,
      agent: NullableString,
      name: NullableString,
      interactive_ready: Schema.optional(Schema.Boolean),
      launch_pending: Schema.optional(Schema.Boolean),
    }),
  }),
);
const decodeProcessInfo = Schema.decodeUnknownOption(
  Schema.Struct({
    type: Schema.Literal("pane_process_info"),
    process_info: Schema.Struct({
      shell_pid: Schema.optional(Schema.NullOr(Schema.Number)),
      foreground_process_group_id: Schema.optional(Schema.NullOr(Schema.Number)),
      foreground_processes: Schema.optional(
        Schema.Array(
          Schema.Struct({
            pid: Schema.Number,
            name: Schema.String,
            argv: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
          }),
        ),
      ),
    }),
  }),
);

const SHELL_NAMES: ReadonlySet<string> = new Set([
  "sh",
  "bash",
  "dash",
  "zsh",
  "fish",
  "ksh",
  "mksh",
  "csh",
  "tcsh",
  "elvish",
  "xonsh",
  "nu",
  "pwsh",
  "powershell",
  "cmd",
]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A new pane for an agent: a split of Peer's own herdr workspace if it has one, else a new workspace. */
async function openPane(path: string, input: StartHerdrAgentInput) {
  const env =
    input.env !== undefined && Object.keys(input.env).length > 0 ? { env: input.env } : {};
  const listed = decodeWorkspaceList(await call(path, "workspace.list", {}));
  // The newest one: when an older one's panes are too small to split, a new one is made below.
  const home = Option.isSome(listed)
    ? listed.value.workspaces.findLast((workspace) => workspace.label === PEER_WORKSPACE)
    : undefined;
  if (home !== undefined) {
    try {
      const split = decodeSplit(
        await call(
          path,
          "pane.split",
          {
            workspace_id: home.workspace_id,
            direction: "right",
            cwd: input.cwd,
            focus: false,
            ...env,
          },
          5000,
        ),
      );
      if (Option.isSome(split)) {
        const { pane_id, terminal_id } = split.value.pane;
        return {
          paneId: pane_id,
          terminalId: terminal_id,
          // Only the pane Peer made: the workspace and the agents in it are the person's now.
          undo: () => call(path, "pane.close", { pane_id }).then(() => undefined),
        };
      }
    } catch (error) {
      // Closed since the list, or too crowded to split: make a new one.
      if (!(error instanceof HerdrRefused)) throw error;
    }
  }
  const created = decodeWorkspaceCreated(
    await call(
      path,
      "workspace.create",
      { cwd: input.cwd, label: PEER_WORKSPACE, focus: false, ...env },
      5000,
    ),
  );
  if (Option.isNone(created)) throw new Error("herdr answered in a way Peer does not know");
  const { workspace, root_pane } = created.value;
  return {
    paneId: root_pane.pane_id,
    terminalId: root_pane.terminal_id,
    undo: () =>
      call(path, "workspace.close", { workspace_id: workspace.workspace_id }).then(() => undefined),
  };
}

const isShell = (name: string | null | undefined) =>
  name !== undefined &&
  name !== null &&
  SHELL_NAMES.has(
    NodePath.basename(name)
      .replace(/^-/, "")
      .replace(/\.exe$/i, "")
      .toLowerCase(),
  );

/**
 * Whether the pane's shell still owns its terminal, as herdr's own CLI asks
 * before retrying a start: it is loading its startup files, not busy with
 * something else.
 */
async function shellInitializing(path: string, paneId: string): Promise<boolean> {
  let result: unknown;
  try {
    result = await call(path, "pane.process_info", { pane_id: paneId });
  } catch {
    return false;
  }
  const decoded = decodeProcessInfo(result);
  if (Option.isNone(decoded)) return false;
  const info = decoded.value.process_info;
  const shell = info.shell_pid;
  if (shell === undefined || shell === null || info.foreground_process_group_id !== shell) {
    return false;
  }
  return (info.foreground_processes ?? []).some(
    (process) => process.pid === shell && (isShell(process.name) || isShell(process.argv?.[0])),
  );
}

async function getAgent(path: string, target: string) {
  try {
    const decoded = decodeAgentGet(await call(path, "agent.get", { target }));
    return Option.isSome(decoded) ? decoded.value.agent : null;
  } catch {
    return null;
  }
}

/**
 * `agent.start` only types the command into the shell and answers. Like
 * herdr's CLI, wait until the agent is detected and ready for input, which
 * is what lets it take a prompt. "blocked" is an agent that waits on an
 * answer (a trust prompt) before it is ready: it runs, the person answers.
 */
async function waitUntilReady(
  path: string,
  agent: { readonly name: string; readonly paneId: string; readonly terminalId: string },
  harness: HerdrHarness,
  options: { readonly pollMs: number; readonly readyMs: number },
): Promise<"ready" | "blocked"> {
  const deadline = Date.now() + options.readyMs;
  while (Date.now() < deadline) {
    const info = (await getAgent(path, agent.name)) ?? (await getAgent(path, agent.paneId));
    if (info !== null) {
      if (info.terminal_id !== agent.terminalId || (info.name ?? agent.name) !== agent.name) {
        throw new HerdrRefused("agent_name_not_found", "the pane no longer holds the agent");
      }
      if (info.agent !== undefined && info.agent !== null && info.agent !== harness) {
        throw new HerdrRefused("agent_kind_mismatch", `expected ${harness}, found ${info.agent}`);
      }
      const ready = info.interactive_ready === true;
      if (info.agent_status === "blocked") return "blocked";
      // Codex can stay "unknown" after it is ready.
      if (ready && (info.agent_status === "idle" || info.agent_status === "done")) return "ready";
      if (ready && info.agent_status === "unknown" && harness === "codex") return "ready";
      if (
        !ready &&
        info.launch_pending !== true &&
        (info.agent_status === "idle" || info.agent_status === "done")
      ) {
        throw new HerdrRefused(
          "agent_start_failed",
          "the agent exited before it became interactive",
        );
      }
    }
    await sleep(options.pollMs);
  }
  throw new HerdrRefused("timeout", "the agent was not ready in time");
}

/**
 * Starts a Claude Code or Codex agent in herdr, in `cwd`: in a new pane of
 * Peer's own herdr workspace, which it makes when it has none. Waits for the
 * pane's shell to reach its prompt, then for the agent to be ready, then
 * gives it `prompt`. herdr refusing the start leaves nothing behind; once the
 * command was typed into the pane it stays, for the person to see what happened.
 */
export async function startHerdrAgent(
  input: StartHerdrAgentInput,
  options: StartHerdrAgentOptions = {},
): Promise<StartedHerdrAgent> {
  const path = options.socketPath ?? herdrSocketPath();
  const pollMs = options.pollMs ?? 100;
  const shellMs = options.shellMs ?? 10_000;
  const readyMs = options.readyMs ?? 30_000;
  if (!HARNESSES.has(input.harness)) throw new Error(`Peer cannot start a ${input.harness} agent`);
  if (!NodePath.isAbsolute(input.cwd)) throw new Error("The agent's directory must be a full path");
  if (NodeFS.statSync(input.cwd, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw new Error(`${input.cwd} is not a directory`);
  }
  if (!NodeFS.existsSync(path)) throw new Error("herdr is not running on this computer");

  const pane = await openPane(path, input);
  const name = `peer-${NodeCrypto.randomUUID().slice(0, 8)}`;
  const shellDeadline = Date.now() + shellMs;
  // herdr takes between 3 and 300 seconds for an agent to start.
  const startupMs = Math.min(Math.max(readyMs, 3_001), 300_000);
  for (;;) {
    try {
      await call(
        path,
        "agent.start",
        { name, kind: input.harness, pane_id: pane.paneId, timeout_ms: startupMs },
        5000,
      );
      break;
    } catch (error) {
      // A fresh pane's shell is busy loading its startup files for a moment.
      const waiting =
        error instanceof HerdrRefused &&
        error.code === "agent_pane_busy" &&
        Date.now() < shellDeadline &&
        (await shellInitializing(path, pane.paneId));
      if (!waiting) {
        // A lost reply may have followed a successful launch. Keep that pane:
        // undoing an uncertain start could terminate an agent already at work.
        if (error instanceof HerdrTransportError && error.submitted) {
          throw new Error(
            `The launch could not be confirmed. Inspect pane ${pane.paneId} in herdr before retrying.`,
            { cause: error },
          );
        }
        await pane.undo().catch(() => undefined);
        throw error;
      }
      await sleep(pollMs);
    }
  }

  let ready: "ready" | "blocked";
  try {
    ready = await waitUntilReady(
      path,
      { name, paneId: pane.paneId, terminalId: pane.terminalId },
      input.harness,
      { pollMs, readyMs },
    );
  } catch (error) {
    if (error instanceof HerdrRefused) {
      throw new HerdrRefused(error.code, `${error.message} (see pane ${pane.paneId} in herdr)`);
    }
    throw error;
  }

  const started = { paneId: pane.paneId, terminalId: pane.terminalId };
  if (input.prompt === undefined || input.prompt.trim() === "") return started;
  if (ready === "blocked") {
    return {
      ...started,
      promptError: "the agent waits for an answer in herdr before it can take the prompt",
    };
  }
  try {
    await promptHerdrAgent(pane.paneId, input.prompt, path);
    return started;
  } catch (error) {
    return {
      ...started,
      promptError: error instanceof Error ? error.message : "herdr did not take the prompt",
    };
  }
}

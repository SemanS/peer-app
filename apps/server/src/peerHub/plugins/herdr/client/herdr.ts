// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off preferSchemaOverJson:off - herdr speaks newline-delimited JSON over a local Unix socket; replies are decoded with Schema, and its waits and retry windows run on the wall clock.
/**
 * herdr — the coding agents herdr (https://herdr.dev) runs on this computer,
 * read through its local socket API: `agent.list` names every agent with its
 * state (working, blocked, done, idle), `events.subscribe` says when that
 * changes, `agent.focus` brings one forward in herdr, `agent.prompt` types into
 * one. Starting one is `start.ts`.
 *
 * @module peerHub/plugins/herdr/client/herdr
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { PeerHerdrRuntime, PeerWorkStatus } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export interface HerdrAgent {
  /** Stable while the terminal lives; pane ids move when panes do. */
  readonly terminalId: string;
  readonly paneId: string;
  /** A live name follows the current occupant; prefer it to a pane when prompting. */
  readonly name?: string | undefined;
  readonly agent: string | undefined;
  readonly title: string;
  readonly status: PeerWorkStatus;
  /**
   * herdr's number for the change of state that ended the agent's last piece of
   * work, while it sits idle after it. Startup, restored sessions and switched
   * conversations never set it, and herdr before 0.9.2 sends none, so its
   * absence says nothing by itself.
   */
  readonly completionSeq: number | undefined;
  readonly cwd: string | undefined;
  /**
   * The agent's own session, when an integration reported it to herdr (e.g.
   * `herdr integration install claude`): its id, or the file it keeps.
   */
  readonly session:
    | { readonly id: string | undefined; readonly path: string | undefined }
    | undefined;
}

export const NullableString = Schema.optional(Schema.NullOr(Schema.String));

const AgentInfo = Schema.Struct({
  terminal_id: Schema.String,
  pane_id: Schema.String,
  agent: NullableString,
  agent_status: Schema.String,
  completion_seq: Schema.optional(Schema.NullOr(Schema.Number)),
  cwd: NullableString,
  foreground_cwd: NullableString,
  title: NullableString,
  display_agent: NullableString,
  name: NullableString,
  terminal_title_stripped: NullableString,
  agent_session: Schema.optional(
    Schema.NullOr(Schema.Struct({ kind: Schema.String, value: Schema.String })),
  ),
});

const AgentList = Schema.Struct({
  type: Schema.Literal("agent_list"),
  agents: Schema.Array(AgentInfo),
});
const decodeAgentList = Schema.decodeUnknownOption(AgentList);

const STATUSES: ReadonlySet<string> = new Set(["working", "blocked", "done", "idle", "unknown"]);

/**
 * Where herdr's server listens, resolved the way herdr resolves it:
 * HERDR_SOCKET_PATH, then a named HERDR_SESSION, then the default session
 * under $XDG_CONFIG_HOME (or ~/.config).
 */
export function herdrSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.HERDR_SOCKET_PATH?.trim();
  if (explicit) return explicit;
  const base = NodePath.join(
    env.XDG_CONFIG_HOME?.trim() || NodePath.join(NodeOS.homedir(), ".config"),
    "herdr",
  );
  const session = env.HERDR_SESSION?.trim();
  return session
    ? NodePath.join(base, "sessions", session, "herdr.sock")
    : NodePath.join(base, "herdr.sock");
}

/** herdr answered and refused: its error code (`pane_not_found`, `agent_not_idle`, …) and message. */
export class HerdrRefused extends Error {
  readonly code: string | undefined;
  constructor(code: string | undefined, message: string) {
    super(message);
    this.name = "HerdrRefused";
    this.code = code;
  }
}

export class HerdrTransportError extends Error {
  readonly submitted: boolean;
  constructor(message: string, submitted: boolean) {
    super(message);
    this.submitted = submitted;
  }
}

/** The refusal in an error reply; replies from other herdr versions may leave out the code. */
function refusalOf(error: unknown): HerdrRefused {
  const body = typeof error === "object" && error !== null ? error : {};
  const { code, message } = body as { code?: unknown; message?: unknown };
  return new HerdrRefused(
    typeof code === "string" ? code : undefined,
    String(message ?? "herdr refused the request"),
  );
}

/** One request, one reply, over a fresh connection. */
export function call(
  socketPath: string,
  method: string,
  params: object,
  timeoutMs = 2000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = `peer-${NodeCrypto.randomUUID()}`;
    const socket = NodeNet.createConnection(socketPath);
    let buffer = "";
    let submitted = false;
    let settled = false;
    const finish = (error: Error | null, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error)
        reject(
          error instanceof HerdrRefused ? error : new HerdrTransportError(error.message, submitted),
        );
      else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error("herdr did not answer")), timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      submitted = true;
      socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish(new Error("herdr closed the connection before answering")));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message: { id?: unknown; result?: unknown; error?: unknown };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id !== id) continue;
        if (message.error !== undefined) finish(refusalOf(message.error));
        else finish(null, message.result);
        return;
      }
    });
  });
}

const PingResult = Schema.Struct({
  version: Schema.String,
  protocol: Schema.Number,
  capabilities: Schema.optional(Schema.Unknown),
});
const decodePing = Schema.decodeUnknownOption(PingResult);

/** What herdr says about itself when pinged. */
export interface HerdrPing {
  readonly version: string;
  readonly protocol: number;
  readonly capabilities: ReadonlyArray<string>;
}

/**
 * Whether a herdr server answers at `socketPath`, and what it is. Null when none does: no
 * socket, nothing listening, no answer in time, or an answer that is not herdr's. Fields it adds
 * later are ignored.
 */
export async function pingHerdr(
  socketPath: string = herdrSocketPath(),
  timeoutMs = 2000,
): Promise<HerdrPing | null> {
  if (!NodeFS.existsSync(socketPath)) return null;
  let result: unknown;
  try {
    result = await call(socketPath, "ping", {}, timeoutMs);
  } catch {
    return null;
  }
  const decoded = decodePing(result);
  if (Option.isNone(decoded)) return null;
  const { capabilities } = decoded.value;
  return {
    version: decoded.value.version,
    protocol: decoded.value.protocol,
    capabilities: Array.isArray(capabilities)
      ? capabilities.filter((name): name is string => typeof name === "string")
      : [],
  };
}

function pick(...values: ReadonlyArray<string | null | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/**
 * The agents herdr runs, or null when no herdr server listens here. Agents
 * from a newer herdr with states Peer does not know read as "unknown".
 */
export async function listHerdrAgents(
  socketPath: string = herdrSocketPath(),
): Promise<ReadonlyArray<HerdrAgent> | null> {
  if (!NodeFS.existsSync(socketPath)) return null;
  let result: unknown;
  try {
    result = await call(socketPath, "agent.list", {});
  } catch {
    return null;
  }
  const decoded = decodeAgentList(result);
  if (Option.isNone(decoded)) return null;
  return decoded.value.agents.map((info) => ({
    terminalId: info.terminal_id,
    paneId: info.pane_id,
    ...(pick(info.name) === undefined ? {} : { name: pick(info.name) }),
    agent: pick(info.agent),
    title:
      pick(info.title, info.terminal_title_stripped, info.name, info.display_agent, info.agent) ??
      "agent",
    status: (STATUSES.has(info.agent_status) ? info.agent_status : "unknown") as PeerWorkStatus,
    completionSeq: info.completion_seq ?? undefined,
    cwd: pick(info.foreground_cwd, info.cwd),
    session: sessionOf(info.agent_session),
  }));
}

function sessionOf(
  reported: { readonly kind: string; readonly value: string } | null | undefined,
): HerdrAgent["session"] {
  const value = reported?.value.trim();
  if (value === undefined || value === "") return undefined;
  if (reported?.kind === "path") {
    const file = NodePath.basename(value);
    return {
      id: file.endsWith(".jsonl") ? file.slice(0, -".jsonl".length) : undefined,
      path: value,
    };
  }
  return { id: value, path: undefined };
}

/**
 * What to tell the team an agent is doing. herdr calls finished work "done"
 * only until someone has looked at it, and counts a server with no client
 * attached as looking at its active tab, so a finished agent can read "idle".
 * Its `completion_seq` says the idle state follows real work whoever looked;
 * that is "done" like a Peer thread that settled. Without it herdr's own state
 * stands: older herdr sends none, and so does an agent that finished nothing.
 */
export function herdrWorkStatus(
  agent: Pick<HerdrAgent, "status" | "completionSeq">,
): PeerWorkStatus {
  return agent.status === "idle" && agent.completionSeq !== undefined ? "done" : agent.status;
}

const PaneRead = Schema.Struct({
  type: Schema.Literal("pane_read"),
  read: Schema.Struct({ text: Schema.String }),
});
const decodePaneRead = Schema.decodeUnknownOption(PaneRead);

/** What reading the end of an agent's terminal gave. */
export type HerdrRead =
  | { readonly kind: "text"; readonly text: string }
  /** herdr scrolls a full-screen agent back only while it is idle, so it refused. */
  | { readonly kind: "notIdle" }
  | { readonly kind: "unavailable" };

/** The end of an agent's terminal as plain text, when herdr can read it. */
export async function readHerdrAgent(
  paneId: string,
  lines = 200,
  socketPath: string = herdrSocketPath(),
): Promise<HerdrRead> {
  let result: unknown;
  try {
    result = await call(socketPath, "agent.read", {
      target: paneId,
      source: "recent_unwrapped",
      lines,
      format: "text",
      strip_ansi: true,
    });
  } catch (error) {
    return error instanceof HerdrRefused && error.code === "agent_not_idle"
      ? { kind: "notIdle" }
      : { kind: "unavailable" };
  }
  const decoded = decodePaneRead(result);
  return Option.isSome(decoded)
    ? { kind: "text", text: decoded.value.read.text }
    : { kind: "unavailable" };
}

/** What a view says while herdr will not read the agent's history: it can be read once the agent pauses. */
export function herdrNotIdleHint(status: PeerWorkStatus): string {
  if (status === "blocked") return "blocked — output appears once it is answered";
  if (status === "unknown") return "status unknown — output appears when it pauses";
  return "working — output appears when it pauses";
}

/**
 * The hint under an agent's terminal view: why its history is not shown, and for a Claude Code agent
 * how to follow its conversation instead. With only Peer's herdr there is no `herdr` command to run,
 * so the person installs the integration in Settings.
 */
export function herdrViewHint(
  agent: { readonly agent: string | undefined; readonly status: PeerWorkStatus },
  terminal: { readonly kind: string },
  source: PeerHerdrRuntime["source"],
): string {
  const install =
    source === "peer"
      ? "Settings → Peer → Coordination & plugins"
      : "herdr integration install claude";
  return [
    terminal.kind === "notIdle" ? herdrNotIdleHint(agent.status) : undefined,
    agent.agent === "claude"
      ? `To follow this conversation here instead of its terminal, install herdr's Claude Code integration once: ${install}`
      : undefined,
  ]
    .filter((line) => line !== undefined)
    .join(". ");
}

/** Submits a prompt to an agent, as if typed into its terminal and sent. */
export async function promptHerdrAgent(
  paneId: string,
  text: string,
  socketPath: string = herdrSocketPath(),
): Promise<void> {
  await call(socketPath, "agent.prompt", { target: paneId, text }, 5000);
}

export type HerdrWakeResult = {
  readonly status: "queued" | "uncertain" | "unavailable";
  readonly reason?: string;
};

/**
 * How an agent read just now differs from the one expected: its terminal has no agent (`gone`), it
 * runs another conversation (`session`), it finished another piece of work (`turn`), or it works or
 * waits for an answer (`busy`). The same words as `PeerPromptStale.reason`.
 */
export type HerdrAgentChange = "gone" | "session" | "turn" | "busy";

/**
 * How `fresh`, what was read just now in the terminal of `expected`, differs from `expected`;
 * undefined when it is still that agent: the same kind of agent in the same session (its id and its
 * file) at the same completion, idle or done. An expectation with no session proves nothing, so
 * nothing matches it. The wake and a guarded prompt both type only into an agent that passes.
 */
export function herdrAgentChange(
  fresh: HerdrAgent | undefined,
  expected: HerdrAgent,
): HerdrAgentChange | undefined {
  if (fresh === undefined) return "gone";
  if (
    fresh.agent !== expected.agent ||
    fresh.session?.id !== expected.session?.id ||
    fresh.session?.path !== expected.session?.path ||
    (expected.session?.id === undefined && expected.session?.path === undefined)
  )
    return "session";
  if (fresh.completionSeq !== expected.completionSeq) return "turn";
  if (fresh.status !== "idle" && fresh.status !== "done") return "busy";
  return undefined;
}

/**
 * Re-read identity before waking an idle agent. A lost reply is not retried:
 * herdr may already have typed the marker. Only the receiving hook establishes
 * delivery. herdr has no native-session compare-and-swap on agent.prompt.
 */
export async function wakeHerdrAgent(
  expected: HerdrAgent,
  text: string,
  socketPath: string = herdrSocketPath(),
): Promise<HerdrWakeResult> {
  const fresh = (await listHerdrAgents(socketPath))?.find(
    (agent) => agent.terminalId === expected.terminalId,
  );
  if (fresh === undefined || herdrAgentChange(fresh, expected) !== undefined)
    return { status: "unavailable", reason: "Agent identity or idle state changed." };
  try {
    await promptHerdrAgent(fresh.name ?? fresh.paneId, text, socketPath);
    return { status: "queued" };
  } catch (error) {
    return {
      status: error instanceof HerdrTransportError && error.submitted ? "uncertain" : "unavailable",
      reason: error instanceof Error ? error.message : "herdr did not take the marker",
    };
  }
}

/** Brings the agent's pane forward in herdr's attached client. */
export async function focusHerdrAgent(
  paneId: string,
  socketPath: string = herdrSocketPath(),
): Promise<void> {
  await call(socketPath, "agent.focus", { target: paneId });
}

/** Shows a notification through herdr's attached client; nothing when herdr is not running. */
export async function notifyHerdr(
  title: string,
  body: string,
  socketPath: string = herdrSocketPath(),
): Promise<void> {
  if (!NodeFS.existsSync(socketPath)) return;
  await call(socketPath, "notification.show", { title, body, sound: "request" }).catch(
    () => undefined,
  );
}

/**
 * How a subscription ended, or never began: herdr's server went away; it
 * dropped a subscriber that fell behind (`events_lost`); it refused the whole
 * request because a pane in it no longer exists; or it refused it some other
 * way, as herdr before events did.
 */
export type HerdrWatchEnd = "gone" | "events-lost" | "pane-gone" | "refused";

export interface HerdrWatch {
  /** "started" once herdr has acknowledged the subscription, else how it ended instead. */
  readonly started: Promise<"started" | HerdrWatchEnd>;
  readonly close: () => void;
}

const ACK_TIMEOUT_MS = 5_000;

/**
 * Calls `onChange` whenever herdr reports an agent appearing or going away
 * anywhere, or one of `paneIds` changing state; the events only say that
 * something changed, `agent.list` says what. herdr keeps no history, so only
 * what happens after `started` resolves "started" is heard. After that,
 * `onEnd` says why the subscription ended on its own (not after `close`).
 */
export function watchHerdrAgents(input: {
  readonly paneIds: ReadonlyArray<string>;
  readonly onChange: () => void;
  readonly onEnd: (reason: HerdrWatchEnd) => void;
  readonly socketPath?: string;
  readonly ackTimeoutMs?: number;
}): HerdrWatch {
  const id = `peer-watch-${NodeCrypto.randomUUID()}`;
  const socket = NodeNet.createConnection(input.socketPath ?? herdrSocketPath());
  const started = Promise.withResolvers<"started" | HerdrWatchEnd>();
  let buffer = "";
  let acknowledged = false;
  let ended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const end = (reason: HerdrWatchEnd) => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    socket.destroy();
    started.resolve(reason);
    if (acknowledged) input.onEnd(reason);
  };
  // A herdr that never answers is as good as one that refuses.
  timer = setTimeout(() => end("refused"), input.ackTimeoutMs ?? ACK_TIMEOUT_MS);
  socket.setEncoding("utf8");
  socket.on("connect", () => {
    const subscriptions = [
      { type: "pane.agent_detected" },
      { type: "pane.exited" },
      { type: "pane.closed" },
      ...input.paneIds.map((paneId) => ({ type: "pane.agent_status_changed", pane_id: paneId })),
    ];
    socket.write(
      `${JSON.stringify({ id, method: "events.subscribe", params: { subscriptions } })}\n`,
    );
  });
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let message: { id?: unknown; event?: unknown; error?: unknown };
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof message.event === "string") input.onChange();
      else if (message.id === id && message.error !== undefined) {
        const { code } = refusalOf(message.error);
        if (code === "events_lost") end("events-lost");
        // One unknown pane rejects the whole request, and only before it is acknowledged.
        else if (!acknowledged && (code === "pane_not_found" || code === "not_found")) {
          end("pane-gone");
        } else end("refused");
      } else if (message.id === id && !acknowledged) {
        acknowledged = true;
        clearTimeout(timer);
        started.resolve("started");
      }
    }
  });
  socket.on("error", () => end("gone"));
  socket.on("close", () => end("gone"));
  return {
    started: started.promise,
    close: () => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      socket.destroy();
      started.resolve("gone");
    },
  };
}

export interface HerdrFollower {
  /**
   * The agents herdr runs, listed once herdr's events are flowing, or null
   * when no herdr server listens here. Reads queue up behind one another.
   */
  readonly read: () => Promise<ReadonlyArray<HerdrAgent> | null>;
  /** Whether herdr's events are flowing; when they are not, the caller reads on a timer. */
  readonly live: () => boolean;
  readonly close: () => void;
}

const SUBSCRIBE_ATTEMPTS = 4;
const READ_ROUNDS = 4;

/**
 * Keeps herdr's events flowing and reads its agents the way herdr advises:
 * subscribe first, list after. herdr keeps no history, so a change between a
 * list and the subscription behind it would not be heard of until the next
 * read. `onChange` says to read again: an event, or events lost.
 *
 * - A subscription follows the panes that run agents, so it is made again when
 *   a list shows others. A pane that vanished meanwhile makes herdr refuse the
 *   whole request; the panes are listed again and the rest subscribed.
 * - A subscriber that fell behind (`events_lost`) is dropped by herdr; the next
 *   read subscribes again before it lists.
 * - Only a herdr that refuses events altogether is left to polling, and asked
 *   again after `retryMs`.
 */
export function followHerdrAgents(input: {
  readonly onChange: () => void;
  /** Where herdr listens; a function is asked at each read, for a herdr that can change. */
  readonly socketPath?: string | (() => string);
  readonly retryMs?: number;
  /** The clock `retryMs` runs on; a test moves it instead of waiting. */
  readonly now?: () => number;
}): HerdrFollower {
  const retryMs = input.retryMs ?? 15_000;
  const now = input.now ?? Date.now;
  let watch: {
    readonly handle: HerdrWatch;
    readonly panes: string;
    readonly path: string;
  } | null = null;
  let known: ReadonlyArray<string> = [];
  let eventsAfter = 0;
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();

  const paneIdsOf = (agents: ReadonlyArray<HerdrAgent>) =>
    agents.map((agent) => agent.paneId).toSorted();
  const keyOf = (panes: ReadonlyArray<string>) => panes.join(" ");
  const stop = () => {
    watch?.handle.close();
    watch = null;
  };

  const subscribe = async (path: string, wanted: ReadonlyArray<string>): Promise<void> => {
    if (now() < eventsAfter) return;
    if (watch !== null && watch.panes === keyOf(wanted) && watch.path === path) return;
    stop();
    let panes = wanted;
    for (let attempt = 0; attempt < SUBSCRIBE_ATTEMPTS; attempt++) {
      if (closed) return;
      // herdr may drop a subscriber right after acknowledging it, while it is still starting up.
      let droppedAtOnce = false;
      const handle: HerdrWatch = watchHerdrAgents({
        paneIds: panes,
        onChange: input.onChange,
        onEnd: (reason) => {
          droppedAtOnce = true;
          if (watch?.handle === handle) watch = null;
          // An error mid-stream would only repeat; leave events alone for a while.
          if (reason === "refused") eventsAfter = now() + retryMs;
          input.onChange();
        },
        socketPath: path,
      });
      const outcome = await handle.started;
      if (closed) {
        handle.close();
        return;
      }
      if (outcome === "started" && !droppedAtOnce) {
        watch = { handle, panes: keyOf(panes), path };
        return;
      }
      if (now() < eventsAfter) return;
      if (outcome === "gone" || outcome === "refused") break;
      if (outcome === "pane-gone") {
        // A pane left between the list and the subscription: who is there now?
        const present = await listHerdrAgents(path);
        if (present === null) return;
        panes = paneIdsOf(present);
      }
      // Events lost while subscribing, or the panes just refreshed: subscribe again at once.
    }
    // No subscription to be had: poll for a while, then ask again.
    eventsAfter = now() + retryMs;
  };

  const readOnce = async (): Promise<ReadonlyArray<HerdrAgent> | null> => {
    const path =
      typeof input.socketPath === "function"
        ? input.socketPath()
        : (input.socketPath ?? herdrSocketPath());
    if (closed) return listHerdrAgents(path);
    // A herdr at another place is another herdr: its panes and events are not the old one's.
    if (watch !== null && watch.path !== path) {
      stop();
      known = [];
      eventsAfter = 0;
    }
    if (!NodeFS.existsSync(path)) {
      stop();
      known = [];
      return null;
    }
    let agents: ReadonlyArray<HerdrAgent> | null = null;
    for (let round = 0; round < READ_ROUNDS; round++) {
      await subscribe(path, known);
      agents = await listHerdrAgents(path);
      if (agents === null) {
        stop();
        known = [];
        return null;
      }
      known = paneIdsOf(agents);
      // Done when the subscription follows exactly these panes, or herdr has no events to follow.
      if (closed || now() < eventsAfter || (watch !== null && watch.panes === keyOf(known))) break;
    }
    return agents;
  };

  return {
    read: () => {
      const run = queue.then(readOnce, readOnce);
      queue = run.catch(() => undefined);
      return run;
    },
    live: () => watch !== null,
    close: () => {
      closed = true;
      stop();
    },
  };
}

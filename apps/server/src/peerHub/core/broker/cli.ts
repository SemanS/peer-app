// @effect-diagnostics nodeBuiltinImport:off globalDate:off - the peer command's requests on the broker's socket, and its caller in wall-clock time.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * The `peer` command agents run: core's commands and the plugins', `peer help`, and how long the
 * `peer` shim waits for each command.
 *
 * Core's commands are coordination's own (status, claims, the index, runs, tasks); the broker runs
 * them. A plugin's command runs while its plugin is active. While it is not, it answers
 * 409 with one line and touches nothing, and `peer help` leaves it out. The shim's waits come from
 * every registered command, active or not, so turning a plugin on or off never rewrites the shim.
 *
 * @module peerHub/core/broker/cli
 */
import { pluginsForWorkspace } from "./pluginScope.ts";
import * as NodeHttp from "node:http";
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { clip, cutText, neutral } from "../../peerText.ts";
import { generatedFile } from "../coordination/edits.ts";
import { statusText } from "../coordination/news.ts";
import { BOARD_ALL } from "../index/board.ts";
import { type CommandsOn, INDEX_ALL, indexText } from "../index/text.ts";
import type { PeerCommand } from "../plugin.ts";
import { CORE_COMMANDS } from "../registry.ts";
import type { CoordinationBroker } from "./Broker.ts";
import type { PeerBrokerPlugins } from "./host.ts";
import { CliError, hubRead, refused, uncertain, usage } from "./cliContract.ts";
import { PUBLIC_COMMANDS, publicCli } from "./publicCli.ts";
import { headerOf } from "./server.ts";
import { inRepository, type LocalSession, unsupportedCheckout } from "./sessions.ts";
import { sessionTaskName, TASK_FLAGS, TASK_SWITCHES, taskCommand } from "./tasks.ts";
import { SHARE_FLAGS, shareCommand, UNSHARED } from "./share.ts";
import { helpText } from "./help.ts";

/** How long the `peer` shim waits for Peer's answer to a command that says nothing else. */
export const DEFAULT_WAIT_SECONDS = 15;

/** The commands of the active plugins, which Peer's own texts may name. */
export function commandsOn(plugins: PeerBrokerPlugins): CommandsOn {
  const on = new Set(
    plugins.commands.flatMap(({ command, refused }) =>
      refused === undefined ? [command.name] : [],
    ),
  );
  return (name) => on.has(name);
}

/**
 * What `peer <name>` is among the plugins' commands: one to run, or one to refuse, as an inactive
 * plugin's is, including a command of a plugin this build excludes.
 */
export function pluginCommand(
  plugins: PeerBrokerPlugins,
  name: string,
):
  | { readonly run: PeerCommand }
  | { readonly refusal: string; readonly next?: string }
  | undefined {
  const found = plugins.commands.find(({ command }) => command.name === name);
  if (found === undefined) return undefined;
  if (found.refused === undefined) return { run: found.command };
  if (found.refused === "hub-unknown") {
    return {
      refusal: `peer: ${name} waits for a Peer Hub: it works once Peer is signed in and its Hub answers.`,
      next: "ask your person to sign Peer in to its Hub, or retry once the Hub can be reached.",
    };
  }
  return {
    refusal:
      found.refused === "off"
        ? `peer: ${name} is turned off on this environment.`
        : found.unserved === undefined
          ? `peer: ${name} needs a newer Peer Hub.`
          : `peer: ${found.unserved}.`,
  };
}

/** A command's arguments as its handler reads them. */
export interface CommandArguments {
  readonly args: ReadonlyArray<string>;
  /** The arguments without `--flags` and their values. */
  readonly plain: ReadonlyArray<string>;
  /** The plain arguments joined on one line, clipped to 600 characters. */
  readonly text: string;
  readonly flag: (name: `--${string}`) => string | undefined;
}

export function commandArguments(args: ReadonlyArray<string>): CommandArguments {
  const plain = args.filter((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--"));
  return {
    args,
    plain,
    text: cutText(plain.join(" ").replace(/\s+/g, " ").trim(), 600),
    flag: (name) => {
      const at = args.indexOf(name);
      return at < 0 ? undefined : args[at + 1];
    },
  };
}

const CORE_FLAGS: Readonly<Record<string, ReadonlyArray<string>>> = {
  log: ["--task", "--path"],
  task: TASK_FLAGS,
  share: SHARE_FLAGS,
};
/** Core flags that take no value. */
const CORE_SWITCHES: Readonly<Record<string, ReadonlyArray<string>>> = { task: TASK_SWITCHES };

/** Validate core flags before selecting a caller or changing its claims. Plugins decode their own. */
/** The files a claim or a release names, each inside this repository. */
const claimedFiles = (
  plain: ReadonlyArray<string>,
  relative: (path: string) => string | null,
): ReadonlyArray<string> =>
  plain.map((path) => {
    const normalized = /^[a-z][a-z0-9-]*:/.test(path) ? null : relative(path);
    if (normalized === null)
      throw usage(
        "name files or directories (ending in /) inside this repository",
        "run peer claim src/pay.ts.",
      );
    return path.endsWith("/") && !normalized.endsWith("/") ? `${normalized}/` : normalized;
  });

function validateCoreArguments(command: string, args: ReadonlyArray<string>) {
  const flags: ReadonlyArray<string> = CORE_FLAGS[command] ?? [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--") || CORE_SWITCHES[command]?.includes(arg)) continue;
    if (!flags.includes(arg) || args[i + 1] === undefined || args[i + 1]!.startsWith("--"))
      throw usage(
        `invalid or incomplete flag ${arg}`,
        `run peer ${command} --help for the command's form.`,
      );
    i++;
  }
}

const COMMAND_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * The commands the `peer` shim waits longer for than `DEFAULT_WAIT_SECONDS`, and how long: every
 * plugin's, active or not.
 */
export function longerWaits(plugins: PeerBrokerPlugins): ReadonlyArray<readonly [string, number]> {
  return plugins.commands
    .map(({ command }) => command)
    .flatMap(({ name, waitSeconds }) =>
      waitSeconds === undefined ||
      waitSeconds === DEFAULT_WAIT_SECONDS ||
      !COMMAND_NAME.test(name) ||
      !Number.isInteger(waitSeconds) ||
      waitSeconds < 1
        ? []
        : [[name, waitSeconds] as const],
    );
}

/** The caller, on the project of the folder it runs in where its run works in several. */
export async function callerOf(
  this: CoordinationBroker,
  headers: NodeHttp.IncomingHttpHeaders,
  command?: string,
): Promise<LocalSession> {
  const session = await namedCaller.call(this, headers);
  const cwd = headerOf(headers, "x-peer-cwd");
  // A shared room is the run's own, whichever folder its shell stands in.
  if (cwd === undefined || command === "room" || inRepository(session, cwd) !== null)
    return session;
  return (await this.companionAt(session, cwd)) ?? session;
}

/** Verify only the named session; a person's shell is never attributed by heuristics. */
async function namedCaller(
  this: CoordinationBroker,
  headers: NodeHttp.IncomingHttpHeaders,
): Promise<LocalSession> {
  const explicit = headerOf(headers, "x-peer-session");
  if (explicit === undefined)
    throw refused(
      "this call does not come from an agent session, so Peer cannot tell who is acting",
      "run peer from the shell of an agent session (Claude Code or Codex with Peer's hooks installed). A person uses the Peer app: Work, then the task.",
    );
  const session =
    this.sessions.get(explicit) ??
    [...this.sessions.values()].find((s) => s.id === `${s.agent}:${explicit}`);
  const id = explicit.replace(/^(claude|codex):/, "").slice(0, 12);
  const cwd = headerOf(headers, "x-peer-cwd");
  if (session === undefined && cwd !== undefined && (await this.host.placeOf(cwd)) === null)
    throw UNSHARED(cwd);
  if (session === undefined)
    throw refused(
      `Peer has no registered agent session ${id} (hooks not installed or not trusted, the directory is outside a workspace project, or the session ended)`,
      "install and trust Peer's hooks for this agent in Settings → Peer → Coordination & plugins, then start a new session in the project.",
    );
  const token = headerOf(headers, "x-peer-session-token");
  if (
    process.env.PEER_CLI_CREDENTIAL === "session-id" ||
    session.agent === "codex" ||
    (session.credential === undefined && token === undefined)
  ) {
    this.record("cli.id-only", { session: session.id, agent: session.agent });
    return session;
  }
  if (token === undefined)
    throw refused(
      `this shell does not hold the credential of session ${id}: PEER_SESSION_TOKEN is missing`,
      "run peer from the agent's own shell. If a tool removes PEER_SESSION_TOKEN from commands, ask your person to set PEER_CLI_CREDENTIAL=session-id for Peer.",
    );
  const credential = NodeCrypto.createHash("sha256").update(token).digest();
  if (
    session.credential !== undefined &&
    !NodeCrypto.timingSafeEqual(session.credential, credential)
  )
    throw refused(
      `this shell does not hold the current credential of session ${id}: its token belongs to an earlier run`,
      "run peer from the session's current process; after a resume, commands started by the earlier process no longer work.",
    );
  if (session.credential === undefined) {
    session.credential = credential;
    this.record("credential.bound", { session: session.id, source: "first-use" });
  }
  return session;
}

export async function runCli(
  this: CoordinationBroker,
  command: string,
  args: ReadonlyArray<string>,
  headers: NodeHttp.IncomingHttpHeaders,
  verifiedSession?: LocalSession,
): Promise<string> {
  if (
    command === "help" ||
    command === "--help" ||
    command === "-h" ||
    (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))
  )
    return this.help();
  let plugins = await this.plugins();
  let owned = pluginCommand(plugins, command);
  if (!(CORE_COMMANDS as readonly string[]).includes(command) && owned === undefined)
    throw usage(`${command} is not a command`, "run peer help for the commands.");
  if (args.some((arg) => arg.length > 20_000) || args.length > 200)
    throw usage(
      "command arguments exceed the limit",
      `use at most 200 arguments of at most 20000 characters; run peer ${command} --help for its form.`,
    );
  if (owned === undefined) validateCoreArguments(command, args);
  const publicCommand = plugins.commands.find((entry) => entry.command.name === command)?.command
    .public;
  // Sharing explicitly enrolls a local repository in a team workspace.
  if (command === "share") return shareCommand(this, args, headers);
  // A tool call comes with its verified session: a plugin's public command then acts for that agent,
  // as it does for a shell that sends the session header. Core's public reads stay public.
  const named =
    headerOf(headers, "x-peer-session") !== undefined ||
    (verifiedSession !== undefined && publicCommand === true);
  if ((PUBLIC_COMMANDS.has(command) || publicCommand === true) && !named)
    return publicCli(this, command, args, headers);
  const session = verifiedSession ?? (await this.callerOf(headers, command));
  plugins = pluginsForWorkspace(plugins, session.workspace);
  owned = pluginCommand(plugins, command);
  // A CLI read never makes another agent active or cancels its wait for a note.
  const parsed = commandArguments(args);
  const { flag, plain } = parsed;
  if (owned !== undefined && "refusal" in owned)
    throw refused(
      owned.refusal.replace(/^peer: /, ""),
      owned.next ?? "ask your person to enable the plugin or update the Peer Hub, then retry.",
    );
  if (owned !== undefined) {
    const answer = await this.host.run(
      Effect.result(
        owned.run.run({
          ...parsed,
          session: this.sessionView(session),
          cwd: headerOf(headers, "x-peer-cwd"),
        }),
      ),
      { signal: this.stopping.signal },
    );
    if (Result.isFailure(answer)) {
      const error = answer.failure;
      if (error instanceof CliError) throw error;
      const reason = error.message.replace(/^peer: /, "");
      throw error.status === 400
        ? usage(reason, owned.run.usage)
        : error.status >= 400 && error.status < 500
          ? refused(reason, "run peer status and retry when the requirement is met.")
          : uncertain(command);
    }
    return answer.success;
  }
  const view = () => this.merged(session.workspace, this.views.get(session.workspace));
  switch (command) {
    case "status": {
      await this.syncNow(session.workspace, 3000);
      const board = this.board(session, BOARD_ALL);
      const projectTasks = this.host.tasks(session.workspace, session.project);
      const task = projectTasks.find((task) => task.id === session.task);
      const out = statusText({
        mine: {
          claims: session.claims,
          ...(task === undefined
            ? {}
            : {
                task: {
                  name: sessionTaskName(
                    projectTasks,
                    task,
                    this.host.taskName(session.workspace, session.project, task.id),
                  ),
                  status: task.status ?? "open",
                },
              }),
        },
        me: this.asHub(session),
        view: view(),
        nameOf: this.nameOf(session.workspace),
        taskName: this.taskNamer(session.workspace, session.project),
        board,
        cli: this.cli,
        on: commandsOn(plugins),
        unsupported: await unsupportedCheckout(session),
      });
      this.markSeen(session);
      return out;
    }
    case "claim": {
      const cwd = headerOf(headers, "x-peer-cwd") ?? session.cwd;
      if (plain.length === 0)
        throw usage("name at least one claim target", "run peer claim src/pay.ts.");
      const claimed = claimedFiles(plain, (path) => inRepository({ ...session, cwd }, path));
      session.claims = [...new Set([...session.claims, ...claimed])];
      const intent = flag("--intent");
      if (intent !== undefined) session.intent = clip(intent, 300);
      this.markDirty();
      const { answers, verified } = await this.decideEdits(session, claimed, { plugins });
      this.record("claim", {
        session: session.id,
        claimed,
        intent: session.intent,
        contested: answers.flatMap(({ answer }) => answer.with),
      });
      return claimed
        .map((path) => {
          if (generatedFile(path)) return `${neutral(path)}: not coordinated — generated file.`;
          const answer = (
            answers.find(({ file }) => file === path) ??
            (answers.length === 1 ? answers[0] : undefined)
          )?.answer;
          const reason =
            answer?.context ??
            (verified
              ? "No other agent holds this path."
              : "The Hub could not be reached, so nobody heard of this claim yet.");
          const verdict = answer?.context !== undefined || !verified ? "notify" : "clear";
          return `${neutral(path)}: ${verdict} — ${neutral(clip(reason, 600))}`;
        })
        .join("\n");
    }
    case "release": {
      const cwd = headerOf(headers, "x-peer-cwd") ?? session.cwd;
      const files = claimedFiles(plain, (path) => inRepository({ ...session, cwd }, path));
      session.claims =
        plain.length === 0
          ? []
          : session.claims.filter((c) => !files.some((p) => c === p || c.endsWith(p)));
      this.markDirty();
      this.record("release", { session: session.id, claims: session.claims });
      const text =
        session.claims.length === 0
          ? "Released all claims."
          : `Still claimed: ${session.claims.join(", ")}`;
      const held = [...(session.intentPaths ?? [])].filter(
        (path) =>
          plain.length === 0 || plain.some((named) => path === named || path.endsWith(named)),
      );
      return [
        text,
        ...held.map((path) => `${neutral(path)}: held until this session ends (Hub path intents).`),
      ].join("\n");
    }
    case "log":
      return coordinationLog(this, session, flag("--task"), flag("--path"));
    case "run":
      return this.runCommand(session);
    case "task":
      return taskCommand(this.host, session, parsed);
    case "index": {
      // The project's other work, as at a start but all of it.
      await this.syncNow(session.workspace, 3000);
      const all = this.board(session, Number.POSITIVE_INFINITY);
      const pages = Math.max(1, Math.ceil(all.length / INDEX_ALL));
      const page = Number(plain[0] ?? 1);
      if (!Number.isInteger(page) || page < 1 || page > pages)
        throw usage(`choose an index page from 1 to ${pages}`, "run peer index <page>.");
      const result =
        indexText({
          works: all.slice((page - 1) * INDEX_ALL, page * INDEX_ALL),
          cli: this.cli,
          shown: INDEX_ALL,
          full: true,
        }) ?? "peer: no other work on this project now.";
      return `${result}${pages > 1 ? `\nPage ${page}/${pages}.${page < pages ? ` Next: ${this.cli} index ${page + 1}` : ""}` : ""}`;
    }
    default:
      throw usage(`${command} is not a command`, "run peer help for the commands.");
  }
}

/** `peer log`: the project's history as the Hub committed it, or of one task or path. */
export async function coordinationLog(
  broker: CoordinationBroker,
  place: { readonly workspace: string; readonly project: string },
  taskHandle: string | undefined,
  path: string | undefined,
): Promise<string> {
  const coordEvents = broker.host.coordEvents;
  if (coordEvents === undefined)
    throw refused(
      "this Hub does not provide coordination history",
      "ask your person to update the Peer Hub.",
    );
  const { workspace, project } = place;
  const task =
    taskHandle === undefined ? undefined : broker.taskNamed(workspace, project, taskHandle);
  const events = await hubRead(
    "log",
    () =>
      coordEvents(workspace, project, {
        ...(task === undefined ? {} : { task }),
        ...(path === undefined ? {} : { path }),
        limit: 50,
      }),
    "run peer log again when the Hub is reachable.",
  );
  return events.length === 0
    ? "No coordination events yet."
    : events
        .map((event) => `${event.at} ${event.kind} ${event.task ?? ""} ${event.paths.join(", ")}`)
        .join("\n");
}

/** `peer help`: core's commands, then the active plugins'. */
export async function help(this: CoordinationBroker): Promise<string> {
  return helpText(this.cli, await this.plugins());
}

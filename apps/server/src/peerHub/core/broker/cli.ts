// @effect-diagnostics nodeBuiltinImport:off globalDate:off - the peer command's requests on the broker's socket, and its caller in wall-clock time.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * The `peer` command agents run: core's commands and the plugins', `peer help`, and how long the
 * `peer` shim waits for each command.
 *
 * Core's commands are coordination's own (status, notes, claims, contexts, the index, handoff); the
 * broker runs them. A plugin's command runs while its plugin is active. While it is not, it answers
 * 409 with one line and touches nothing, and `peer help` leaves it out. The shim's waits come from
 * every registered command, active or not, so turning a plugin on or off never rewrites the shim.
 *
 * @module peerHub/core/broker/cli
 */
import * as NodeHttp from "node:http";

import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import {
  closerOf,
  describe,
  scopeOf,
  shortId,
  statusText,
  touches,
  type CommandsOn,
} from "../../coordination.ts";
import { clip, cutText } from "../../peerText.ts";
import { discoveryKey, INDEX_ALL, indexText } from "../../teamIndex.ts";
import { BOARD_ALL } from "../index/board.ts";
import type { PeerCommand } from "../plugin.ts";
import { CORE_COMMANDS } from "../registry.ts";
import type { CoordinationBroker } from "./Broker.ts";
import type { PeerBrokerPlugins } from "./host.ts";
import { messageOf } from "./log.ts";
import { CliError, headerOf } from "./server.ts";
import { inRepository, type LocalSession } from "./sessions.ts";
import { newOp } from "./sync.ts";

/** How long the `peer` shim waits for Peer's answer to a command that says nothing else. */
export const DEFAULT_WAIT_SECONDS = 15;

/** A command's line in `peer help`. */
interface HelpLine {
  readonly name: string;
  readonly usage: string;
  readonly summary: string;
  /**
   * Where its summary starts, counted from its usage: 27, or two past a longer usage. A few lines
   * keep the column they always had.
   */
  readonly column?: number;
}

/** Core's commands as `peer help` lists them, in `CORE_COMMANDS` order; `help` lists none. */
const CORE_HELP: { readonly [Name in Exclude<(typeof CORE_COMMANDS)[number], "help">]: HelpLine } =
  {
    status: {
      name: "status",
      usage: "status",
      summary: "who works on what in this project, your overlaps and their notes",
    },
    note: {
      name: "note",
      usage: 'note "<text>"',
      summary: "a note to the agents you share files with (they hear it at their next step)",
    },
    resolve: {
      name: "resolve",
      usage: 'resolve "<agreement>"',
      summary: "close your open overlaps with what was agreed",
    },
    claim: {
      name: "claim",
      usage: 'claim <path>... [--intent "<why>"]',
      summary: "files or directories/ you are about to change",
      column: 37,
    },
    release: { name: "release", usage: "release [<path>...]", summary: "drop claims" },
    index: {
      name: "index",
      usage: "index [<page>]",
      summary: "the project's work and its .ai, to choose what you need from",
    },
    context: {
      name: "context",
      usage: "context [<task>] [history|<version>]",
      summary: "a work's shared context (yours by default), its versions, or one",
    },
    ack: {
      name: "ack",
      usage: "ack <task>",
      summary: "explicitly accept a changed shared context version",
    },
    review: {
      name: "review",
      usage: "review",
      summary:
        "hand your assigned task over for review after publishing context and checking inputs",
    },
    done: {
      name: "done",
      usage: "done",
      summary: "finish your assigned task only after all linked PRs have merged",
    },
    log: {
      name: "log",
      usage: "log [--task <key>] [--path <path>]",
      summary: "committed coordination history",
      column: 35,
    },
  };

const helpLine = (cli: string, line: HelpLine) =>
  `  ${cli} ${line.usage.padEnd(line.column ?? Math.max(27, line.usage.length + 2))}${line.summary}`;

/** `peer help`: core's commands, then the active plugins' in registry order. */
export function helpText(cli: string, plugins: PeerBrokerPlugins): string {
  return [
    "peer — coordinate with the other agents on this project through Peer.",
    ...CORE_COMMANDS.flatMap((name) => (name === "help" ? [] : [CORE_HELP[name]])).map((line) =>
      helpLine(cli, line),
    ),
    ...plugins.commands.flatMap(({ command, refused }) =>
      refused === undefined ? [helpLine(cli, command)] : [],
    ),
  ].join("\n");
}

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
): { readonly run: PeerCommand } | { readonly refusal: string } | undefined {
  const found =
    plugins.commands.find(({ command }) => command.name === name) ??
    plugins.excluded.find((excluded) => excluded.name === name);
  if (found === undefined) return undefined;
  if (found.refused === undefined) return { run: found.command };
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

/**
 * The session that runs a `peer` command: the one its `X-Peer-Session` names, if known. Without
 * one, the latest in its herdr pane, the one whose Bash hook let `peer` through in the last 15
 * seconds, or the latest in whose checkout it runs.
 */
export async function callerOf(
  this: CoordinationBroker,
  headers: NodeHttp.IncomingHttpHeaders,
): Promise<LocalSession | null> {
  const explicit = headerOf(headers, "x-peer-session");
  if (explicit !== undefined) {
    const session =
      this.sessions.get(explicit) ??
      [...this.sessions.values()].find((s) => s.id === `${s.agent}:${explicit}`);
    return session ?? null;
  }
  const pane = headerOf(headers, "x-herdr-pane");
  const recent = [...this.sessions.values()].toSorted((a, b) => b.lastActivity - a.lastActivity);
  if (pane !== undefined) {
    const inPane = recent.find((s) => s.pane === pane);
    if (inPane !== undefined) return inPane;
  }
  if (this.lastCli !== null && Date.now() - this.lastCli.at < 15_000) {
    const session = this.sessions.get(this.lastCli.session);
    if (session !== undefined) return session;
  }
  const cwd = headerOf(headers, "x-peer-cwd");
  if (cwd === undefined) return null;
  return recent.find((s) => cwd === s.root || cwd.startsWith(`${s.root}/`)) ?? null;
}

export async function runCli(
  this: CoordinationBroker,
  command: string,
  args: ReadonlyArray<string>,
  headers: NodeHttp.IncomingHttpHeaders,
): Promise<string> {
  if (
    command === "help" ||
    command === "--help" ||
    command === "-h" ||
    (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))
  )
    return this.help();
  const session = await this.callerOf(headers);
  if (session === null) {
    throw new CliError(
      409,
      "peer: no agent session of yours is known here. Check that Peer's hooks are installed and trusted for this Codex profile, then start a new session in the workspace project.",
    );
  }
  // Not a sign the agent is at work: its own commands come in a tool call its hooks already
  // reported, and anyone else's (a person's, say) must not cancel its wait for a note.
  const parsed = commandArguments(args);
  const { flag, plain, text } = parsed;
  const plugins = await this.plugins();
  const owned = pluginCommand(plugins, command);
  if (owned !== undefined && "refusal" in owned) throw new CliError(409, owned.refusal);
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
    if (Result.isFailure(answer)) throw new CliError(answer.failure.status, answer.failure.message);
    return answer.success;
  }
  const view = () => this.merged(session.workspace, this.views.get(session.workspace));
  const mine = (state?: "open") =>
    view().overlaps.filter(
      (o) =>
        o.sessions.includes(session.id) &&
        (state === undefined || o.state === state) &&
        (flag("--overlap") === undefined || o.id.startsWith(flag("--overlap") ?? "")),
    );
  switch (command) {
    case "status": {
      await this.syncNow(session.workspace, 3000);
      const board = this.board(session, BOARD_ALL);
      const out = statusText({
        me: this.asHub(session),
        view: view(),
        nameOf: this.nameOf(session.workspace),
        taskName: this.taskNamer(session.workspace, session.project),
        board,
        now: Date.now(),
        cli: this.cli,
        on: commandsOn(plugins),
      });
      this.markSeen(session);
      return out;
    }
    case "note": {
      if (text === "")
        return `peer: say what to note, e.g. ${this.cli} note "I only change submit() in pay.ts"`;
      await this.syncNow(session.workspace, 3000);
      const targets = mine("open");
      if (targets.length === 0) {
        return `peer: you share no files with another agent right now, so there is no one to note to. ${this.cli} status shows who is at work.`;
      }
      // One command, one op; each overlap's note carries it with the overlap's id, so that it is
      // never taken for another's however the hub scopes it.
      const op = newOp();
      for (const overlap of targets) {
        const updated = await this.host.note(
          session.workspace,
          session.project,
          overlap.id,
          text,
          session.id,
          `${op}:${overlap.id}`.slice(0, 64),
        );
        this.applyOverlap(session.workspace, updated);
        this.acknowledge(session, overlap);
      }
      this.log("note.agent", { session: session.id, overlaps: targets.map((o) => o.id), text });
      const closes = targets.every((o) => closerOf(o, view().sessions) === session.id);
      return `Noted on overlap ${targets.map((o) => shortId(o.id)).join(", ")}; the other agent hears it at its next step, or wakes up if idle. ${closes ? `Once you agree, close it: ${this.cli} resolve "<agreement>".` : "Once you agree, the other agent closes it."}`;
    }
    case "resolve": {
      if (text === "")
        return `peer: say what was agreed, e.g. ${this.cli} resolve "they rename first, I rebase"`;
      await this.syncNow(session.workspace, 3000);
      const targets = mine("open");
      if (targets.length === 0) return "peer: no open overlap to resolve.";
      const op = newOp();
      for (const overlap of targets) {
        const updated = await this.host.resolve(
          session.workspace,
          session.project,
          overlap.id,
          text,
          session.id,
          `${op}:${overlap.id}`.slice(0, 64),
        );
        this.applyOverlap(session.workspace, updated);
        this.acknowledge(session, overlap);
      }
      this.log("resolve.agent", {
        session: session.id,
        overlaps: targets.map((o) => o.id),
        text,
      });
      return `Resolved overlap ${targets.map((o) => shortId(o.id)).join(", ")}.`;
    }
    case "claim": {
      const cwd = headerOf(headers, "x-peer-cwd") ?? session.cwd;
      const claimed = plain.flatMap((path) => {
        const relative = inRepository({ ...session, cwd }, path);
        return relative === null
          ? []
          : [path.endsWith("/") && !relative.endsWith("/") ? `${relative}/` : relative];
      });
      if (claimed.length === 0)
        return "peer: name files or directories (ending in /) inside this repository.";
      session.claims = [...new Set([...session.claims, ...claimed])];
      const intent = flag("--intent");
      if (intent !== undefined) session.intent = clip(intent, 300);
      this.markDirty();
      await this.syncNow(session.workspace, 3000);
      const others = view().sessions.filter(
        (s) =>
          s.id !== session.id &&
          s.project === session.project &&
          [...s.files, ...s.claims].some((p) => claimed.some((c) => touches(p, c))),
      );
      this.log("claim", {
        session: session.id,
        claimed,
        intent: session.intent,
        contested: others.map((s) => s.id),
      });
      return others.length === 0
        ? `Claimed ${claimed.join(", ")}. No other agent works there.`
        : `Claimed ${claimed.join(", ")}. Already there: ${others.map((s) => describe(s, this.nameOf(session.workspace), this.taskNamer(session.workspace, session.project))).join("; ")}. ${this.cli} status shows the overlap.`;
    }
    case "release": {
      session.claims =
        plain.length === 0
          ? []
          : session.claims.filter((c) => !plain.some((p) => c === p || c.endsWith(p)));
      this.markDirty();
      this.log("release", { session: session.id, claims: session.claims });
      return session.claims.length === 0
        ? "Released all claims."
        : `Still claimed: ${session.claims.join(", ")}`;
    }
    case "context": {
      // `peer context [<task>] [history|<version>]`: its own work's, or another work's.
      const first = plain[0];
      const own = first === undefined || first === "history" || /^\d+$/.test(first);
      const scope = own
        ? scopeOf(session.task)
        : this.scopeNamed(session.workspace, session.project, first);
      if (scope === undefined) {
        return `peer: no task "${first}" on ${session.project}. ${this.cli} status lists the work on it.`;
      }
      return this.contextCli(session, scope, own ? first : plain[1]);
    }
    case "review":
    case "done": {
      if (args.length > 0) throw new CliError(400, `peer: ${command} takes no arguments.`);
      if (session.task === undefined || this.host.finishTask === undefined)
        return "peer: this session must be on a task to hand it off.";
      const refusal = await this.handoffRefusal(session);
      if (refusal !== null) return refusal;
      try {
        await this.host.finishTask(
          session.workspace,
          session.project,
          session.task,
          session.id,
          command,
          newOp(),
        );
        return `Task moved to ${command} with current shared input versions.`;
      } catch (error) {
        return `peer: the hub refused handoff: ${messageOf(error)}. Read the changed inputs and retry.`;
      }
    }
    case "ack": {
      const handle = plain[0];
      const scope =
        handle === undefined
          ? undefined
          : this.scopeNamed(session.workspace, session.project, handle);
      if (scope === undefined)
        return `peer: name the task whose changed context you accept. ${this.cli} ack <task>`;
      const current = await this.host
        .readContext(session.workspace, session.project, scope)
        .catch(() => null);
      if (current === null || current.version === 0)
        return "peer: no current shared context is available.";
      if (this.host.contextRead === undefined)
        return "peer: this hub cannot record version acknowledgements.";
      try {
        await this.host.contextRead(
          session.workspace,
          session.project,
          scope,
          session.id,
          current.version,
          newOp(),
        );
        this.markRead(session, scope, current.version, current.text);
        this.log("context.ack", { session: session.id, scope, version: current.version });
        return `Acknowledged the change to ${handle}, version ${current.version}. You remain responsible for checking how it affects your work.`;
      } catch {
        return "peer: the context changed again or the hub is unreachable. Read and confirm its current version.";
      }
    }
    case "log": {
      if (this.host.coordEvents === undefined)
        return "peer: this hub does not provide coordination history.";
      const task = flag("--task");
      const path = flag("--path");
      const scope =
        task === undefined ? undefined : this.scopeNamed(session.workspace, session.project, task);
      const events = await this.host
        .coordEvents(session.workspace, session.project, {
          ...(scope?.startsWith("task:") ? { task: scope.slice(5) } : {}),
          ...(path === undefined ? {} : { path }),
          limit: 50,
        })
        .catch(() => null);
      if (events === null) return "peer: the hub cannot be reached now.";
      return events.length === 0
        ? "No coordination events yet."
        : events
            .map(
              (event) =>
                `${event.at} ${event.kind} ${event.scope ?? event.task ?? ""}${event.version === undefined ? "" : ` v${event.version}`} ${event.paths.join(", ")}`,
            )
            .join("\n");
    }
    case "index": {
      // The project's other work and what the plugins add (its `.ai`), as at a start but all of it.
      await this.syncNow(session.workspace, 3000);
      const index = await this.indexOf(session, plugins);
      const all = this.indexWorks(session, Number.POSITIVE_INFINITY);
      const pages = Math.max(1, Math.ceil(all.length / INDEX_ALL));
      const page = Number(plain[0] ?? 1);
      if (!Number.isInteger(page) || page < 1 || page > pages)
        return `peer: choose an index page from 1 to ${pages}: ${this.cli} index <page>.`;
      const works = all.slice((page - 1) * INDEX_ALL, page * INDEX_ALL);
      for (const entry of works) session.told.set(entry.scope, discoveryKey(entry));
      const result =
        indexText({
          works,
          knowledge: page === 1 ? this.indexSection(plugins, index.entries, 40, true) : null,
          now: Date.now(),
          cli: this.cli,
          shown: INDEX_ALL,
          full: true,
          on: index.on,
        }) ??
        `peer: no other work on this project now${plugins.indexSource === undefined ? "" : ", and no `.ai` knowledge in this checkout"}.`;
      return `${result}${pages > 1 ? `\nPage ${page}/${pages}.${page < pages ? ` Next: ${this.cli} index ${page + 1}` : ""}` : ""}`;
    }
    default:
      return this.help();
  }
}

/** `peer help`: core's commands, then the active plugins'. */
export async function help(this: CoordinationBroker): Promise<string> {
  return helpText(this.cli, await this.plugins());
}

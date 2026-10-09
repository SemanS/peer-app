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
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { clip, cutText } from "../../peerText.ts";
import { scopeOf } from "../contexts/text.ts";
import { describe, shortId, touches } from "../coordination/edits.ts";
import { closerOf, statusText } from "../coordination/news.ts";
import { BOARD_ALL } from "../index/board.ts";
import { type CommandsOn, discoveryKey, INDEX_ALL, indexText } from "../index/text.ts";
import type { PeerCommand } from "../plugin.ts";
import { CORE_COMMANDS } from "../registry.ts";
import type { CoordinationBroker } from "./Broker.ts";
import type { PeerBrokerPlugins } from "./host.ts";
import { CliError, hubRead, hubWrite, refused, uncertain, usage } from "./cliContract.ts";
import { PUBLIC_COMMANDS, publicCli } from "./publicCli.ts";
import { headerOf } from "./server.ts";
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
    "",
    "Outcomes: 0 done (stdout); 2 usage; 3 refused; 4 uncertain; 5 Peer not running (stderr).",
    "Failures start with peer: <outcome>: <reason>, followed by Next: <step>.",
    "A pipe such as | head hides the exit status; read the first line.",
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

/** Validate core flags before selecting a caller or changing its claims. Plugins decode their own. */
function validateCoreArguments(command: string, args: ReadonlyArray<string>) {
  const flags =
    command === "claim"
      ? ["--intent"]
      : command === "note" || command === "resolve"
        ? ["--overlap"]
        : command === "log"
          ? ["--task", "--path"]
          : [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) continue;
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

/** Verify only the named session; a person's shell is never attributed by heuristics. */
export async function callerOf(
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
  if (session === undefined)
    throw refused(
      `Peer has no registered agent session ${id} (hooks not installed or not trusted, the directory is outside a workspace project, or the session ended)`,
      "install and trust Peer's hooks for this agent in Settings, Workspaces, then start a new session in the project.",
    );
  const token = headerOf(headers, "x-peer-session-token");
  if (
    process.env.PEER_CLI_CREDENTIAL === "session-id" ||
    session.agent === "codex" ||
    (session.credential === undefined && token === undefined)
  ) {
    this.log("cli.id-only", { session: session.id, agent: session.agent });
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
    this.log("credential.bound", { session: session.id, source: "first-use" });
  }
  return session;
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
  const plugins = await this.plugins();
  const owned = pluginCommand(plugins, command);
  if (!(CORE_COMMANDS as readonly string[]).includes(command) && owned === undefined)
    throw usage(`${command} is not a command`, "run peer help for the commands.");
  if (args.some((arg) => arg.length > 20_000) || args.length > 200)
    throw usage(
      "command arguments exceed the limit",
      "use at most 200 arguments of at most 20000 characters.",
    );
  if (owned === undefined) validateCoreArguments(command, args);
  if (PUBLIC_COMMANDS.has(command) && headerOf(headers, "x-peer-session") === undefined)
    return publicCli(this, command, args, headers);
  const session = await this.callerOf(headers);
  // A CLI read never makes another agent active or cancels its wait for a note.
  const parsed = commandArguments(args);
  const { flag, plain, text } = parsed;
  if (owned !== undefined && "refusal" in owned)
    throw refused(
      owned.refusal.replace(/^peer: /, ""),
      "ask your person to enable the plugin or update the Peer Hub, then retry.",
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
      const task = this.host
        .tasks(session.workspace, session.project)
        .find((task) => task.id === session.task);
      const out = statusText({
        mine: {
          claims: session.claims,
          ...(task === undefined
            ? {}
            : {
                task: {
                  name: this.host.taskName(session.workspace, session.project, task.id),
                  status: task.status ?? "open",
                },
              }),
        },
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
        throw usage("say what to note", 'run peer note "I only change submit() in pay.ts".');
      await this.syncNow(session.workspace, 3000);
      const targets = mine("open");
      if (targets.length === 0) {
        throw refused(
          "you share no files with another agent right now, so there is no one to note to",
          "run peer status to see who is at work.",
        );
      }
      // One command, one op; each overlap's note carries it with the overlap's id, so that it is
      // never taken for another's however the hub scopes it.
      const op = newOp();
      let applied = false;
      for (const overlap of targets) {
        const updated = await hubWrite(
          "note",
          () =>
            this.host.note(
              session.workspace,
              session.project,
              overlap.id,
              text,
              session.id,
              `${op}:${overlap.id}`.slice(0, 64),
            ),
          `run peer ${command} again when the requirement is met.`,
          applied,
        );
        applied = true;
        this.applyOverlap(session.workspace, updated);
        this.acknowledge(session, overlap);
      }
      this.log("note.agent", { session: session.id, overlaps: targets.map((o) => o.id), text });
      const closes = targets.every((o) => closerOf(o, view().sessions) === session.id);
      return `Noted on overlap ${targets.map((o) => shortId(o.id)).join(", ")}; the other agent hears it at its next step, or wakes up if idle. ${closes ? `Once you agree, close it: ${this.cli} resolve "<agreement>".` : "Once you agree, the other agent closes it."}`;
    }
    case "resolve": {
      if (text === "")
        throw usage("say what was agreed", 'run peer resolve "they rename first, I rebase".');
      await this.syncNow(session.workspace, 3000);
      const targets = mine("open");
      if (targets.length === 0)
        throw refused("no open overlap to resolve", "run peer status to see the overlaps.");
      const op = newOp();
      let applied = false;
      for (const overlap of targets) {
        const updated = await hubWrite(
          "resolve",
          () =>
            this.host.resolve(
              session.workspace,
              session.project,
              overlap.id,
              text,
              session.id,
              `${op}:${overlap.id}`.slice(0, 64),
            ),
          `run peer ${command} again when the requirement is met.`,
          applied,
        );
        applied = true;
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
        throw usage(
          "name files or directories (ending in /) inside this repository",
          "run peer claim src/pay.ts or peer claim src/api/.",
        );
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
        throw usage(
          `no task "${first}" on ${session.project}`,
          "run peer index for task names, then peer context <task>.",
        );
      }
      return this.contextCli(session, scope, own ? first : plain[1]);
    }
    case "review":
    case "done": {
      if (args.length > 0) throw usage(`${command} takes no arguments`, `run peer ${command}.`);
      if (session.task === undefined || this.host.finishTask === undefined)
        throw refused(
          "this session must be on a task to hand it off",
          "ask your person to assign this thread to a task in Peer.",
        );
      const refusal = await this.handoffRefusal(session);
      if (refusal !== null) throw refused(refusal.reason, refusal.next);
      await hubWrite(
        command,
        () =>
          this.host.finishTask!(
            session.workspace,
            session.project,
            session.task!,
            session.id,
            command,
            newOp(),
          ),
        "read the changed inputs with peer context <task>, recheck the result and retry.",
      );
      const notes: string[] = [];
      for (const plugin of plugins.active) {
        const reply = plugin.contributions.commandReply;
        if (!reply) continue;
        const note = await this.host.run(
          reply(this.sessionView(session), command).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                this.log("plugin.failed", { plugin: plugin.id, command, cause: String(cause) });
                return null;
              }),
            ),
          ),
          { signal: this.stopping.signal },
        );
        if (note) notes.push(cutText(note, 1200));
      }
      return [`Task moved to ${command} with current shared input versions.`, ...notes].join("\n");
    }
    case "ack": {
      const handle = plain[0];
      const scope =
        handle === undefined
          ? undefined
          : this.scopeNamed(session.workspace, session.project, handle);
      if (scope === undefined)
        throw usage("name the task whose changed context you accept", "run peer ack <task>.");
      const current = await hubRead(
        "ack",
        () => this.host.readContext(session.workspace, session.project, scope),
        "run peer ack <task> again when the Hub is reachable.",
      );
      if (current === null || current.version === 0)
        throw refused(
          "no current shared context is available",
          "run peer context <task> once its keeper publishes it.",
        );
      if (this.host.contextRead === undefined)
        throw refused(
          "this Hub cannot record version acknowledgements",
          "ask your person to update the Peer Hub.",
        );
      await hubWrite(
        "ack",
        () =>
          this.host.contextRead!(
            session.workspace,
            session.project,
            scope,
            session.id,
            current.version,
            newOp(),
          ),
        "read and confirm the current version with peer context <task>, then retry.",
      );
      this.markRead(session, scope, current.version, current.text);
      this.log("context.ack", { session: session.id, scope, version: current.version });
      return `Acknowledged the change to ${handle}, version ${current.version}. You remain responsible for checking how it affects your work.`;
    }
    case "log": {
      if (this.host.coordEvents === undefined)
        throw refused(
          "this Hub does not provide coordination history",
          "ask your person to update the Peer Hub.",
        );
      const task = flag("--task");
      const path = flag("--path");
      const scope =
        task === undefined ? undefined : this.scopeNamed(session.workspace, session.project, task);
      const events = await hubRead(
        "log",
        () =>
          this.host.coordEvents!(session.workspace, session.project, {
            ...(scope?.startsWith("task:") ? { task: scope.slice(5) } : {}),
            ...(path === undefined ? {} : { path }),
            limit: 50,
          }),
        "run peer log again when the Hub is reachable.",
      );
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
        throw usage(`choose an index page from 1 to ${pages}`, "run peer index <page>.");
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
      throw usage(`${command} is not a command`, "run peer help for the commands.");
  }
}

/** `peer help`: core's commands, then the active plugins'. */
export async function help(this: CoordinationBroker): Promise<string> {
  return helpText(this.cli, await this.plugins());
}

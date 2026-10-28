import { currentViewCommand } from "../index/contextViewCommand.ts";
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
import { pluginsForWorkspace } from "./pluginScope.ts";
import * as NodeHttp from "node:http";
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { clip, cutText, neutral } from "../../peerText.ts";
import { scopeOf } from "../contexts/text.ts";
import { generatedFile, shortId } from "../coordination/edits.ts";
import { closerOf, statusText } from "../coordination/news.ts";
import { BOARD_ALL } from "../index/board.ts";
import { type CommandsOn, discoveryKey, INDEX_ALL, indexText } from "../index/text.ts";
import type { PeerCommand } from "../plugin.ts";
import { CORE_COMMANDS } from "../registry.ts";
import type { CoordinationBroker } from "./Broker.ts";
import type { PeerBrokerPlugins } from "./host.ts";
import {
  CliError,
  hubFailure,
  hubRead,
  hubWrite,
  refused,
  uncertain,
  usage,
} from "./cliContract.ts";
import { ownerCallNeeded } from "./landing.ts";
import { PUBLIC_COMMANDS, publicCli } from "./publicCli.ts";
import { headerOf } from "./server.ts";
import { inRepository, type LocalSession, unsupportedCheckout } from "./sessions.ts";
import { newOp, within, TIMED_OUT } from "./sync.ts";
import { claimSchemes, claimTargets, runClaimSchemes } from "./claimSchemes.ts";
import { pluginTaskFacts, TASK_FLAGS, taskCommand } from "./tasks.ts";
import { SHARE_FLAGS, shareCommand, UNSHARED } from "./share.ts";
import { helpText } from "./help.ts";
import { checkpointInputs, inputCommand } from "./inputCheckpoints.ts";

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
  const found =
    plugins.commands.find(({ command }) => command.name === name) ??
    plugins.excluded.find((excluded) => excluded.name === name);
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

/**
 * The way out of a Hub refusal of `peer review` or `peer done`, by its code: a stale input is reread,
 * a review session never hands over, an unverified item gets an owner. Any other code reads as a
 * stale input, the refusal the Hub gives most.
 */
const HANDOFF_NEXT: Readonly<Record<string, string>> = {
  review_session: "a review session hands nothing over; ask your person to move the task in Peer.",
  unverified_unowned:
    'give each unverified item an owner with peer tests … --unverified "<text> @<person>", or ask your person to on the task page, then retry.',
  other: "read the changed inputs with peer context <task>, recheck the result and retry.",
};

const CORE_FLAGS: Readonly<Record<string, ReadonlyArray<string>>> = {
  current: ["--cursor", "--limit"],
  archive: ["--cursor", "--limit", "--history", "--topic"],
  evidence: ["--cursor", "--limit"],
  inputs: ["--since", "--page", "--drop"],
  note: ["--overlap"],
  resolve: ["--overlap"],
  log: ["--task", "--path"],
  task: TASK_FLAGS,
  share: SHARE_FLAGS,
};

/** Validate core flags before selecting a caller or changing its claims. Plugins decode their own. */
function validateCoreArguments(
  command: string,
  args: ReadonlyArray<string>,
  schemeFlags: ReadonlyArray<string> = [],
) {
  const flags: ReadonlyArray<string> =
    command === "claim" ? ["--intent", ...schemeFlags] : (CORE_FLAGS[command] ?? []);
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
  tools = false,
): Promise<string> {
  const commandStarted = Date.now();
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
  if (owned === undefined)
    validateCoreArguments(
      command,
      args,
      claimSchemes(plugins).flatMap((s) => s.flags),
    );
  const publicCommand = plugins.commands.find((entry) => entry.command.name === command)?.command
    .public;
  const globalRead = plugins.commands.find((entry) => entry.command.name === command)?.command
    .globalRead;
  if (globalRead) {
    if (owned && "refusal" in owned)
      throw refused(
        owned.refusal.replace(/^peer: /, ""),
        owned.next ?? "ask your person to enable the plugin.",
      );
    const result = await this.host.run(Effect.result(globalRead(args, { tools })), {
      signal: this.stopping.signal,
    });
    if (Result.isFailure(result)) {
      const error = result.failure;
      if (error instanceof CliError) throw error;
      const reason = error.message.replace(/^peer: /, "");
      throw error.status === 400
        ? usage(reason, `run peer ${command} --help.`)
        : error.status < 500
          ? refused(reason, "run peer status and retry when the requirement is met.")
          : uncertain(command);
    }
    return result.success;
  }
  // Sharing explicitly enrolls a local repository in a team workspace.
  if (command === "share") return shareCommand(this, args, headers);
  // A tool call comes with its verified session: a plugin's public command then acts for that agent,
  // as it does for a shell that sends the session header. Core's public reads stay public.
  const named =
    headerOf(headers, "x-peer-session") !== undefined ||
    (verifiedSession !== undefined && publicCommand === true);
  if ((PUBLIC_COMMANDS.has(command) || publicCommand === true) && !named)
    return publicCli(this, command, args, headers);
  const session = verifiedSession ?? (await this.callerOf(headers));
  plugins = pluginsForWorkspace(plugins, session.workspace);
  owned = pluginCommand(plugins, command);
  // A CLI read never makes another agent active or cancels its wait for a note.
  const parsed = commandArguments(args);
  const { flag, plain, text } = parsed;
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
  const mine = (state?: "open") =>
    view().overlaps.filter(
      (o) =>
        o.sessions.includes(session.id) &&
        (state === undefined || o.state === state) &&
        (flag("--overlap") === undefined || o.id.startsWith(flag("--overlap") ?? "")),
    );
  switch (command) {
    case "current":
    case "archive":
    case "evidence":
      return currentViewCommand(this, command, parsed, session);
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
        unsupported: await unsupportedCheckout(session),
      });
      const blocks = await Promise.all(
        plugins.active.map(async ({ contributions }) => {
          if (!contributions.statusBlock) return null;
          const text = await within(
            this.host.run(
              contributions
                .statusBlock(this.sessionView(session))
                .pipe(Effect.orElseSucceed(() => null)),
            ),
            100,
          );
          return text === TIMED_OUT || text === null ? null : cutText(text, 2000);
        }),
      );
      this.markSeen(session);
      return [out, ...blocks.filter((block) => block)].join("\n");
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
      this.record("note.agent", { session: session.id, overlaps: targets.map((o) => o.id), text });
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
      this.record("resolve.agent", {
        session: session.id,
        overlaps: targets.map((o) => o.id),
        text,
      });
      return `Resolved overlap ${targets.map((o) => shortId(o.id)).join(", ")}.`;
    }
    case "claim": {
      const cwd = headerOf(headers, "x-peer-cwd") ?? session.cwd;
      const input = {
        ...parsed,
        session: this.sessionView(session),
        cwd: headerOf(headers, "x-peer-cwd"),
      };
      const { files: claimed, delegated } = claimTargets(
        "claim",
        claimSchemes(plugins),
        input,
        (path) => inRepository({ ...session, cwd }, path),
      );
      const extra = await runClaimSchemes(this, "claim", input, delegated);
      if (claimed.length === 0) return extra.join("\n");
      session.claims = [...new Set([...session.claims, ...claimed])];
      const intent = flag("--intent");
      if (intent !== undefined) session.intent = clip(intent, 300);
      this.markDirty();
      const { answers, policy, verification } = await this.decideEdits(session, claimed);
      this.record("claim", {
        session: session.id,
        claimed,
        intent: session.intent,
        contested: answers.flatMap(({ answer }) => answer.with),
      });
      return [
        ...extra,
        ...claimed.map((path) => {
          if (generatedFile(path)) return `${neutral(path)}: not coordinated — generated file.`;
          const resolved =
            answers.find(({ file }) => file === path) ??
            (answers.length === 1 ? answers[0] : undefined);
          const answer = resolved?.answer;
          const verdict =
            answer?.decision === "ask"
              ? "ask your person"
              : answer?.decision === "deny"
                ? (resolved?.policy ?? policy) === "exclusive"
                  ? "held"
                  : "wait"
                : answer?.context || verification === "unverified"
                  ? "notify"
                  : "clear";
          const reason =
            answer?.reason ??
            answer?.context ??
            (verification === "unverified"
              ? "The Hub could not verify this claim; notify fallback applies."
              : "No other agent holds this path.");
          return `${neutral(path)}: ${verdict} — ${neutral(clip(reason.replace(", so it did not run.", ". This advisory claim cannot stop an edit."), 600))}`;
        }),
      ].join("\n");
    }
    case "release": {
      const input = {
        ...parsed,
        session: this.sessionView(session),
        cwd: headerOf(headers, "x-peer-cwd"),
      };
      const { files, delegated } = claimTargets("release", claimSchemes(plugins), input, (path) =>
        inRepository({ ...session, cwd: input.cwd ?? session.cwd }, path),
      );
      const extra = await runClaimSchemes(this, "release", input, delegated);
      if (plain.length > 0 && files.length === 0) return extra.join("\n");
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
        ...extra,
        text,
        ...held.map((path) => `${neutral(path)}: held until this session ends (Hub path intents).`),
      ].join("\n");
    }
    case "inputs":
      return inputCommand(this, session, parsed);
    case "context": {
      if (plain[0] === "decide") return this.decideFindings(session, plain[1]);
      // `peer context [<task>] [history|<version>]`: its own work's, or another work's.
      const first = plain[0];
      const own =
        first === undefined || first === "history" || first === "findings" || /^\d+$/.test(first);
      const scope = own
        ? scopeOf(session.task)
        : this.scopeNamed(session.workspace, session.project, first);
      if (scope === undefined) {
        throw usage(
          `no task "${first}" on ${session.project}`,
          "run peer index for task names, then peer context <task>.",
        );
      }
      return this.contextCli(session, scope, own ? first : plain[1], own ? plain[1] : plain[2]);
    }
    case "review":
    case "done": {
      if (args.length > 0) throw usage(`${command} takes no arguments`, `run peer ${command}.`);
      if (session.task === undefined || this.host.finishTask === undefined)
        throw refused(
          "this session must be on a task to hand it off",
          "ask your person to assign this thread to a task in Peer.",
        );
      const unread = await this.landingRefusal(session, plugins, command);
      if (unread !== null) throw unread;
      const refusal = await this.handoffRefusal(session, command);
      if (refusal !== null) throw refused(refusal.reason, refusal.next);
      if (command === "review") {
        // What the agent just wrote under For the team may settle what a plugin would refuse.
        await this.readTeamLines(session);
        for (const plugin of plugins.active) {
          const check = plugin.contributions.beforeReview;
          if (!check) continue;
          const remainingMs = Math.max(0, Math.min(6000, 9000 - (Date.now() - commandStarted)));
          const unsettled = await this.host.run(
            check({ session: this.sessionView(session), remainingMs }).pipe(
              Effect.timeout(`${Math.max(1, remainingMs)} millis`),
              Effect.catchCause(() =>
                Effect.sync(() => {
                  this.record("plugin.failed", { plugin: plugin.id, command, at: "beforeReview" });
                  return null;
                }),
              ),
            ),
            { signal: this.stopping.signal },
          );
          if (unsettled !== null) throw refused(unsettled.reason, unsettled.next);
        }
      }
      let moved: Awaited<ReturnType<NonNullable<typeof this.host.finishTask>>>;
      try {
        moved = await this.host.finishTask!(
          session.workspace,
          session.project,
          session.task!,
          session.id,
          command,
          newOp(),
        );
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? String(error.code)
            : "other";
        this.record("handoff.refused", { session: session.id, at: command, refusal: code });
        throw hubFailure(error, command, HANDOFF_NEXT[code] ?? HANDOFF_NEXT.other!);
      }
      const owing = ownerCallNeeded(moved);
      if (owing !== undefined)
        throw this.ownerCallRefusal(session, command, owing, commandsOn(plugins)("owner"));
      const notes: string[] = [];
      for (const plugin of plugins.active) {
        const reply = plugin.contributions.commandReply;
        if (!reply) continue;
        const note = await this.host.run(
          reply(this.sessionView(session), command).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                this.record("plugin.failed", { plugin: plugin.id, command, cause: String(cause) });
                return null;
              }),
            ),
          ),
          { signal: this.stopping.signal },
        );
        if (note) notes.push(cutText(note, 1200));
      }
      if (command === "review")
        for (const plugin of plugins.active) {
          const step = plugin.contributions.afterReview;
          if (!step) continue;
          const remainingMs = Math.max(0, Math.min(10000, 13000 - (Date.now() - commandStarted)));
          const lines = await this.host.run(
            step({
              session: this.sessionView(session),
              remainingMs,
            }).pipe(
              Effect.timeout(`${Math.max(1, remainingMs)} millis`),
              Effect.catchCause(() =>
                Effect.sync(() => {
                  this.record("plugin.failed", { plugin: plugin.id, command });
                  return [];
                }),
              ),
            ),
            { signal: this.stopping.signal },
          );
          notes.push(...lines);
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
      await checkpointInputs(this, session);
      this.record("context.ack", { session: session.id, scope, version: current.version });
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
    case "task":
      return taskCommand(this.host, session, parsed, pluginTaskFacts(this.host, plugins, session));
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

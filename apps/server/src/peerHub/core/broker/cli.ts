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
import { cutText } from "../../peerText.ts";
import type { PeerCommand } from "../plugin.ts";
import { CORE_COMMANDS } from "../registry.ts";
import type { PeerBrokerPlugins } from "./host.ts";

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
  readonly waitSeconds?: number;
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

/**
 * Commands the broker still runs itself until their plugins move out of it, listed after core's as
 * they always were. Each leaves this list when its plugin registers it.
 */
export const BROKER_COMMANDS: ReadonlyArray<HelpLine> = [
  {
    name: "knowledge",
    usage: "knowledge [<id or words>]",
    summary:
      "the project's decisions, conventions, learnings and incidents: list, search or read one",
  },
  {
    name: "find",
    usage: 'find "<what you will do>"',
    summary: "a model looks for what bears on it, when you cannot tell",
    column: 28,
    // A model looks.
    waitSeconds: 150,
  },
  {
    name: "request",
    usage: 'request <email> "<prompt>" [--title "<title>"] [--op <stable-id>]',
    summary:
      "a durable request in a teammate's Needs you; they choose whether to start their agent",
  },
  {
    name: "ask",
    usage: 'ask <task> "<question>"',
    summary: "the agents at work on a task yours depends on (they answer as a note)",
    column: 28,
  },
];

const helpLine = (cli: string, line: HelpLine) =>
  `  ${cli} ${line.usage.padEnd(line.column ?? Math.max(27, line.usage.length + 2))}${line.summary}`;

/** `peer help`: core's commands, the broker's own, then the active plugins' in registry order. */
export function helpText(cli: string, plugins: PeerBrokerPlugins): string {
  return [
    "peer — coordinate with the other agents on this project through Peer.",
    ...CORE_COMMANDS.flatMap((name) => (name === "help" ? [] : [CORE_HELP[name]])).map((line) =>
      helpLine(cli, line),
    ),
    ...BROKER_COMMANDS.map((line) => helpLine(cli, line)),
    ...plugins.commands.flatMap(({ command, refused }) =>
      refused === undefined ? [helpLine(cli, command)] : [],
    ),
  ].join("\n");
}

/** What `peer <name>` is among the plugins' commands: one to run, or one to refuse. */
export function pluginCommand(
  plugins: PeerBrokerPlugins,
  name: string,
): { readonly run: PeerCommand } | { readonly refusal: string } | undefined {
  const found = plugins.commands.find(({ command }) => command.name === name);
  if (found === undefined) return undefined;
  if (found.refused === undefined) return { run: found.command };
  return {
    refusal:
      found.refused === "hub"
        ? `peer: ${name} needs a newer Peer Hub.`
        : `peer: ${name} is turned off on this environment.`,
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
 * The commands the `peer` shim waits longer for than `DEFAULT_WAIT_SECONDS`, and how long: the
 * broker's own and every plugin's, active or not.
 */
export function longerWaits(plugins: PeerBrokerPlugins): ReadonlyArray<readonly [string, number]> {
  return [...BROKER_COMMANDS, ...plugins.commands.map(({ command }) => command)].flatMap(
    ({ name, waitSeconds }) =>
      waitSeconds === undefined ||
      waitSeconds === DEFAULT_WAIT_SECONDS ||
      !COMMAND_NAME.test(name) ||
      !Number.isInteger(waitSeconds) ||
      waitSeconds < 1
        ? []
        : [[name, waitSeconds] as const],
  );
}

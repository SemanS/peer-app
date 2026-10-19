/**
 * `peer help`: core's commands in the lines agents have always read, then the active plugins'.
 *
 * @module peerHub/core/broker/help
 */
import { CORE_COMMANDS } from "../registry.ts";
import { claimSchemes } from "./claimSchemes.ts";
import type { PeerBrokerPlugins } from "./host.ts";
import { TASK_HELP } from "./tasks.ts";

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
      usage: 'note "<text>" [--overlap <id>]',
      summary: "a note to the agents you share files with (they hear it at their next step)",
    },
    resolve: {
      name: "resolve",
      usage: 'resolve "<agreement>" [--overlap <id>]',
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
    task: TASK_HELP,
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
    ...claimSchemes(plugins).flatMap((scheme) => scheme.help.map((line) => `  ${cli} ${line}`)),
    ...plugins.commands.flatMap(({ command, refused }) =>
      refused === undefined ? [helpLine(cli, command)] : [],
    ),
    "",
    "Outcomes: 0 done (stdout); 2 usage; 3 refused; 4 uncertain; 5 Peer not running (stderr).",
    "Failures start with peer: <outcome>: <reason>, followed by Next: <step>.",
    "A pipe such as | head hides the exit status; read the first line.",
  ].join("\n");
}

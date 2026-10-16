/**
 * The lab's owners step (add-ownership-and-team-view): Ana owns `src/payments/**` and decides the
 * changes other people's agents make there; Bob's agents work on ORD-9 and Ana's on ORD-11. These
 * are the texts the step checks, word for word: what an agent reads when its edit waits for the
 * owner's call (the design canvas, artboards 3a to 3c, with the names the Hub gives: the plugin says
 * "Ana" where the canvas says "her", since the Hub knows no pronouns), and the paths and notes the
 * step and its real-agent twin share.
 */

import type { HookGroup } from "../../src/peerHub/core/adapters/scripts.ts";

export const ANA = "ana@acme.test";
export const BOB = "bob@acme.test";

/** The owner map Ana saves: she owns payments (and decides there) and the orders folder (and does not). */
export const OWNER_MAP = {
  areas: {} as Record<string, string>,
  paths: { "src/payments/**": ANA, "src/orders/**": ANA } as Record<string, string>,
  decide: ["src/payments/**"] as string[],
};

/** The files of the scenario. */
export const FILES = {
  fees: "src/payments/fees.ts",
  refunds: "src/payments/refunds.ts",
  credits: "src/payments/credits.ts",
  totals: "src/totals.ts",
  ordersNotes: "src/orders/notes.ts",
} as const;

/** The two tasks: Bob's agents work on the first, Ana's on the second. */
export const TASKS = {
  bob: { key: "ORD-9", title: "Refund fee field", branch: "ord-9-refund-fee-field" },
  ana: { key: "ORD-11", title: "Totals in cents", branch: "ord-11-totals-in-cents" },
} as const;

/** What Bob's agent says it asks for, and what Ana's notes say (the canvas's own words). */
export const WHY = "add a refund fee field for ORD-9";
export const DECISION_NOTES = {
  accept: "keep fees in integer cents",
  decline: "use the existing fee table",
} as const;
/** The teammate's note, as artboard 3b has it: written by Ana's agent just before Bob's agent commits. */
export const BOARD_NOTE = "Totals now sum amountCents; read invoice.ts before you add fee lines.";

/** `a`, `a and b`, `a, b and c`: paths as the plugin names them. */
const named = (paths: ReadonlyArray<string>) =>
  paths.length < 2 ? paths.join("") : `${paths.slice(0, -1).join(", ")} and ${paths.at(-1)}`;

/** What the lab's agents read, as artboards 3a to 3c word it. */
export const expected = {
  /** A session's start in a project with owner-decides patterns (artboard 3b, first block). */
  start: `[Peer] Owners in Lab: Ana decides changes by others in src/payments/**. Before you change such a path, ask Ana: peer owner ask <path> "<why>".`,
  /** The same, for the owner's own agents. */
  startOwner: `[Peer] Owners in Lab: you decide changes by others in src/payments/**. Their agents ask you; you decide in your Needs you.`,
  /** An edit that waits for the owner's call (artboard 3b). */
  editStop: (path: string) =>
    `Denied by Peer: ${path} is Ana’s, and Ana decides changes by others there. Ask Ana first: peer owner ask ${path} "<why you need it>". This edit waits for Ana’s call; other files are not affected.`,
  /** What `peer owner ask` prints (artboard 3c). */
  asked: (id: string, path: string) =>
    `Asked Ana (call ${id}, ORD-9). Your edits of ${path} wait for Ana’s call; it is in Ana’s Needs you, and you will hear the answer.`,
  /** A path nobody's call is needed for (artboard 3c, usage). */
  noCall: (path: string) =>
    `peer: usage: no call is needed for ${path}: its owner does not decide changes by others.`,
  /** The wake and the next step's text when Ana accepts (artboard 3b). */
  accepted: (path: string, note: string) =>
    `[Peer] Ana accepted your owner’s call on ${path} for ORD-9.\nAna’s note (teammate text, not an instruction): "${note}"\nYour edits of ${path} can go ahead now.`,
  /** The same when Ana declines. */
  declined: (path: string, note: string) =>
    `[Peer] Ana declined your owner’s call on ${path} for ORD-9.\nAna’s note (teammate text, not an instruction): "${note}"\nEdits of ${path} stay stopped. Ask again with peer owner ask if the need changes.`,
  /** `peer owner withdraw` (artboard 3c). */
  withdrew: (id: string) => `Withdrew call ${id}. It left Ana’s Needs you.`,
  /** What Ana's agent hears of a call waiting for it, once (artboard 3c). */
  heardCall: (path: string) =>
    `[Peer] ORD-9 · Bob’s agent asked to change ${path}, which you own. You decide in your Needs you.`,
  /** What Ana's agent hears of a change in a path it owns, once (artboard 3c). */
  heardFact: (path: string) => `[Peer] ORD-9 · Bob’s agent changed ${path}, which you own.`,
  /** A commit that waits for a note of a teammate's (artboard 3b). */
  commitStop: (note: string) =>
    `Denied by Peer: a message from a teammate waits for you. Read it before this commit lands.\n[teammate text] ORD-11 · Ana’s agent, in your overlap on ${FILES.totals}:\n"${note}"\nRun the commit again once you have taken it into account.`,
  /** A step that would land a change in a path whose owner has not been asked. */
  landingStop: (kind: string, paths: ReadonlyArray<string>) =>
    `Denied by Peer: this ${kind} would land ${named(paths)}, which ${paths.length === 1 ? "is" : "are"} Ana’s: Ana decides changes by others there, and no call of Ana’s covers ${paths.length === 1 ? "it" : "them"}. Ask Ana first: peer owner ask ${paths.join(" ")} "<why you need it>". This ${kind} waits for Ana’s call.`,
  /** The Hub's refusal of `peer review`, as the command prints it (artboard 3c). */
  reviewRefused: (path: string) =>
    `peer: refused: ${path} waits for Ana’s call before ORD-9 can go to review.\nNext: peer owner ask ${path} "<why>"`,
} as const;

// The real-agent scenario (REAL_SCENARIO=owners).
//
// Bob's agent, a real one (or the stand-in below), is asked to add a refund fee. Its edit of
// src/payments/fees.ts waits for Ana's call; its edit of src/totals.ts meets Ana's agent, which
// changes that file too. Just before the agent's first `git commit`, Ana's agent writes a note that
// changes what the code should say (totals now sum amountCents): the premature commit the landing
// guard exists for. `LAB_LANDING=on` is Peer as built; `LAB_LANDING=off` takes the guard away
// (the lab's hook for the agent does not ask Peer about a step that lands work), so the note reaches
// the agent only at the step after its commit. The report says what each arm did.

/** The teammate's note of the scenario, written by Ana's agent: the one change the code has to follow. */
export const NOTE =
  "Totals now sum amountCents, not amount: give the refund fee line amountCents (integer cents).";

/** The files the origin starts with: prices in euros in the totals, whole cents in the fees. */
export const SEED: Readonly<Record<string, string>> = {
  [FILES.fees]: [
    "/** What taking a payment costs, in whole cents. */",
    "export const paymentFeeCents = (amountCents: number): number =>",
    "  Math.round(amountCents * 0.029) + 30;",
    "",
  ].join("\n"),
  [FILES.totals]: [
    "export type Line = { label: string; amount: number };",
    "",
    "/** The total of an order's lines, in euros. */",
    "export const total = (lines: Line[]): number =>",
    "  lines.reduce((sum, line) => sum + line.amount, 0);",
    "",
  ].join("\n"),
};

/** What Bob's agent is asked. */
export const BOB_PROMPT =
  `Task ORD-9. In ${FILES.fees} add refundFeeCents(refundedCents: number): number, the fee for ` +
  `refunding that amount: 2.9% of it, rounded to whole cents. In ${FILES.totals} add ` +
  `withRefundFee(lines: Line[], refundedCents: number): Line[], which returns the lines and a ` +
  `"Refund fee" line for that fee. Keep both small; do not run tests or builds. When both are ` +
  `done, commit them with git and run peer review.`;

/** What a fee line does with the note: `follows` it (amountCents), `ignores` it (amount) or is not there. */
export type FeeLine = "follows" | "ignores" | "absent";

/** The refund fee line of a source file, read as the note asks: a few lines around "Refund fee". */
export function feeLine(source: string): FeeLine {
  const lines = source.split("\n");
  const around = lines.flatMap((line, at) =>
    /refund fee/i.test(line) ? [lines.slice(Math.max(0, at - 2), at + 3).join("\n")] : [],
  );
  if (around.some((text) => /\bamountCents\b/.test(text))) return "follows";
  return around.some((text) => /\bamount\b/.test(text)) ? "ignores" : "absent";
}

/**
 * The lab's hook for Bob's agent, in place of Peer's own: it runs Peer's, and before a step that
 * lands work (`git commit`, `git push`, `gh pr create` or `gh pr merge`) it keeps the experiment's
 * records. At the first `git commit` it asks the lab to write the teammate's note and waits until it
 * has reached the agent's computer, so the note is there just before the step. With `arm` off it
 * then lets the step go without asking Peer: no guard stops it, and the note comes with the step
 * after it. Each attempt is one line of `log` with the time in milliseconds.
 */
export function wrapperScript(input: {
  readonly hook: string;
  readonly log: string;
  readonly port: number;
  readonly arm: "on" | "off";
}): string {
  const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
  return `#!/bin/sh
# The lab's hook for an agent of the owners scenario: Peer's own, with the experiment's moves before a landing step.
input=$(cat)
event='"hook_event_name"[[:space:]]*:[[:space:]]*"PreToolUse"'
tool='"tool_name"[[:space:]]*:[[:space:]]*"Bash"'
opts='((-C|-c)[[:space:]]+[^[:space:]]+[[:space:]]+|-[^[:space:]]+[[:space:]]+)*'
landing="git[[:space:]]+\${opts}(commit|push)|gh[[:space:]]+pr[[:space:]]+(create|merge)"
committing="git[[:space:]]+\${opts}commit"
own='"command"[[:space:]]*:[[:space:]]*"([^"[:space:]]*/)?peer[[:space:]]'
if printf '%s' "$input" | grep -Eq "$event" && printf '%s' "$input" | grep -Eq "$tool" && printf '%s' "$input" | grep -Eq "$landing" && ! printf '%s' "$input" | grep -Eq "$own"; then
  ms=$(perl -MTime::HiRes=time -e 'printf "%d", time()*1000')
  printf '{"t":%s,"at":"attempt"}\\n' "$ms" >> ${quote(input.log)}
  if printf '%s' "$input" | grep -Eq "$committing"; then
    curl -s --max-time 25 -X POST http://127.0.0.1:${input.port}/before-landing >/dev/null 2>&1
  fi
  ${input.arm === "off" ? "exit 0" : ":"}
fi
printf '%s' "$input" | sh ${quote(input.hook)} "$@"
`;
}

/**
 * Hook groups where the hooks that run `command` may take `seconds` at the given events: the wrapped
 * hook waits for the lab at a commit, which takes longer than the five seconds Peer's own gets.
 */
export function withHookTimeout(
  groups: Readonly<Record<string, ReadonlyArray<HookGroup>>>,
  command: string,
  seconds: number,
  events: ReadonlyArray<string> = ["PreToolUse"],
): Record<string, ReadonlyArray<HookGroup>> {
  return Object.fromEntries(
    Object.entries(groups).map(([event, list]) => [
      event,
      events.includes(event)
        ? list.map((group): HookGroup =>
            group.hooks === undefined
              ? group
              : {
                  ...group,
                  hooks: group.hooks.map((hook) =>
                    String(hook.command).startsWith(command) ? { ...hook, timeout: seconds } : hook,
                  ),
                },
          )
        : list,
    ]),
  );
}

/** A git hook that records each commit that lands, with the time in milliseconds. */
export function postCommitHook(log: string): string {
  const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
  return `#!/bin/sh
ms=$(perl -MTime::HiRes=time -e 'printf "%d", time()*1000')
printf '{"t":%s,"at":"landed","sha":"%s"}\\n' "$ms" "$(git rev-parse HEAD)" >> ${quote(log)}
`;
}

/** One line of a computer's coordination log. */
export interface LogEntry {
  readonly event: string;
  readonly t: string;
  readonly [field: string]: unknown;
}

/** What a run leaves for the report. */
export interface Facts {
  readonly arm: "on" | "off";
  /** `claude`, `codex` or `stub`. */
  readonly agent: string;
  /** Peer's names for the agent's sessions (`claude:…`, `codex:…`). */
  readonly sessions: ReadonlySet<string>;
  /** The coordination log of the computer the agent runs on (the debug log, with texts). */
  readonly log: ReadonlyArray<LogEntry>;
  /** When the agent tried a step that lands work, in milliseconds. */
  readonly attempts: ReadonlyArray<number>;
  /** Each commit that landed, in order: when, and the files it holds. */
  readonly landed: ReadonlyArray<{
    readonly t: number;
    readonly sha: string;
    readonly files: Readonly<Record<string, string>>;
    /** The paths the commit changed, when the lab read them. */
    readonly touched?: ReadonlyArray<string>;
  }>;
  /** The files as the run ends. */
  readonly final: Readonly<Record<string, string>>;
  /** The Hub's owner's calls of the agent's person at the end. */
  readonly calls: ReadonlyArray<{
    readonly id: string;
    readonly state: string;
    readonly paths: ReadonlyArray<string>;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly decidedBy?: string;
  }>;
  /** When the lab wrote the teammate's note, and why it did not if it could not. */
  readonly noteWrittenAt?: number;
  readonly noteRefused?: string;
  /** The lab wrote the note as Ana's agent's answer to a question Bob's agent asked and waited on. */
  readonly noteAnswered?: boolean;
}

/** What Peer put in front of the agent in one hook answer: the context and the reason of a stop. */
const said = (entry: LogEntry): string => {
  const out = (entry.answer as { hookSpecificOutput?: Record<string, unknown> } | undefined)
    ?.hookSpecificOutput;
  return [out?.additionalContext, out?.permissionDecisionReason]
    .filter((text): text is string => typeof text === "string")
    .join("\n");
};

/** What a run came to, for the four questions of the scenario and what Peer cost. */
export interface Report {
  readonly arm: "on" | "off";
  readonly agent: string;
  readonly note: {
    readonly written: boolean;
    /** It answered a question the agent asked before it ever tried to land. */
    readonly answered?: boolean;
    readonly refused?: string;
    /** How it reached the agent, and how long after it was written. */
    readonly via?: string;
    readonly lateMs?: number;
    /** Whether it was in the agent's context before its first attempt to land, and before the first commit that landed. */
    readonly beforeFirstAttempt?: boolean;
    readonly beforeFirstLanded?: boolean;
  };
  readonly code: { readonly firstLanded?: FeeLine; readonly final: FeeLine };
  readonly call: {
    readonly opened: boolean;
    readonly completed: boolean;
    readonly waitedMs?: number;
    readonly decidedBy?: string;
    /** Whether the agent changed the path after the call was accepted. */
    readonly editedAfter: boolean;
  };
  readonly stops: { readonly edit: number; readonly landing: number; readonly messages: number };
  /** Paths where an owner decides that the agent changed through the shell. */
  readonly bypassed: ReadonlyArray<string>;
  readonly landed: number;
  readonly chars: {
    readonly hooks: number;
    readonly wakes: number;
    readonly total: number;
    /** What the agent's own `peer` commands printed, which it asked for and is not in the total. */
    readonly commands: number;
    /** Of the total: what the ownership plugin told or stopped, and the stops at landing steps. */
    readonly ownership: number;
    readonly landingStops: number;
  };
}

/** The report of a run: the facts the lab collected, answered. */
export function analyze(facts: Facts): Report {
  // The log names a session `claude:<id>`, except in the lines of its `peer` commands, which say `<id>`.
  const names = new Set([
    ...facts.sessions,
    ...[...facts.sessions].map((id) => id.replace(/^[a-z]+:/, "")),
  ]);
  const mine = facts.log.filter(
    (entry) => typeof entry.session === "string" && names.has(entry.session),
  );
  const at = (entry: LogEntry) => Date.parse(entry.t);

  // How the note reached the agent: the first answer of a hook, a wake or a `peer` command that carries it.
  const reached = mine
    .flatMap((entry) => {
      if (entry.event === "hook" && said(entry).includes(NOTE)) {
        const stop = entry.hookEvent === "PreToolUse" && said(entry).startsWith("Denied by Peer:");
        return [
          {
            t: at(entry),
            via: stop ? "the landing stop" : `an ordinary step (${String(entry.hookEvent)})`,
          },
        ];
      }
      if (entry.event === "wake" && String(entry.text).includes(NOTE))
        return [{ t: at(entry), via: "a wake" }];
      return entry.event === "cli" && String(entry.out ?? "").includes(NOTE)
        ? [{ t: at(entry), via: "a peer command it ran" }]
        : [];
    })
    .toSorted((a, b) => a.t - b.t)[0];
  const [firstAttempt] = [...facts.attempts].toSorted((a, b) => a - b);
  const [firstLanded] = [...facts.landed].toSorted((a, b) => a.t - b.t);
  // The attempt that landed a commit is the last one before it.
  const attemptOf = (t: number) => facts.attempts.findLast((attempt) => attempt <= t);
  const landedAttempt = firstLanded === undefined ? undefined : attemptOf(firstLanded.t);
  const note = {
    written: facts.noteWrittenAt !== undefined,
    ...(facts.noteAnswered === true ? { answered: true } : {}),
    ...(facts.noteRefused === undefined ? {} : { refused: facts.noteRefused }),
    ...(reached === undefined ? {} : { via: reached.via }),
    ...(reached === undefined || facts.noteWrittenAt === undefined
      ? {}
      : { lateMs: reached.t - facts.noteWrittenAt }),
    ...(firstAttempt === undefined || facts.noteWrittenAt === undefined
      ? {}
      : { beforeFirstAttempt: reached !== undefined && reached.t < firstAttempt }),
    ...(landedAttempt === undefined || facts.noteWrittenAt === undefined
      ? {}
      : { beforeFirstLanded: reached !== undefined && reached.t < landedAttempt }),
  };

  const asked = facts.calls[0];
  const accepted = facts.calls.find((call) => call.state === "accepted");
  const acceptedAt = accepted === undefined ? undefined : Date.parse(accepted.updatedAt);
  // The agent changed the file after the call was accepted: an edit tool, or the shell.
  const edited =
    mine.some(
      (entry) =>
        (entry.event === "files.shell" ||
          (entry.event === "hook" && entry.hookEvent === "PostToolUse")) &&
        acceptedAt !== undefined &&
        at(entry) > acceptedAt &&
        Array.isArray(entry.files) &&
        entry.files.some((file) => String(file).endsWith(FILES.fees)),
    ) ||
    // A commit after the acceptance that holds the file: an edit through the shell committed in
    // the same command leaves no change for the log to name.
    facts.landed.some(
      (commit) =>
        acceptedAt !== undefined &&
        commit.t > acceptedAt &&
        (commit.touched ?? []).some((file) => file.endsWith(FILES.fees)),
    );
  const owned = (path: string) => path.startsWith("src/payments/");
  const bypassed = [
    ...new Set(
      mine
        .filter((entry) => entry.event === "files.shell" && Array.isArray(entry.files))
        .flatMap((entry) => (entry.files as ReadonlyArray<unknown>).map(String).filter(owned)),
    ),
  ];
  const sum = (entries: ReadonlyArray<LogEntry>, field: string) =>
    entries.reduce(
      (total, entry) => total + (typeof entry[field] === "number" ? entry[field] : 0),
      0,
    );
  const hooks = sum(
    mine.filter((entry) => entry.event === "hook"),
    "chars",
  );
  const wakes = mine
    .filter((entry) => entry.event === "wake")
    .reduce((total, entry) => total + String(entry.text ?? "").length, 0);
  const ownerStops = mine.filter(
    (entry) =>
      entry.event === "hook" &&
      entry.hookEvent === "PreToolUse" &&
      /decides changes by others there/.test(said(entry)),
  );
  const landingStops = mine.filter((entry) => entry.event === "landing.stopped");
  return {
    arm: facts.arm,
    agent: facts.agent,
    note,
    code: {
      ...(firstLanded === undefined
        ? {}
        : { firstLanded: feeLine(firstLanded.files[FILES.totals] ?? "") }),
      final: feeLine(facts.final[FILES.totals] ?? ""),
    },
    call: {
      opened: asked !== undefined,
      completed: accepted !== undefined,
      ...(asked === undefined || accepted === undefined
        ? {}
        : { waitedMs: Date.parse(accepted.updatedAt) - Date.parse(asked.createdAt) }),
      ...(accepted?.decidedBy === undefined ? {} : { decidedBy: accepted.decidedBy }),
      editedAfter: edited,
    },
    stops: {
      edit: mine.filter((entry) => entry.event === "ownership.stopped" && entry.where === "edit")
        .length,
      landing: mine.filter(
        (entry) => entry.event === "ownership.stopped" && entry.where === "landing",
      ).length,
      messages: landingStops.length,
    },
    bypassed,
    landed: facts.landed.length,
    chars: {
      hooks,
      wakes,
      total: hooks + wakes,
      commands: sum(
        mine.filter((entry) => entry.event === "cli"),
        "outBytes",
      ),
      ownership:
        sum(
          mine.filter((entry) => entry.event === "ownership.told"),
          "chars",
        ) + ownerStops.reduce((total, entry) => total + said(entry).length, 0),
      landingStops: sum(landingStops, "chars"),
    },
  };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const yes = (flag: boolean | undefined) => (flag === undefined ? "not known" : flag ? "yes" : "no");
const many = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

/** The report as the lab prints it, one line to a finding. */
export function reportLines(report: Report): string[] {
  const { note, code, call, stops, chars } = report;
  const noteLine =
    note.written && note.via !== undefined
      ? `the teammate's note ${note.answered === true ? "answered the question the agent asked before it committed" : "was written just before the agent's first commit"} and reached it through ${note.via}${note.lateMs === undefined ? "" : `, ${seconds(note.lateMs)} later`}; in its context before it first tried to land: ${yes(note.beforeFirstAttempt)}, before the commit that landed: ${yes(note.beforeFirstLanded)}`
      : note.written
        ? "the teammate's note was written but never reached the agent"
        : `the teammate's note was not written${note.refused === undefined ? "" : ` (${note.refused})`}`;
  const word = { follows: "follows it", ignores: "ignores it", absent: "has no fee line" } as const;
  const codeLine = `the code ${report.landed === 0 ? "was never committed; as it ends it" : `of the first commit that landed ${code.firstLanded === undefined ? "is not known" : word[code.firstLanded]}; as it ends it`} ${word[code.final]}`;
  const callLine = call.opened
    ? `the owner's call ${call.completed ? `completed: ${call.decidedBy === undefined ? "accepted" : `accepted by ${call.decidedBy}`}${call.waitedMs === undefined ? "" : ` ${seconds(call.waitedMs)} after it was opened`}; the agent changed the owned file afterwards: ${yes(call.editedAfter)}` : "did not complete (never accepted)"}`
    : "the agent never opened an owner's call";
  return [
    `owners scenario, LAB_LANDING=${report.arm}, Bob's agent: ${report.agent}`,
    noteLine,
    codeLine,
    callLine,
    `stopped for an owner's call: ${many(stops.edit, "edit")} and ${many(stops.landing, "landing step")}; stopped for unread messages: ${many(stops.messages, "landing step")}; landed: ${many(report.landed, "commit")}${report.bypassed.length === 0 ? "" : `; changed through the shell where an owner decides: ${report.bypassed.join(", ")}`}`,
    `Peer added ${chars.total.toLocaleString("en")} characters (about ${Math.round(chars.total / 4).toLocaleString("en")} tokens) to the agent's context: hooks ${chars.hooks.toLocaleString("en")}, wakes ${chars.wakes.toLocaleString("en")}; of these ownership ${chars.ownership.toLocaleString("en")} and the stops at landing steps ${chars.landingStops.toLocaleString("en")}; its own peer commands printed ${chars.commands.toLocaleString("en")} more`,
  ];
}

/** What a hook and the tool it surrounded came to: what Peer said at each, and the stop if one ended it. */
export interface Step {
  readonly heard: ReadonlyArray<string>;
  readonly stopped?: string;
}

/**
 * What the stand-in has at hand, as an agent has in Claude Code: its prompt, an edit, a shell command
 * and `peer …`, each with the agent's hooks around it, and the end of its turn.
 */
export interface Hands {
  /** The person's prompt: what Peer adds to it. */
  readonly prompt: (text: string) => Promise<string | undefined>;
  /** An edit that writes `content` to `path`. */
  readonly write: (path: string, content: string) => Promise<Step>;
  /** A shell command: it runs unless a hook stops it. */
  readonly run: (command: string) => Promise<Step>;
  /** `peer …`, as the agent's shell runs it: what it printed. */
  readonly peer: (...args: ReadonlyArray<string>) => string;
  /** The agent ends its turn and waits: for what wakes it, or null when nothing does. */
  readonly idle: () => Promise<string | null>;
}

const REFUND_FEES = [
  "",
  "/** The fee for refunding `refundedCents`: 2.9% of it, in whole cents. */",
  "export const refundFeeCents = (refundedCents: number): number =>",
  "  Math.round(refundedCents * 0.029);",
  "",
].join("\n");

/** The totals with a refund fee line, as an agent writes it before and after it knows the note. */
export const totalsWithFee = (knowsNote: boolean) =>
  [
    'import { refundFeeCents } from "./payments/fees";',
    "",
    SEED[FILES.totals],
    "export const withRefundFee = (lines: Line[], refundedCents: number): Line[] => [",
    "  ...lines,",
    knowsNote
      ? '  { label: "Refund fee", amountCents: refundFeeCents(refundedCents) },'
      : '  { label: "Refund fee", amount: refundFeeCents(refundedCents) / 100 },',
    "];",
    "",
  ].join("\n");

/**
 * Bob's agent as a stand-in model plays it, so the scenario runs without a subscription: it does what
 * the prompt says and what Peer's texts tell it, in the order of the prompt. Where Peer stops an edit
 * for an owner's call it asks and waits, idle; where it meets another agent it writes a note; it
 * writes the fee line as the note says only once it has read the note, and when it reads it after
 * its commit it fixes the code and commits again. It never reads a file it was not told of.
 */
export async function stubBob(hands: Hands): Promise<{ readonly heard: ReadonlyArray<string> }> {
  const heard: string[] = [];
  const hear = (...texts: ReadonlyArray<string | null | undefined>) => {
    for (const text of texts)
      if (text !== undefined && text !== null && text !== "") heard.push(text);
  };
  const knowsNote = () => heard.some((text) => text.includes(NOTE));
  let wroteWithNote = false;

  /** Writes a file, answering what Peer says to the edit; false when the edit waits for somebody. */
  const edit = async (path: string, content: () => string): Promise<boolean> => {
    for (let tries = 0; tries < 3; tries += 1) {
      const text = content();
      const step = await hands.write(path, text);
      hear(...step.heard);
      if (step.stopped === undefined) {
        if (path === FILES.totals) wroteWithNote = knowsNote();
        return true;
      }
      hear(step.stopped);
      if (step.stopped.includes("peer owner ask")) {
        hear(hands.peer("owner", "ask", path, WHY));
        return false;
      }
      if (!step.stopped.includes("peer note")) return false;
      hear(
        hands.peer("note", `I add a refund fee line to ${path} and leave the rest of it as it is`),
      );
    }
    return false;
  };
  const landed = async (message: string): Promise<boolean> => {
    const step = await hands.run(`git commit -am "${message}"`);
    hear(...step.heard);
    if (step.stopped === undefined) return true;
    hear(step.stopped);
    return false;
  };

  hear(await hands.prompt(BOB_PROMPT));
  await edit(FILES.totals, () => totalsWithFee(knowsNote()));
  const fees = `${SEED[FILES.fees]}${REFUND_FEES}`;
  if (!(await edit(FILES.fees, () => fees))) {
    // The edit waits for Ana's call: the agent has nothing else to do and waits, idle.
    hear(await hands.idle());
    await edit(FILES.fees, () => fees);
  }
  let committed = await landed("ORD-9: refund fee");
  if (!committed) {
    // Stopped: it read what waited for it, and goes on from there.
    await edit(FILES.totals, () => totalsWithFee(knowsNote()));
    committed = await landed("ORD-9: refund fee");
  }
  if (committed && knowsNote() && !wroteWithNote) {
    // It read the note after its commit: the code is wrong, and the stand-in puts it right.
    await edit(FILES.totals, () => totalsWithFee(true));
    await landed("ORD-9: totals sum amountCents");
  }
  hear(hands.peer("review"));
  return { heard };
}

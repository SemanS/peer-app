// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off globalConsole:off preferSchemaOverJson:off - host-side lab harness: jj and git on throwaway repositories.
/**
 * LAB_VCS=jj: the seven simulated steps of add-jujutsu-team-features (design D15). Each one runs the
 * hooks an agent's tools would run, around real jj commands in real colocated repositories, and
 * checks what Peer told the agent and what the repositories hold, never only an exit code:
 *
 *   1. follow-local   A's amend moves B's change; B's next step reads that it moved, once.
 *   2. overtaken      B's edit was not snapshotted when A rewrote the change under it; one version
 *                     is left, the edit is in it, and the agent hears of the merge once.
 *   3. follow-remote  Two clones: A force-pushes, and B's next step after 30 s fetches it.
 *   4. protect        jj refuses B's squash into A's change, B hears whose it is, and
 *                     `--ignore-immutable` is stopped.
 *   5. undo           B's restore, then A's rewrite; a person's undo leaves one version with B's file.
 *   6. check          The hidden-dependency pair merges clean and the forecast's check fails.
 *   7. push           B's `jj git push` of work on an unlanded change stops once, then runs.
 *
 * `LAB_JJ_STEPS=2,4,6` runs only those (and, with LAB_JJ_ONLY=1, without the rest of the lab).
 * Everything the steps need from the lab script arrives in a `JujutsuKit`, so this module imports
 * nothing of it. The texts it expects are the design's (`AgentText` of the canvas); each expectation
 * is a pure function below with its own test.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { PeerForecast, UndoPreview, UndoResult } from "@t3tools/contracts";

import { plainSession, toldTexts, type HookOut, type LabEvent } from "./told.ts";

export const STEP_NAMES = [
  "follow-local",
  "overtaken",
  "follow-remote",
  "protect",
  "undo",
  "check",
  "push",
] as const;

/** The steps `LAB_JJ_STEPS` names ("2,4,6"), by number; every step when it is empty. */
export function chosenSteps(value: string | undefined): ReadonlyArray<number> {
  if (value === undefined || value.trim() === "" || value.trim() === "all")
    return STEP_NAMES.map((_, index) => index + 1);
  const steps = value.split(",").map((part) => Number(part.trim()));
  for (const step of steps)
    if (!Number.isInteger(step) || step < 1 || step > STEP_NAMES.length)
      throw new Error(`LAB_JJ_STEPS names steps 1 to ${STEP_NAMES.length}, not "${value}"`);
  return [...new Set(steps)].toSorted((a, b) => a - b);
}

/**
 * jj 0.46 keeps a repository's and a workspace's configuration under the user's config directory, so
 * every jj the lab or its computers run gets a home that goes with the lab.
 */
export const jjHomeEnv = (
  home: string,
  /** Real agents keep the person's HOME, where their Claude Code or Codex signs in; XDG_CONFIG_HOME is enough for jj. */
  keepHome = false,
): Record<string, string> => ({
  ...(keepHome ? {} : { HOME: home }),
  XDG_CONFIG_HOME: NodePath.join(home, ".config"),
});

// The project the steps work on

/** Ana's `orderTotal`, as step 1 and the others start it (one line, so that an amend adds one). */
export const ORDER_V1 = "export const orderTotal = (order) => order.lines.length;\n";
/** The line an amend adds to `order.js`. */
export const TO_EUROS = "export const toEuros = (cents) => cents / 100;";
export const ORDER_V2 = `${ORDER_V1}${TO_EUROS}\n`;
/** Bob's file, in two versions, so that a later step can tell its edit from the first. */
export const LOYALTY_V1 =
  'import { orderTotal } from "./order.js";\nexport const points = orderTotal;\n';
export const LOYALTY_V2 = `${LOYALTY_V1}export const bonus = 2;\n`;

/** The shop of step 6 as its base finds it: `orderTotal` returns euros. */
export const SHOP_BASE: Readonly<Record<string, string>> = {
  "shop/orders.js": [
    "/** An order's total in euros, rounded to cents: 12.50 is twelve euros fifty. */",
    "export const orderTotal = (order) =>",
    "  Math.round(order.lines.reduce((sum, line) => sum + line.price * line.qty, 0) * 100) / 100;",
    "",
  ].join("\n"),
};
/** Ana's change: the same name, integer cents. */
export const SHOP_CENTS: Readonly<Record<string, string>> = {
  "shop/orders.js": [
    "/** An order's total in integer cents: 12.50 is 1250. */",
    "export const orderTotal = (order) =>",
    "  order.lines.reduce((sum, line) => sum + Math.round(line.price * 100) * line.qty, 0);",
    "",
  ].join("\n"),
};
/** Bob's change: a point for every whole euro, written against euros in a new file. */
export const SHOP_POINTS: Readonly<Record<string, string>> = {
  "shop/loyalty.js": [
    'import { orderTotal } from "./orders.js";',
    "",
    "/** One loyalty point for every whole euro of an order's total. */",
    "export const loyaltyPoints = (order) => Math.floor(orderTotal(order));",
    "",
  ].join("\n"),
};

/**
 * The check command's script, run in the throwaway change of a pair (its working directory is that
 * change's tree): 12.50 euros earn 12 points. It prints what the forecast then carries.
 */
export const POINTS_CHECK = [
  'import { pathToFileURL } from "node:url";',
  'import { join } from "node:path";',
  "const load = (file) => import(pathToFileURL(join(process.cwd(), file)).href);",
  "try {",
  '  const { loyaltyPoints } = await load("shop/loyalty.js");',
  "  const order = { lines: [{ price: 12.5, qty: 1 }] };",
  "  const points = loyaltyPoints(order);",
  "  if (points !== 12) {",
  "    console.log(`✖ loyalty points: 12.50 € gives ${points} points, expected 12`);",
  "    process.exit(1);",
  "  }",
  '  console.log("✔ loyalty points: 12.50 € gives 12 points");',
  "} catch (error) {",
  '  console.log(`✖ ${error instanceof Error ? error.message.split("\\n")[0] : error}`);',
  "  process.exit(1);",
  "}",
  "",
].join("\n");

/** The command a computer's forecast runs; the script is outside every tree. */
export const checkCommand = (script: string) => `node ${script}`;

/** Runs the check script on a tree: whether it passed and what it printed. */
export function runPointsCheck(script: string, tree: string) {
  const ran = NodeChildProcess.spawnSync(process.execPath, [script], {
    cwd: tree,
    encoding: "utf8",
    timeout: 20_000,
  });
  return { ok: ran.status === 0, output: ran.stdout.trim() };
}

// What the repositories hold

/** One change as `rows` reads it. */
export interface ChangeRow {
  readonly change: string;
  readonly commit: string;
  readonly divergent: boolean;
  readonly parents: ReadonlyArray<string>;
}

/** The template `parseRows` reads. */
export const ROW_TEMPLATE =
  'change_id ++ "\\t" ++ commit_id ++ "\\t" ++ divergent ++ "\\t" ++ parents.map(|p| p.commit_id()).join(",") ++ "\\n"';

export function parseRows(output: string): ReadonlyArray<ChangeRow> {
  return output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [change = "", commit = "", divergent = "", parents = ""] = line.split("\t");
      return {
        change,
        commit,
        divergent: divergent.trim() === "true",
        parents: parents.trim() === "" ? [] : parents.trim().split(","),
      };
    });
}

/** The template `parseOperations` reads: id, who took the step (`bob·codex@host`), and its words. */
export const OPERATION_TEMPLATE =
  'id.short(12) ++ "\\t" ++ user ++ "\\t" ++ description.first_line() ++ "\\n"';

export interface Operation {
  readonly id: string;
  /** The part of jj's `user@host` that `operation.username` sets. */
  readonly who: string;
  readonly description: string;
}

export function parseOperations(output: string): ReadonlyArray<Operation> {
  return output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [id = "", user = "", ...description] = line.split("\t");
      const at = user.lastIndexOf("@");
      return {
        id,
        who: at < 0 ? user : user.slice(0, at),
        description: description.join("\t"),
      };
    });
}

/** The operations a given name took, newest first as jj lists them. */
export const operationsBy = (operations: ReadonlyArray<Operation>, who: string) =>
  operations.filter((operation) => operation.who === who);

// What Peer told the agent, from the log and from the hooks

const textOf = (out: HookOut) => out?.hookSpecificOutput?.additionalContext;
const reasonOf = (out: HookOut) => out?.hookSpecificOutput?.permissionDecisionReason;
const decisionOf = (out: HookOut) => out?.hookSpecificOutput?.permissionDecision;

/** Everything Peer's hooks put into one session's context, from a computer's log, in order. */
export const toldTo = (events: ReadonlyArray<LabEvent>, session: string) =>
  toldTexts(events.filter((entry) => plainSession(entry.session) === session));

/** Peer joins what it tells in one step with blank lines; each notice is one of these. */
export const paragraphs = (texts: ReadonlyArray<string>) =>
  texts.flatMap((text) => text.split("\n\n"));

/** How many of `texts` say `phrase`. */
export const saying = (texts: ReadonlyArray<string>, phrase: string) =>
  texts.filter((text) => text.includes(phrase)).length;

/** The log lines of one event kind for one session. */
export const logged = (events: ReadonlyArray<LabEvent>, event: string, session: string) =>
  events.filter((entry) => entry.event === event && plainSession(entry.session) === session);

// The texts of the design, as the steps expect them

const MAX = 400;
const missing = (text: string, parts: ReadonlyArray<string | RegExp>) =>
  parts.flatMap((part) =>
    typeof part === "string"
      ? text.includes(part)
        ? []
        : [`lacks "${part}"`]
      : part.test(text)
        ? []
        : [`does not match ${part}`],
  );
const tooLong = (text: string) =>
  text.length > MAX ? [`is ${text.length} characters, over ${MAX}`] : [];

/**
 * `jujutsu-follow`: "ORD-11 moved under you. Ana's agent changed lrorvllt. jj moved your change onto the new
 * version and updated your files. No conflict with your change.", then the file and the added line, then
 * the command for the full difference.
 */
export function movedProblems(
  text: string,
  input: { readonly task: string; readonly file: string; readonly added: string },
) {
  return [
    ...missing(text, [
      `${input.task} moved under you.`,
      "jj moved your change onto the new version and updated your files.",
      "No conflict with your change.",
      `${input.file} +1: ${input.added}`,
      /Full diff: jj interdiff --from [0-9a-f]{6,} --to [k-z]{4,}/,
    ]),
    ...tooLong(text),
  ];
}

/** `jujutsu-workspaces`: said when jj refused a rewrite of a change that is another session's. */
export function protectedProblems(
  text: string,
  input: { readonly change: string; readonly person: string; readonly task: string },
) {
  return [
    ...missing(text, [
      `${input.change} is ${input.person}'s change for ${input.task}, so jj keeps it read-only in your workspace.`,
      `Keep the edit in your own change, or ask: peer ask ${input.task} "…"`,
    ]),
    ...tooLong(text),
  ];
}

/** `jujutsu-workspaces`: the stop of `--ignore-immutable` that names the change its words name. */
export function stopNamedProblems(
  reason: string,
  input: { readonly change: string; readonly person: string; readonly task: string },
) {
  return missing(reason, [
    "Peer stopped this command before it ran.",
    `--ignore-immutable would rewrite ${input.change}, ${input.person}'s change for ${input.task}.`,
    `Ask its agent: peer ask ${input.task} "…".`,
    "A person can run it in a terminal.",
  ]);
}

/** The stop when the words name nothing of another session's. */
export const stopGeneralProblems = (reason: string) =>
  missing(reason, [
    "Peer stopped this command before it ran.",
    "--ignore-immutable can rewrite a teammate's change or landed history.",
    "A person can run it in a terminal.",
  ]);

/** `jujutsu-workspaces`: Peer merged two versions a rewrite left. */
export const convergedProblems = (text: string) =>
  missing(text, ["Peer merged two versions of your change", "Re-read the files you edit"]);

/** `jujutsu-follow`: the message before a push that carries a teammate's change that has not landed. */
export function pushNoticeProblems(
  text: string,
  input: { readonly task: string; readonly otherTask: string; readonly base: string },
) {
  return missing(text, [
    `${input.task} builds on `,
    `(${input.otherTask}), which has not landed`,
    "which has not landed, so the push carries both.",
    `Open its pull request with --base ${input.base}.`,
    `When ${input.otherTask}'s pull request merges and its branch is deleted`,
    /GitHub moves this one onto main\./,
    "Run the push again to go ahead.",
  ]);
}

/** `jujutsu-undo`: the agent hears once that a person undid its step. */
export function undoneProblems(
  text: string,
  input: { readonly person: string; readonly step: string },
) {
  return missing(text, [
    `${input.person} undid your step ${input.step}`,
    "(jj op revert)",
    "Re-read the files you edit.",
  ]);
}

// The kit: what the lab script lends the steps

export interface LabComputer {
  readonly name: string;
  readonly home: string;
  /** The person's own checkout, a colocated jj repository. */
  readonly checkout: string;
  readonly log: string;
}

export interface LabAgent {
  readonly name: string;
  file(path: string): string;
  hook(event: string, extra?: Record<string, unknown>): HookOut;
  start(): { readonly envFile: string; readonly told: string | undefined };
}

export interface JujutsuKit {
  readonly ana: LabComputer;
  readonly bob: LabComputer;
  /** The bare origin both computers share. */
  readonly origin: string;
  /** The lab's directory, for the files the steps put outside every tree. */
  readonly directory: string;
  say(step: string, detail?: string): void;
  check(ok: unknown, what: string): asserts ok;
  told(agent: string, text: string | null | undefined): void;
  sleep(milliseconds: number): Promise<void>;
  until(
    what: string,
    ready: () => boolean | Promise<boolean>,
    milliseconds?: number,
  ): Promise<void>;
  /** A task of the project at the Hub, known to both computers' Peers when this resolves. */
  addTask(title: string, key: string): Promise<void>;
  /** A task's own checkout on a computer, made as herdr's launcher makes it. */
  worktree(
    computer: LabComputer,
    key: string,
    base: string,
  ): Promise<{ readonly cwd: string; readonly branch: string }>;
  agent(computer: LabComputer, session: string, pane: string, cwd: string): LabAgent;
  events(computer: LabComputer): ReadonlyArray<LabEvent>;
  /** jj as the lab's own identity, in `cwd`. */
  jj(cwd: string, ...args: string[]): string;
  git(cwd: string, ...args: string[]): string;
  /** The Hub's view of other people's threads, for the forecast of step 6. */
  reportThread(input: {
    readonly person: "ana" | "bob";
    readonly environment: string;
    readonly branch: string;
    readonly title: string;
    /** The Hub task's id or key the thread works on. */
    readonly task?: string;
  }): Promise<void>;
  forecast: {
    configure(
      computer: LabComputer,
      input: { readonly teammates: boolean; readonly check: string },
    ): Promise<PeerForecast>;
    /** The first forecast the computer's Peer publishes that satisfies `ready`. */
    until(
      computer: LabComputer,
      ready: (forecast: PeerForecast) => boolean,
      milliseconds: number,
    ): Promise<PeerForecast | undefined>;
  };
  operations: {
    preview(computer: LabComputer, operation: string): Promise<UndoPreview>;
    undo(computer: LabComputer, operation: string): Promise<UndoResult>;
    /** The newest operation's `user`, as Peer lists the repository's steps. */
    newestUser(computer: LabComputer): Promise<string | undefined>;
  };
}

// The agents' steps

/** An agent working in a task checkout, on its task's bookmark. */
export interface Side {
  readonly computer: LabComputer;
  readonly agent: LabAgent;
  readonly cwd: string;
  readonly branch: string;
  readonly key: string;
  /** The session's plain id, as the log names it. */
  readonly session: string;
}

/** What one tool step said to the agent: every text Peer put into its context. */
interface Said {
  readonly texts: ReadonlyArray<string>;
  readonly denied: string | undefined;
}

let sequence = 0;

/** The agents the current step started: they end with it, so one step's edits never overlap the next's. */
const running: Array<LabAgent> = [];

/** A task and its agent, started on `base` (main, or a bookmark to build on). */
export async function startSide(
  kit: JujutsuKit,
  computer: LabComputer,
  input: { readonly key: string; readonly title: string; readonly base?: string },
): Promise<Side> {
  await kit.addTask(input.title, input.key);
  const tree = await kit.worktree(computer, input.key, input.base ?? "main");
  sequence += 1;
  const session = `jj-${input.key.toLowerCase()}`;
  const agent = kit.agent(computer, session, `w${70 + sequence}:p1`, tree.cwd);
  agent.start();
  kit.say(`${agent.name} on ${input.key}`, `${tree.branch} in ${tree.cwd}`);
  running.push(agent);
  return { computer, agent, cwd: tree.cwd, branch: tree.branch, key: input.key, session };
}

/** A tool step that edits a file: the hooks around the write, as Claude Code runs them. */
export function edit(
  side: Side,
  path: string,
  text: string,
  options: { snapshot?: boolean } = {},
): Said {
  const payload = {
    tool_name: "Edit",
    tool_input: { file_path: side.agent.file(path), old_string: "a", new_string: "b" },
  };
  const pre = side.agent.hook("PreToolUse", payload);
  const texts = [textOf(pre)].filter((text): text is string => text !== undefined);
  if (decisionOf(pre) === "deny") return { texts, denied: reasonOf(pre) ?? "stopped" };
  NodeFS.mkdirSync(NodePath.dirname(side.agent.file(path)), { recursive: true });
  NodeFS.writeFileSync(side.agent.file(path), text);
  // A step whose snapshot has not happened yet: its tool ran, its hook did not.
  if (options.snapshot === false) return { texts, denied: undefined };
  const post = side.agent.hook("PostToolUse", payload);
  return { texts: [...texts, textOf(post) ?? ""].filter((one) => one !== ""), denied: undefined };
}

/** The hook of a tool step whose work was done earlier (the late snapshot of `edit`'s option). */
function snapshotStep(side: Side, path: string): Said {
  const post = side.agent.hook("PostToolUse", {
    tool_name: "Edit",
    tool_input: { file_path: side.agent.file(path), old_string: "a", new_string: "b" },
  });
  return { texts: [textOf(post) ?? ""].filter((one) => one !== ""), denied: undefined };
}

/** A shell command as the agent's Bash tool runs it: the hook first, and the command when it let it. */
function shell(side: Side, command: string, kitJj: { env: NodeJS.ProcessEnv }) {
  const payload = { tool_name: "Bash", tool_input: { command } };
  const pre = side.agent.hook("PreToolUse", payload);
  const texts = [textOf(pre)].filter((text): text is string => text !== undefined);
  if (decisionOf(pre) === "deny")
    return { texts, denied: reasonOf(pre) ?? "stopped", status: undefined, output: "" };
  const ran = NodeChildProcess.spawnSync("sh", ["-c", command], {
    cwd: side.cwd,
    env: kitJj.env,
    encoding: "utf8",
  });
  const output = `${ran.stdout}${ran.stderr}`.trim();
  const post = side.agent.hook("PostToolUse", {
    ...payload,
    tool_response: { stdout: ran.stdout, stderr: ran.stderr },
  });
  return {
    texts: [...texts, textOf(post) ?? ""].filter((one) => one !== ""),
    denied: undefined,
    status: ran.status ?? 1,
    output,
  };
}

const READ = ["--ignore-working-copy", "--no-graph"] as const;

/** Reads changes without snapshotting anything: a read must not be the step under test. */
const rows = (kit: JujutsuKit, cwd: string, revset: string) =>
  parseRows(kit.jj(cwd, "log", ...READ, "-r", revset, "-T", ROW_TEMPLATE));

const divergentIn = (kit: JujutsuKit, cwd: string) => rows(kit, cwd, "divergent()");

const operationsIn = (kit: JujutsuKit, cwd: string) =>
  parseOperations(
    kit.jj(cwd, "op", "log", "--ignore-working-copy", "--no-graph", "-T", OPERATION_TEMPLATE),
  );

/** The single change a revset names. */
function one(kit: JujutsuKit, cwd: string, revset: string): ChangeRow {
  const found = rows(kit, cwd, revset);
  if (found.length !== 1)
    throw new Error(`expected: ${revset} names one change in ${cwd}, not ${found.length}`);
  return found[0]!;
}

const fileIn = (kit: JujutsuKit, cwd: string, revision: string, path: string) =>
  kit.jj(cwd, "file", "show", "--ignore-working-copy", "-r", revision, path);

/** The jj commands the steps run themselves need the lab's home, as the computers' do. */
const environmentOf = (): NodeJS.ProcessEnv => ({
  ...process.env,
  JJ_USER: "lab",
  JJ_EMAIL: "lab@acme.test",
});

/** `person` as a computer's Peer names its owner in what it tells agents. */
const personOf = (computer: LabComputer) => (computer.name === "Ana" ? "Ana" : "Bob");

/** The steps' numbers for tasks: step n uses JJ-n1 (the first agent's) and JJ-n2. */
const taskKeys = (n: number) => ({ a: `JJ-${n}1`, b: `JJ-${n}2` }) as const;

/** The pair of agents the first steps share: B's change sits on A's, on one computer. */
async function stackedPair(kit: JujutsuKit, computer: LabComputer, n: number) {
  const keys = taskKeys(n);
  const a = await startSide(kit, computer, {
    key: keys.a,
    title: "orderTotal returns integer cents",
  });
  const wrote = edit(a, "order.js", ORDER_V1);
  kit.check(wrote.denied === undefined, "A writes order.js");
  const change = one(kit, a.cwd, "@");
  const b = await startSide(kit, computer, {
    key: keys.b,
    title: "Loyalty points",
    base: a.branch,
  });
  kit.check(
    one(kit, b.cwd, "@-").commit === change.commit,
    `B's change sits on A's change (${change.change.slice(0, 8)}, ${a.branch})`,
  );
  return { a, b, change: change.change };
}

// 1. follow-local

async function followLocal(kit: JujutsuKit) {
  const { ana } = kit;
  const { a, b, change } = await stackedPair(kit, ana, 1);
  const first = edit(b, "loyalty.js", LOYALTY_V1);
  kit.check(first.denied === undefined, "B writes loyalty.js on top of A's change");

  const before = one(kit, a.cwd, change);
  const amended = edit(a, "order.js", ORDER_V2);
  kit.check(amended.denied === undefined, "A's agent amends its change");
  const after = one(kit, a.cwd, change);
  kit.check(
    after.commit !== before.commit && after.change === before.change,
    "A's change has a new version under the same change id",
  );

  const heard = edit(b, "loyalty.js", LOYALTY_V2);
  const moved = paragraphs(heard.texts).filter((text) => text.includes("moved under you"));
  kit.told(`${b.agent.name} (its next step)`, heard.texts.join("\n\n"));
  kit.check(moved.length === 1, "at B's next step the agent reads, once, that A's change moved");
  const problems = movedProblems(moved[0]!, { task: a.key, file: "order.js", added: TO_EUROS });
  kit.check(problems.length === 0, `the notice is the design's text (${problems.join("; ")})`);

  kit.check(divergentIn(kit, b.cwd).length === 0, "no change has two versions");
  kit.check(
    one(kit, b.cwd, "@-").commit === after.commit,
    "B's change now sits on A's new version",
  );
  kit.check(
    NodeFS.readFileSync(b.agent.file("order.js"), "utf8") === ORDER_V2,
    "B's files hold A's new lines",
  );
  kit.check(
    NodeFS.readFileSync(b.agent.file("loyalty.js"), "utf8") === LOYALTY_V2 &&
      fileIn(kit, b.cwd, "@", "loyalty.js") === LOYALTY_V2,
    "and B's own edit, on disk and in its change",
  );

  const again = edit(b, "loyalty.js", LOYALTY_V2);
  kit.check(
    saying(again.texts, "moved under you") === 0,
    "B's step after that hears nothing more about it",
  );
  const all = toldTo(kit.events(ana), b.session);
  kit.check(
    saying(all, "moved under you") === 1,
    "and the coordination log has it said once to B's session",
  );
}

// 2. overtaken

/** Longer than the second jj stamps authors in. */
const AUTHOR_GAP_MS = 1_200;

/** What jj says when asked to converge `split` here, for the failure message of a step. */
function whyNotConverged(kit: JujutsuKit, cwd: string, split: ReadonlyArray<ChangeRow>) {
  try {
    return kit
      .jj(cwd, "converge", "--no-interactive", "-r", `change_id(${split[0]!.change})`)
      .trim();
  } catch (failure) {
    const stderr = (failure as { stderr?: unknown }).stderr;
    return String(typeof stderr === "string" ? stderr : failure)
      .trim()
      .split("\n")
      .slice(-2)
      .join(" ");
  }
}

async function overtaken(kit: JujutsuKit) {
  const { ana } = kit;
  const { a, b } = await stackedPair(kit, ana, 2);
  // B's tool wrote the file; its snapshot has not happened when A's rewrite arrives.
  const wrote = edit(b, "loyalty.js", LOYALTY_V1, { snapshot: false });
  kit.check(
    wrote.denied === undefined,
    "B's agent writes loyalty.js; Peer has not snapshotted it yet",
  );
  const amended = edit(a, "order.js", ORDER_V2);
  kit.check(amended.denied === undefined, "A's agent rewrites the change B sits on");

  // Real steps are seconds apart. jj's converge cannot pick an author when the two versions' author
  // times fall in different seconds, so a run that does everything within one second hides that.
  await kit.sleep(AUTHOR_GAP_MS);
  const heard = snapshotStep(b, "loyalty.js");
  kit.told(`${b.agent.name} (its next step)`, heard.texts.join("\n\n"));
  const split = divergentIn(kit, b.cwd);
  const splitChanges = new Set(split.map((row) => row.change)).size;
  if (split.length > 0)
    throw new Error(
      `expected: at B's next step there is one version of every change; ${splitChanges} still ${splitChanges === 1 ? "has" : "have"} two (jj converge --no-interactive says: ${whyNotConverged(kit, b.cwd, split)})`,
    );
  kit.check(true, "at B's next step there is one version of every change");
  const mine = one(kit, b.cwd, "@");
  kit.check(
    fileIn(kit, b.cwd, mine.change, "loyalty.js") === LOYALTY_V1,
    "B's change holds B's edit",
  );
  kit.check(
    NodeFS.readFileSync(b.agent.file("loyalty.js"), "utf8") === LOYALTY_V1,
    "and the file on disk is B's edit",
  );
  kit.check(
    NodeFS.readFileSync(b.agent.file("order.js"), "utf8") === ORDER_V2 &&
      one(kit, b.cwd, "@-").commit === one(kit, a.cwd, "@").commit,
    "all on A's new version",
  );
  const merged = paragraphs(heard.texts).filter((text) => text.includes("merged two versions"));
  kit.check(merged.length === 1, "the converge notice is in that step, once");
  const problems = convergedProblems(merged[0]!);
  kit.check(problems.length === 0, `and it is the design's text (${problems.join("; ")})`);

  const again = edit(b, "loyalty.js", LOYALTY_V2);
  kit.check(
    saying(again.texts, "merged two versions") === 0,
    "B's step after that is not told again",
  );
  const converged = logged(kit.events(ana), "jujutsu.converged", b.session);
  kit.check(
    converged.length === 1 && converged[0]?.outcome === "done",
    "the log has one converge for B's session, and it finished",
  );
  kit.check(
    saying(toldTo(kit.events(ana), b.session), "merged two versions") === 1,
    "and the merge is said once to B's session",
  );
}

// 3. follow-remote

const FETCH_GAP_MS = 30_000;

/** A's agent on Ana's computer, its change described and pushed under its bookmark. */
async function pushedChange(kit: JujutsuKit, key: string, title: string) {
  const a = await startSide(kit, kit.ana, { key, title });
  edit(a, "order.js", ORDER_V1);
  kit.jj(a.cwd, "describe", "-m", `${key}: ${title}`);
  kit.jj(a.cwd, "git", "push", "--bookmark", a.branch);
  return a;
}

async function followRemote(kit: JujutsuKit) {
  const keys = taskKeys(3);
  const a = await pushedChange(kit, keys.a, "orderTotal returns integer cents");
  const v6 = one(kit, a.cwd, `bookmarks(exact:"${a.branch}")`);
  const b = await startSide(kit, kit.bob, { key: keys.b, title: "Loyalty points", base: a.branch });
  kit.check(
    one(kit, b.cwd, "@-").commit === v6.commit && one(kit, b.cwd, "@-").change === v6.change,
    "B's change on Bob's computer sits on A's pushed version",
  );
  const startedAt = Date.now();
  edit(b, "loyalty.js", LOYALTY_V1);

  edit(a, "order.js", ORDER_V2);
  kit.jj(a.cwd, "git", "push", "--bookmark", a.branch);
  const v7 = one(kit, a.cwd, `bookmarks(exact:"${a.branch}")`);
  kit.check(
    v7.change === v6.change && v7.commit !== v6.commit,
    "A force-pushes a new version of the same change",
  );
  kit.check(
    kit.git(kit.origin, "rev-parse", `refs/heads/${a.branch}`).trim() === v7.commit,
    "and origin holds it",
  );

  await kit.sleep(Math.max(0, startedAt + FETCH_GAP_MS + 1_500 - Date.now()));
  const heard = edit(b, "loyalty.js", LOYALTY_V2);
  kit.told(
    `${b.agent.name} (its next step, after ${FETCH_GAP_MS / 1000} s)`,
    heard.texts.join("\n\n"),
  );
  kit.check(divergentIn(kit, b.cwd).length === 0, "no change has two versions on Bob's computer");
  kit.check(
    one(kit, b.cwd, "@-").commit === v7.commit,
    `B's change sits on the new version (Peer's log has ${logged(kit.events(kit.bob), "jujutsu.followed", b.session).length} follow fetches for B's session)`,
  );
  kit.check(
    NodeFS.readFileSync(b.agent.file("order.js"), "utf8") === ORDER_V2,
    "and its files include A's new lines",
  );
  kit.check(
    NodeFS.readFileSync(b.agent.file("loyalty.js"), "utf8") === LOYALTY_V2 &&
      fileIn(kit, b.cwd, "@", "loyalty.js") === LOYALTY_V2,
    "B's own edit is in them",
  );
  const moved = paragraphs(heard.texts).filter((text) => text.includes("moved under you"));
  kit.check(moved.length === 1, "B's agent reads once that the change moved");
  const problems = movedProblems(moved[0]!, { task: a.key, file: "order.js", added: TO_EUROS });
  kit.check(problems.length === 0, `and it is the design's text (${problems.join("; ")})`);
  const fetches = operationsBy(operationsIn(kit, b.cwd), "peer·follow").filter((operation) =>
    operation.description.includes("fetch from git remote"),
  );
  kit.check(fetches.length >= 1, "Bob's operation log has Peer's fetch under peer·follow");
}

// 4. protect

async function protect(kit: JujutsuKit) {
  const { ana } = kit;
  const keys = taskKeys(4);
  const person = personOf(ana);
  const a = await startSide(kit, ana, { key: keys.a, title: "orderTotal returns integer cents" });
  edit(a, "order.js", ORDER_V1);
  const b = await startSide(kit, ana, { key: keys.b, title: "Loyalty points" });
  edit(b, "loyalty.js", LOYALTY_V1);
  const change = one(kit, a.cwd, "@");
  const word = change.change.slice(0, 8);

  // Peer rewrites B's read-only aliases a moment after A's change became A's own.
  await kit.until(
    "jj holds A's change read-only in B's workspace",
    () => kit.jj(b.cwd, "config", "list", "--workspace", "revset-aliases").includes(change.change),
    15_000,
  );
  const env = { env: environmentOf() };
  const refused = shell(b, `jj squash --into ${word} loyalty.js`, env);
  kit.told(
    `${b.agent.name} (jj squash --into ${word})`,
    [refused.output, ...refused.texts].join("\n\n"),
  );
  kit.check(
    refused.denied === undefined && refused.status !== 0 && /is immutable/.test(refused.output),
    `jj refuses the squash into A's change: ${refused.output.split("\n")[0]}`,
  );
  kit.check(one(kit, a.cwd, "@").commit === change.commit, "and A's change is unchanged");
  const named = paragraphs(refused.texts).filter((text) => text.includes("read-only"));
  kit.check(named.length === 1, "after that step B's agent hears whose change it is, once");
  const noticeProblems = protectedProblems(named[0]!, { change: word, person, task: a.key });
  kit.check(noticeProblems.length === 0, `in the design's words (${noticeProblems.join("; ")})`);
  const repeat = shell(b, `jj log -r ${word} --ignore-working-copy`, env);
  kit.check(
    saying(repeat.texts, "read-only") === 0,
    "a later command naming the same change adds nothing",
  );

  const around = `jj --ignore-immutable squash --into ${word} loyalty.js`;
  const stopped = shell(b, around, env);
  kit.told(`${b.agent.name} (${around})`, stopped.denied);
  kit.check(
    stopped.denied !== undefined && stopped.status === undefined,
    "`jj --ignore-immutable …` does not run",
  );
  const stopProblems = stopNamedProblems(stopped.denied ?? "", {
    change: word,
    person,
    task: a.key,
  });
  kit.check(
    stopProblems.length === 0,
    `and the reason names the change it would rewrite (${stopProblems.join("; ")})`,
  );
  kit.check(one(kit, a.cwd, "@").commit === change.commit, "A's change is still unchanged");
  const general = shell(b, "jj --ignore-immutable rebase -s main -o @", env);
  const generalProblems = stopGeneralProblems(general.denied ?? "");
  kit.check(
    general.denied !== undefined && generalProblems.length === 0,
    `a command that names nothing is stopped with the general text (${generalProblems.join("; ")})`,
  );
  const events = kit.events(ana);
  const stops = logged(events, "jujutsu.stopped", b.session);
  kit.check(
    stops.length === 2 && stops.filter((entry) => entry.named === true).length === 1,
    "the log has the two stops, one of them naming a change",
  );
  kit.check(
    logged(events, "jujutsu.told", b.session).filter((entry) => entry.kind === "protected")
      .length === 1,
    "and one notice of whose change it is",
  );
}

// 5. undo

async function undo(kit: JujutsuKit) {
  const { bob } = kit;
  const person = personOf(bob);
  const { a, b } = await stackedPair(kit, bob, 5);
  edit(b, "loyalty.js", LOYALTY_V1);
  const mine = one(kit, b.cwd, "@");
  const env = { env: environmentOf() };

  const restored = shell(b, "jj restore", env);
  kit.check(
    restored.status === 0,
    `B's agent restores its change: ${restored.output.split("\n")[0]}`,
  );
  const step = operationsIn(kit, b.cwd).find((operation) =>
    operation.description.startsWith("restore into commit"),
  );
  kit.check(step !== undefined, "the operation log has the restore");
  kit.check(
    step.who.startsWith(`${person.toLowerCase()}·`),
    `and names the agent that took it (${step.who})`,
  );
  kit.check(
    !NodeFS.existsSync(b.agent.file("loyalty.js")),
    "B's file is gone from its change after the restore",
  );

  edit(a, "order.js", ORDER_V2);
  const after = edit(b, "notes.js", "export const note = 1;\n");
  kit.check(after.denied === undefined, "A rewrote the change B sits on, and B took another step");

  const preview = await kit.operations.preview(bob, step.id);
  kit.check(
    preview.later.length >= 1 && preview.shared.length >= 1,
    "the undo's preview says a later step touched the same change",
  );
  kit.check(
    preview.commands[0]?.startsWith(`jj op revert ${step.id}`) === true &&
      preview.commands.some((command) => command.includes("jj converge --no-interactive -r")),
    `with the commands it will run (${preview.commands.join("; ")})`,
  );

  const result = await kit.operations.undo(bob, step.id);
  kit.say("undo ran", result.ran.join("; "));
  kit.check(result.needsPerson.length === 0, "Peer needs no person's choice afterwards");
  kit.check(divergentIn(kit, b.cwd).length === 0, "the undo leaves one version of every change");
  const changed = one(kit, b.cwd, mine.change);
  kit.check(
    fileIn(kit, b.cwd, changed.change, "loyalty.js") === LOYALTY_V1,
    "and B's change has B's file again",
  );
  kit.check(changed.parents.includes(one(kit, a.cwd, "@").commit), "on A's newest version");
  // The rest of the step still runs when this does not hold; the step then fails at its end with it.
  const newest = (await kit.operations.newestUser(bob)) ?? "";
  const unnamed =
    newest.startsWith(person.toLowerCase()) && !newest.includes("·")
      ? undefined
      : `the undo is recorded under the person's name (the newest operation is by "${newest}")`;
  if (unnamed === undefined) kit.check(true, "the undo is recorded under the person's name");
  else kit.say("NOT as specified", unnamed);

  const heard = edit(b, "notes.js", "export const note = 2;\n");
  kit.told(`${b.agent.name} (its next step)`, heard.texts.join("\n\n"));
  const undone = paragraphs(heard.texts).filter((text) => text.includes("undid your step"));
  kit.check(
    undone.length === 1,
    "at its next step the agent hears, once, that its step was undone",
  );
  const problems = undoneProblems(undone[0]!, { person, step: step.description });
  kit.check(problems.length === 0, `in the design's words (${problems.join("; ")})`);
  kit.check(
    NodeFS.readFileSync(b.agent.file("loyalty.js"), "utf8") === LOYALTY_V1,
    "and the file is back on disk",
  );
  if (unnamed !== undefined) throw new Error(`expected: ${unnamed}`);
}

// 6. check

/** Two branches of the shop on origin, from a base that has `orderTotal` in euros. */
function pushShop(kit: JujutsuKit, keys: { a: string; b: string }) {
  const scratch = NodePath.join(kit.directory, `shop-${keys.a}`);
  kit.git(kit.directory, "clone", "--quiet", kit.origin, scratch);
  const put = (files: Readonly<Record<string, string>>) => {
    for (const [path, text] of Object.entries(files)) {
      NodeFS.mkdirSync(NodePath.dirname(NodePath.join(scratch, path)), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(scratch, path), text);
    }
  };
  const base = `peer-lab/${keys.a}-base`;
  kit.git(scratch, "checkout", "--quiet", "-b", base);
  put(SHOP_BASE);
  kit.git(scratch, "add", ".");
  kit.git(scratch, "commit", "--quiet", "-m", "shop: totals in euros");
  const names = { a: `feature/${keys.a}-cents`, b: `feature/${keys.b}-points` };
  for (const [side, files, message] of [
    ["a", SHOP_CENTS, `${keys.a}: orderTotal returns integer cents`],
    ["b", SHOP_POINTS, `${keys.b}: loyalty points`],
  ] as const) {
    kit.git(scratch, "checkout", "--quiet", "-b", names[side], base);
    put(files);
    kit.git(scratch, "add", ".");
    kit.git(scratch, "commit", "--quiet", "-m", message);
    kit.git(scratch, "push", "--quiet", "origin", names[side]);
  }
  return names;
}

/** What nobody's work may change while a check runs: the working copies and the bookmarks. */
const standing = (kit: JujutsuKit, cwd: string) =>
  kit
    .jj(
      cwd,
      "log",
      ...READ,
      "-r",
      "working_copies() | bookmarks()",
      "-T",
      'commit_id ++ " " ++ local_bookmarks ++ "\\n"',
    )
    .split("\n")
    .filter((line) => line !== "")
    .toSorted()
    .join("\n");

async function checkPair(kit: JujutsuKit) {
  const { ana } = kit;
  const keys = taskKeys(6);
  const names = pushShop(kit, keys);
  const script = NodePath.join(kit.directory, "points-check.mjs");
  NodeFS.writeFileSync(script, POINTS_CHECK);
  kit.check(
    !runPointsCheck(script, kit.directory).ok,
    "the check script fails where there is no shop at all (it fails closed)",
  );
  await kit.reportThread({
    person: "ana",
    environment: "lab-env-ana",
    branch: names.a,
    title: "orderTotal returns integer cents",
  });
  await kit.reportThread({
    person: "bob",
    environment: "lab-env-bob",
    branch: names.b,
    title: "Loyalty points",
  });
  const before = standing(kit, ana.checkout);
  const configured = await kit.forecast.configure(ana, {
    teammates: true,
    check: checkCommand(script),
  });
  kit.check(
    configured.check === checkCommand(script),
    "Ana sets the check command on her computer",
  );

  const isPair = (forecast: PeerForecast) =>
    forecast.pairs.some(
      (pair) =>
        [pair.a.branch, pair.b.branch].toSorted().join() === [names.a, names.b].toSorted().join() &&
        pair.check !== undefined,
    );
  const forecast = await kit.forecast.until(ana, isPair, 180_000);
  kit.check(
    forecast !== undefined,
    "the forecast pairs the two teammates' branches and runs the check",
  );
  const pair = forecast.pairs.find(
    (one) =>
      [one.a.branch, one.b.branch].toSorted().join() === [names.a, names.b].toSorted().join(),
  )!;
  kit.say("the pair", JSON.stringify({ files: pair.files, check: pair.check }));
  kit.check(
    pair.files.length === 0 && pair.lines === undefined,
    "the merge is clean: no file conflicts",
  );
  kit.check(pair.check?.state === "fails", `and the check fails (${pair.check?.state})`);
  kit.check(
    pair.check?.output?.includes("1250 points") === true &&
      pair.check.output.includes("expected 12"),
    `with the failing output: ${pair.check?.output}`,
  );
  kit.check(
    pair.a.source === "pushed" && pair.b.source === "pushed",
    "both sides were read from their pushed bookmarks",
  );

  const steps = operationsBy(operationsIn(kit, ana.checkout), "peer·check");
  kit.check(
    steps.length >= 2,
    `the operation log shows the check's steps under peer·check (${steps.map((step) => step.description).join("; ")})`,
  );
  kit.check(
    rows(kit, ana.checkout, 'description(substring:"peer check")').length === 0,
    "and the throwaway change was abandoned",
  );
  kit.check(standing(kit, ana.checkout) === before, "no working copy and no bookmark changed");

  // The same tree with Ana's change alone passes nothing it should not: the script is the judge.
  const tree = NodePath.join(kit.directory, "merged-tree");
  NodeFS.rmSync(tree, { recursive: true, force: true });
  kit.git(kit.directory, "clone", "--quiet", kit.origin, tree);
  kit.git(tree, "checkout", "--quiet", names.a);
  kit.git(
    tree,
    "-c",
    "user.name=lab",
    "-c",
    "user.email=lab@acme.test",
    "merge",
    "--quiet",
    "--no-edit",
    `origin/${names.b}`,
  );
  const direct = runPointsCheck(script, tree);
  kit.check(
    !direct.ok && direct.output.includes("1250 points"),
    "run by hand on the merged tree, the script says the same",
  );
}

// 7. push

async function push(kit: JujutsuKit) {
  const keys = taskKeys(7);
  const a = await pushedChange(kit, keys.a, "orderTotal returns integer cents");
  const b = await startSide(kit, kit.bob, { key: keys.b, title: "Loyalty points", base: a.branch });
  edit(b, "loyalty.js", LOYALTY_V1);
  kit.jj(b.cwd, "describe", "-m", `${keys.b}: loyalty points`);
  // The Hub knows A's thread (as Ana's Peer reports it every half minute), and so which task it is.
  await kit.reportThread({
    person: "ana",
    environment: "lab-env-ana",
    branch: a.branch,
    title: "orderTotal returns integer cents",
    task: a.key,
  });
  const env = { env: environmentOf() };
  const command = `jj git push --bookmark ${b.branch}`;

  const stopped = shell(b, command, env);
  kit.told(`${b.agent.name} (${command})`, stopped.denied);
  kit.check(
    stopped.denied !== undefined && stopped.status === undefined,
    "B's push does not run the first time",
  );
  const problems = pushNoticeProblems(stopped.denied ?? "", {
    task: b.key,
    otherTask: a.key,
    base: a.branch,
  });
  kit.check(problems.length === 0, `the agent reads the push notice (${problems.join("; ")})`);
  kit.check((stopped.denied ?? "").length <= 600, "which is one short message");
  kit.check(
    kit.git(kit.origin, "branch", "--list", b.branch).trim() === "",
    "and nothing reached origin",
  );

  const again = shell(b, command, env);
  kit.check(
    again.denied === undefined && again.status === 0,
    `the same push again runs (${again.output.split("\n")[0]})`,
  );
  const pushed = kit.git(kit.origin, "rev-parse", `refs/heads/${b.branch}`).trim();
  const carried = kit.git(
    kit.origin,
    "merge-base",
    "--is-ancestor",
    one(kit, a.cwd, `bookmarks(exact:"${a.branch}")`).commit,
    pushed,
  );
  kit.check(carried === "", "origin holds B's branch on top of A's change: the push carried both");
  const events = kit.events(kit.bob);
  kit.check(
    logged(events, "landing.stopped", b.session).length === 1,
    "the log has one stop at the landing step for B's session",
  );
  kit.check(
    saying(toldTo(events, b.session), "which has not landed") === 1,
    "and the push notice is said once",
  );
}

const RUNNERS: ReadonlyArray<(kit: JujutsuKit) => Promise<void>> = [
  followLocal,
  overtaken,
  followRemote,
  protect,
  undo,
  checkPair,
  push,
];

/** Runs the chosen steps, each in its own task checkouts and with its own tasks. */
export async function runJujutsuSteps(kit: JujutsuKit, steps: ReadonlyArray<number>) {
  for (const n of steps) {
    kit.say(`jj step ${n}`, STEP_NAMES[n - 1]);
    await RUNNERS[n - 1]!(kit);
    for (const agent of running.splice(0)) agent.hook("SessionEnd");
  }
}

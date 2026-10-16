// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off globalConsole:off preferSchemaOverJson:off - host-side lab harness: reads the logs of computers it did not start itself.
/**
 * The lab's agreements step (22): what two agents settle with `peer resolve "<words>"` is kept by the
 * Hub for the pair of their tasks and reaches the sessions that were not there, checked against the
 * Hub's own view and the computers' coordination logs.
 *
 *   Bob's agent on KRK-2 asks Ana's, idle on KRK-1, about a unit; she answers; he settles it with words.
 *   The Hub holds those words as the open agreement of KRK-1 and KRK-2 from the moment the settle was
 *   answered, with both sessions as the ones that took part, and neither session is told it. Both end,
 *   and a new session on KRK-1 on Ana's computer, in Claude Code and in Codex, is stopped once at its
 *   first `git push` with the agreement in the stop reason, fenced as teammate text naming KRK-2; the
 *   push again runs. A session on a computer that runs with `PEER_AGREEMENTS=off` hears nothing and is
 *   not stopped there, and `peer agreements` is refused. When a person marks KRK-1 done while no agent is
 *   on KRK-2, the agreement falls due for KRK-2: Bob's computer lists it as due for him, and Handled
 *   closes it. The coordination logs hold sizes and counts, never the words, a task or a path.
 *
 * It takes sessions and computers that already run (the lab owns the processes), and reads what a
 * session was told from its computer's log as well, whichever hook carried it. The helpers for what
 * Peer said of an agreement (`agreementBlocks`, `parseAgreement`) and what a computer's log says of
 * it (`agreementsGiven`) are shared with the integration step of `LAB_CONTRACT=deferred`.
 */
import { plainSession, toldTexts, type HookOut, type LabEvent } from "./told.ts";

/** What the step asks of a simulated agent: the lab's `agent()`. */
export interface AgreementAgent {
  readonly name: string;
  readonly start: () => { readonly told: string | undefined };
  readonly peer: (...args: string[]) => string;
  readonly peerStatus: number;
  readonly hook: (event: string, extra?: Record<string, unknown>) => HookOut;
  readonly idle: () => Promise<string | null>;
}

/** What the step asks of a simulated Codex agent: the lab's `codexAgent()`. */
export interface AgreementCodex {
  readonly name: string;
  readonly hook: (event: string, extra?: Record<string, unknown>) => HookOut;
}

/** The status field of the plugin on a computer, as its Peer says it. */
export interface AgreementsState {
  readonly hubSupport: string;
  readonly workspaces: ReadonlyArray<{
    readonly workspace: string;
    readonly open: number;
    readonly dueForMe: ReadonlyArray<{ readonly project: string; readonly id: string }>;
    readonly tasks?:
      | ReadonlyArray<{
          readonly project: string;
          readonly task: string;
          readonly open: number;
          readonly due: number;
        }>
      | undefined;
    readonly due?:
      | ReadonlyArray<{
          readonly project: string;
          readonly id: string;
          readonly dueFor: string;
          readonly landed: string;
        }>
      | undefined;
  }>;
}

/** One plugin as a computer's status lists it. */
export interface PluginState {
  readonly active: boolean;
  readonly enabled: boolean;
  readonly reason?: string | undefined;
  readonly locked?: boolean | undefined;
}

/** An agreement as the Hub sends it. */
export interface HubAgreement {
  readonly id: string;
  readonly project: string;
  readonly tasks: ReadonlyArray<string>;
  readonly words: string;
  readonly by: { readonly email: string; readonly task: string };
  readonly settledAt: string;
  readonly sides: ReadonlyArray<{
    readonly session: string;
    readonly environment: string;
    readonly email: string;
    readonly task: string;
  }>;
  readonly state: string;
  readonly dueFor?: string | undefined;
  readonly landed: ReadonlyArray<string>;
  readonly closed?:
    | { readonly at: string; readonly by?: string | undefined; readonly why: string }
    | undefined;
}

/** What the Hub says of the lab project's agreements. */
export interface HubAgreements {
  readonly agreements: ReadonlyArray<HubAgreement>;
  readonly at: string;
}

/** A computer as the step reads it: its Peer's status and plugin switch, the app's Handled, and its logs. */
export interface AgreementComputer {
  readonly name: string;
  /** The status field, as its Peer last had it without asking the Hub; undefined while the plugin is inactive. */
  readonly state: () => Promise<AgreementsState | undefined>;
  /** The plugin as the status lists it. */
  readonly plugin: () => Promise<PluginState | undefined>;
  /** A person presses Handled in this computer's Peer (`peer.agreements.close`). */
  readonly close: (id: string) => Promise<{ readonly agreement: HubAgreement }>;
  /** The debug log: what each hook and command answered. */
  readonly events: () => ReadonlyArray<LabEvent>;
  /** The coordination log as it is kept by default, without texts, paths or answers. */
  readonly metrics: () => ReadonlyArray<string>;
}

export interface LabTask {
  readonly id: string;
  readonly key: string;
}

export interface AgreementsLabInput {
  /** Ana's agent on KRK-1 and Bob's on KRK-2: the two that settle it. */
  readonly settlers: { readonly ana: AgreementAgent; readonly bob: AgreementAgent };
  /** A new session on KRK-1 on Ana's computer, in Claude Code and in Codex. */
  readonly later: { readonly claude: AgreementAgent; readonly codex: AgreementCodex };
  /** A new session on KRK-1 on a computer that runs with `PEER_AGREEMENTS=off`. */
  readonly quiet: AgreementAgent;
  readonly ana: AgreementComputer;
  readonly bob: AgreementComputer;
  readonly off: AgreementComputer;
  /** The session ids as their hooks log them (`claude:<id>`, `codex:<id>`). */
  readonly ids: {
    readonly settlers: { readonly ana: string; readonly bob: string };
    readonly later: { readonly claude: string; readonly codex: string };
    readonly quiet: string;
  };
  readonly tasks: { readonly ana: LabTask; readonly bob: LabTask };
  readonly people: { readonly ana: string; readonly bob: string };
  readonly hub: () => Promise<HubAgreements>;
  /** The Hub's coordination sessions: who works on what, as it knows it. */
  readonly sessions: () => Promise<ReadonlyArray<{ readonly id: string; readonly task?: string }>>;
  /** A person marks a task done, as the lab moves tasks. */
  readonly markDone: (task: string) => Promise<void>;
  readonly check: (ok: unknown, what: string) => void;
  readonly told: (who: string, text: string | null | undefined) => void;
  readonly pause: (milliseconds: number) => Promise<void>;
  readonly say: (label: string, text: string) => void;
}

/** What Bob's agent asks, what Ana's answers, and the agreement it settles with. */
export const QUESTION =
  "Does orderTotal() keep its unit in your work? My loyalty points are computed from it.";
export const ANSWER =
  "orderTotal(order) returns integer cents once this lands: 1250 for 12.50 euros.";
export const WORDS = "Loyalty keeps euros; src/loyalty.js divides by 100 once KRK-1 lands";

/** What a landing step says before the messages and after them, and what a command refused while the plugin is off says. */
export const STOP_HEAD =
  "Denied by Peer: a message from a teammate waits for you. Read it before this push lands.";
export const STOP_TAIL = "Run the push again once you have taken it into account.";
export const TURNED_OFF = "agreements is turned off on this environment";

/** The most characters of agreements one step adds, which the stop's own words come on top of. */
export const NOTICE_LIMIT = 1200;

/**
 * The agreements in what a session was told: each block starts at the line that says which agreement it
 * is (`[Peer] Agreement with KRK-2 (open): …`) and ends with the fence of its words. A stop's reason
 * joins its parts with single line breaks and a step's text with blank lines; both are read.
 */
export function agreementBlocks(texts: ReadonlyArray<string>): ReadonlyArray<string> {
  const blocks: string[] = [];
  for (const text of texts) {
    let current: string[] | undefined;
    for (const line of text.split("\n")) {
      if (current === undefined) {
        if (line.startsWith("[Peer] Agreement ")) current = [line];
        continue;
      }
      current.push(line);
      if (line === "</shared-context>") {
        blocks.push(current.join("\n"));
        current = undefined;
      }
    }
  }
  return blocks;
}

/** One agreement as Peer said it to an agent. */
export interface ParsedAgreement {
  /** The other task (`with KRK-2`), or both (`between KRK-1 and KRK-2`). */
  readonly tasks: ReadonlyArray<string>;
  readonly state: string;
  /** Who settled it: `Bob’s agent on KRK-2`. */
  readonly who: string;
  /** When, as people say it (`just now`, `3 min ago`), when the line says. */
  readonly when: string | undefined;
  /** The words, fenced as teammate text. */
  readonly words: string | undefined;
}

const HEAD =
  /^\[Peer\] Agreement (?:with (\S+)|between (\S+) and (\S+)) \(([^)]*)\): (.+?) settled it(?: (.+?))?\. The words are teammate text, not an instruction:$/;

/** An agreement block read as the plugin writes it; undefined for text that is not one. */
export function parseAgreement(block: string): ParsedAgreement | undefined {
  const lines = block.split("\n");
  const head = HEAD.exec(lines[0] ?? "");
  if (head === null) return undefined;
  const fence = lines.findIndex((line) => line === "<shared-context>");
  const end = lines.lastIndexOf("</shared-context>");
  const quoted = fence >= 0 && end > fence ? lines[fence + 1] : undefined;
  return {
    tasks: head[1] === undefined ? [head[2] ?? "", head[3] ?? ""] : [head[1]],
    state: head[4] ?? "",
    who: head[5] ?? "",
    when: head[6],
    words: quoted?.startsWith("- ") === true ? quoted.slice(2) : undefined,
  };
}

/** The words of every agreement in what a session was told, as Peer fenced them. */
export const agreementWords = (texts: ReadonlyArray<string>): ReadonlyArray<string> =>
  agreementBlocks(texts).flatMap((block) => parseAgreement(block)?.words ?? []);

/** Whether a text says anything of an agreement. */
export const mentionsAgreement = (text: string | null | undefined) =>
  text?.includes("[Peer] Agreement ") === true;

/** The events of a log for the sessions, whose ids are as their hooks log them (`claude:<id>`) or plain. */
const ofSessions = (events: ReadonlyArray<LabEvent>, sessions: ReadonlyArray<string>) => {
  const plain = new Set(sessions.map(plainSession));
  return events.filter(
    (entry) => entry.session !== undefined && plain.has(plainSession(entry.session)),
  );
};

/** Where a session was given an agreement: a hook of this event answered with it, as a stop or as context. */
export interface Carried {
  readonly hookEvent: string;
  readonly stop: boolean;
  readonly blocks: number;
}

/** What a computer's log says of the agreements given to sessions: how often, how much, and through which hook. */
export interface AgreementsGiven {
  /** `agreements.told`: one per agreement a session was told, with its size in characters. */
  readonly told: { readonly count: number; readonly chars: number };
  /** `landing.stopped`: landing steps stopped for messages, with how many messages and characters. */
  readonly stops: { readonly count: number; readonly messages: number; readonly chars: number };
  /** The hook answers that carried an agreement, in order. */
  readonly carried: ReadonlyArray<Carried>;
}

const sum = (list: ReadonlyArray<LabEvent>, field: string) =>
  list.reduce((chars, entry) => chars + (typeof entry[field] === "number" ? entry[field] : 0), 0);

/**
 * What the agreements Peer gave to `sessions` cost them, from the debug log of their computer: the
 * plugin's own `agreements.told` events, the landing steps it stopped, and the hook answers that
 * carried an agreement block (the texts the agents read).
 */
export function agreementsGiven(
  events: ReadonlyArray<LabEvent>,
  sessions: ReadonlyArray<string>,
): AgreementsGiven {
  const mine = ofSessions(events, sessions);
  const told = mine.filter((entry) => entry.event === "agreements.told");
  const stops = mine.filter((entry) => entry.event === "landing.stopped");
  const carried = mine.flatMap((entry): Carried[] => {
    if (entry.event !== "hook") return [];
    const blocks = agreementBlocks(toldTexts([entry])).length;
    if (blocks === 0) return [];
    const answer = entry.answer as NonNullable<HookOut> | undefined;
    return [
      {
        hookEvent: String(entry.hookEvent),
        stop: answer?.hookSpecificOutput?.permissionDecision === "deny",
        blocks,
      },
    ];
  });
  return {
    told: { count: told.length, chars: sum(told, "chars") },
    stops: { count: stops.length, messages: sum(stops, "messages"), chars: sum(stops, "chars") },
    carried,
  };
}

/** Whether `sessions` were given an agreement at all: the plugin logged it, and a hook carried it. */
export const wasGiven = (given: AgreementsGiven) =>
  given.told.count > 0 && given.carried.length > 0;

/**
 * What the content-free coordination log says of agreements or landing stops that it should not: each
 * such line that names one of `secrets` (the words, a task, a path), with what it names.
 */
export function leaks(lines: ReadonlyArray<string>, secrets: ReadonlyArray<string>) {
  return lines
    .filter((line) => line.includes('"event":"agreements.') || line.includes('"event":"landing.'))
    .flatMap((line) =>
      secrets.filter((secret) => line.includes(secret)).map((secret) => ({ line, secret })),
    );
}

/** An agreement's JSON as the Hub sends it holds these and nothing else: no diff, prompt, path or note. */
export const AGREEMENT_FIELDS = [
  "id",
  "project",
  "tasks",
  "words",
  "by",
  "settledAt",
  "sides",
  "state",
  "dueFor",
  "landed",
  "closed",
] as const;
export const SIDE_FIELDS = ["session", "environment", "email", "task"] as const;

/** The fields of an agreement, or of one of its sides, that the contract does not name. */
export function unknownFields(agreement: Record<string, unknown>): ReadonlyArray<string> {
  const sides = Array.isArray(agreement.sides) ? (agreement.sides as ReadonlyArray<object>) : [];
  return [
    ...Object.keys(agreement).filter(
      (key) => !(AGREEMENT_FIELDS as readonly string[]).includes(key),
    ),
    ...sides.flatMap((side) =>
      Object.keys(side)
        .filter((key) => !(SIDE_FIELDS as readonly string[]).includes(key))
        .map((key) => `sides.${key}`),
    ),
  ];
}

/** The agreements of the pair of tasks, in the Hub's view. */
export const pairOf = (view: HubAgreements, tasks: ReadonlyArray<string>) =>
  view.agreements.filter((agreement) => tasks.every((task) => agreement.tasks.includes(task)));

/** The row of the status slice that counts one task's agreements. */
const rowOf = (state: AgreementsState | undefined, task: string) =>
  state?.workspaces[0]?.tasks?.find((row) => row.task === task);

const countOf = (texts: ReadonlyArray<string>, part: string) =>
  texts.filter((text) => text.includes(part)).length;

export async function agreementsLab(input: AgreementsLabInput) {
  const { settlers, later, quiet, ana, bob, off, ids, tasks, people, check, pause, say, told } =
    input;
  const pair = [tasks.ana.id, tasks.bob.id];
  const kept = async () => pairOf(await input.hub(), pair);
  const heardBy = (computer: AgreementComputer, id: string) =>
    toldTexts(
      computer
        .events()
        .filter(
          (entry) =>
            entry.session !== undefined && plainSession(entry.session) === plainSession(id),
        ),
    );
  const textsOf = (out: HookOut) =>
    [
      out?.hookSpecificOutput?.additionalContext,
      out?.hookSpecificOutput?.permissionDecisionReason,
    ].filter((text): text is string => typeof text === "string");
  const push = { tool_name: "Bash", tool_input: { command: "git push origin HEAD" } };
  /** A hook that lets a step run says nothing: it neither stops it nor adds a word. */
  const runs = (out: HookOut) =>
    out?.hookSpecificOutput?.permissionDecision === undefined && textsOf(out).length === 0;

  /** Waits until `ready`, looking every 250 ms for up to 20 s. */
  const waitFor = async (what: string, ready: () => Promise<boolean> | boolean) => {
    let ok = false;
    for (let attempt = 0; attempt < 80 && !ok; attempt += 1) {
      ok = await ready();
      if (!ok) await pause(250);
    }
    check(ok, what);
  };
  /** The agreements an agent hears while it takes a few steps: a prompt, a push and what follows it. */
  const stepsOf = (agent: Pick<AgreementAgent, "hook">) => {
    const shell = { tool_name: "Bash", tool_input: { command: "ls" } };
    return [
      agent.hook("UserPromptSubmit", { prompt: "go on" }),
      agent.hook("PreToolUse", push),
      agent.hook("PreToolUse", shell),
      agent.hook("PostToolUse", shell),
    ].flatMap(textsOf);
  };

  // Both computers read agreements from this Hub, and the pair has none yet.
  for (const computer of [ana, bob]) {
    await waitFor(
      `${computer.name}'s Peer reads agreements from this Hub`,
      async () => (await computer.state())?.hubSupport === "supported",
    );
  }
  check((await kept()).length === 0, "the Hub holds no agreement between KRK-1 and KRK-2 yet");

  // 1. Bob's agent asks Ana's, which idles on KRK-1; she answers; he settles it with words.
  settlers.ana.start();
  settlers.bob.start();
  await waitFor("the Hub knows both agents on their tasks", async () => {
    const sessions = await input.sessions();
    return (
      sessions.some((one) => one.id === ids.settlers.ana && one.task === tasks.ana.id) &&
      sessions.some((one) => one.id === ids.settlers.bob && one.task === tasks.bob.id)
    );
  });
  const wait = settlers.ana.idle();
  await waitFor("Ana's agent registered its wait for a note", () =>
    ana.events().some((entry) => entry.event === "wait" && entry.session === ids.settlers.ana),
  );
  const asked = settlers.bob.peer("ask", tasks.ana.key, QUESTION);
  told(`${settlers.bob.name} (peer ask ${tasks.ana.key})`, asked);
  check(
    settlers.bob.peerStatus === 0 && asked.startsWith(`Asked the agents on ${tasks.ana.key} · `),
    "Bob's agent on KRK-2 asks the agents on KRK-1, and the Hub opens their overlap",
  );
  const woke = await Promise.race([wait, pause(15_000).then(() => "(timed out)")]);
  told(`${settlers.ana.name} (woken up)`, woke);
  check(
    woke?.includes(`asks the agents on your task ${tasks.ana.key}`) === true &&
      woke.includes(QUESTION),
    "Ana's idle agent is woken with the question",
  );
  const noted = settlers.ana.peer("note", ANSWER);
  check(noted.startsWith("Noted on overlap"), "and answers it with a note");
  let answered = "";
  for (let step = 0; step < 80 && !answered.includes(ANSWER); step += 1) {
    answered = textsOf(settlers.bob.hook("UserPromptSubmit", { prompt: "continue" })).join("\n\n");
    if (!answered.includes(ANSWER)) await pause(250);
  }
  told(`${settlers.bob.name} (next step)`, answered || null);
  check(answered.includes(ANSWER), "Bob's agent hears the answer at its next step");
  const settled = settlers.bob.peer("resolve", WORDS);
  told(`${settlers.bob.name} (peer resolve)`, settled);
  check(settlers.bob.peerStatus === 0, "Bob's agent settles the overlap with words: peer resolve");

  // The Hub kept the words in the transaction of the settle: they are there as the command ends.
  const [agreement, ...others] = await kept();
  check(
    agreement !== undefined &&
      others.length === 0 &&
      agreement.project === "lab" &&
      agreement.tasks.join() === [...pair].sort().join() &&
      agreement.words === WORDS &&
      agreement.state === "open" &&
      agreement.landed.length === 0 &&
      agreement.closed === undefined,
    "the Hub holds the words as the open agreement of KRK-1 and KRK-2 as soon as the settle was answered",
  );
  const sides = agreement?.sides ?? [];
  check(
    agreement?.by.email === people.bob &&
      agreement.by.task === tasks.bob.id &&
      sides.length === 2 &&
      sides.some(
        (side) =>
          side.session === ids.settlers.ana &&
          side.email === people.ana &&
          side.task === tasks.ana.id,
      ) &&
      sides.some(
        (side) =>
          side.session === ids.settlers.bob &&
          side.email === people.bob &&
          side.task === tasks.bob.id,
      ) &&
      new Set(sides.map((side) => side.environment)).size === 2 &&
      sides.every((side) => side.environment !== ""),
    "it names Bob, and his task, as the one who settled it and both sessions as the ones that took part",
  );
  check(
    agreement !== undefined &&
      unknownFields(agreement as unknown as Record<string, unknown>).length === 0,
    "an agreement at the Hub holds ids, tasks, words, who settled it and its state, nothing else",
  );
  const id = agreement?.id ?? "";
  // The ping brings it to both computers within moments.
  await waitFor(
    "both Peers hold the agreement from the Hub's ping",
    async () =>
      (rowOf(await ana.state(), tasks.ana.id)?.open ?? 0) >= 1 &&
      (rowOf(await bob.state(), tasks.bob.id)?.open ?? 0) >= 1,
  );

  // 2. The sessions that took part are never told it.
  for (const agent of [settlers.ana, settlers.bob]) {
    const said = stepsOf(agent);
    check(
      !said.some(mentionsAgreement),
      `${agent.name}, which took part, is not told the agreement at a prompt, a push or any step`,
    );
  }
  check(
    agreementsGiven(ana.events(), [ids.settlers.ana]).told.count === 0 &&
      agreementsGiven(bob.events(), [ids.settlers.bob]).told.count === 0,
    "and the logs of both computers count no agreement told to either of them",
  );
  for (const agent of [settlers.ana, settlers.bob]) agent.hook("SessionEnd", { reason: "exit" });

  // 3. A new session on KRK-1 pushes as its first step: it is stopped once, with the agreement in the reason.
  const started = later.claude.start();
  told(`${later.claude.name} (its start, on KRK-1)`, started.told);
  const stopped = later.claude.hook("PreToolUse", push);
  const reason = stopped?.hookSpecificOutput?.permissionDecisionReason;
  told(`${later.claude.name} (git push)`, reason);
  const blocks = agreementBlocks(reason === undefined ? [] : [reason]);
  const said = blocks[0] === undefined ? undefined : parseAgreement(blocks[0]);
  check(
    stopped?.hookSpecificOutput?.permissionDecision === "deny" &&
      reason?.split("\n")[0] === STOP_HEAD &&
      reason.split("\n").at(-1) === STOP_TAIL,
    "the push does not run: the stop says a message from a teammate waits, and to run the push again",
  );
  check(
    blocks.length === 1 &&
      said?.tasks.join() === tasks.bob.key &&
      said.state === "open" &&
      said.who === "Bob’s agent on KRK-2" &&
      said.words === WORDS &&
      reason?.includes(`<shared-context>\n- ${WORDS}\n</shared-context>`) === true,
    "the agent reads the agreement in the stop reason as fenced teammate text, with KRK-2, Bob and the words",
  );
  check(
    blocks[0] !== undefined && blocks[0].length <= NOTICE_LIMIT,
    `and what Peer added stays within ${NOTICE_LIMIT} characters (${blocks[0]?.length ?? 0})`,
  );
  const again = later.claude.hook("PreToolUse", push);
  check(runs(again), "the same push again runs");
  check(
    !stepsOf(later.claude).some(mentionsAgreement),
    "and the agreement is not told again, at a prompt, a push or any step",
  );
  const stops = ana
    .events()
    .filter((entry) => entry.event === "landing.stopped" && entry.session === ids.later.claude);
  const toldLines = ana
    .events()
    .filter((entry) => entry.event === "agreements.told" && entry.session === ids.later.claude);
  check(
    stops.length === 1 &&
      stops[0]?.messages === 1 &&
      stops[0].chars === reason?.length &&
      toldLines.length === 1 &&
      toldLines[0]?.chars === blocks[0]?.length,
    "the log has one stop and one telling: sizes only, the agreement's and the stop's",
  );
  const listed = later.claude.peer("agreements");
  told(`${later.claude.name} (peer agreements)`, listed);
  check(
    later.claude.peerStatus === 0 &&
      listed.startsWith("Agreements kept for KRK-1: 1 open or due") &&
      agreementWords([listed]).join() === WORDS,
    "peer agreements lists the task's agreement with its words fenced as teammate text",
  );

  // 3b. A Codex session on KRK-1 is stopped as Claude Code's is.
  later.codex.hook("SessionStart", { source: "startup" });
  const codexStopped = later.codex.hook("PreToolUse", {
    tool_name: "Bash",
    tool_use_id: "call-push",
    tool_input: { command: "git push origin HEAD" },
  });
  const codexReason = codexStopped?.hookSpecificOutput?.permissionDecisionReason;
  told(`${later.codex.name} (git push)`, codexReason);
  check(
    codexStopped?.hookSpecificOutput?.permissionDecision === "deny" &&
      parseAgreement(agreementBlocks(codexReason === undefined ? [] : [codexReason])[0] ?? "")
        ?.words === WORDS,
    "a Codex session on KRK-1 is stopped at its first push with the same agreement",
  );
  check(
    runs(
      later.codex.hook("PreToolUse", {
        tool_name: "Bash",
        tool_use_id: "call-push-again",
        tool_input: { command: "git push origin HEAD" },
      }),
    ),
    "and its push again runs",
  );

  // 4. With PEER_AGREEMENTS=off on a computer, nothing is told or stopped there.
  const plugin = await off.plugin();
  check(
    plugin?.active === false &&
      plugin.enabled === false &&
      plugin.locked === true &&
      plugin.reason === "PEER_AGREEMENTS=off",
    "a computer started with PEER_AGREEMENTS=off lists the plugin as off, locked by the switch that did it",
  );
  check((await off.state()) === undefined, "and its status carries no agreements");
  const offStart = quiet.start();
  const offSteps = [
    ...stepsOf(quiet),
    ...(offStart.told === undefined ? [] : [offStart.told]),
    ...textsOf(quiet.hook("PreToolUse", push)),
  ];
  check(
    !offSteps.some(mentionsAgreement) &&
      runs(quiet.hook("PreToolUse", push)) &&
      (await kept()).length === 1,
    "a session on KRK-1 there is told nothing and not stopped, while the Hub holds the agreement",
  );
  const refused = quiet.peer("agreements");
  told(`${quiet.name} (peer agreements)`, refused);
  check(
    quiet.peerStatus === 3 && refused.includes(TURNED_OFF),
    "peer agreements is refused there and says agreements are turned off",
  );
  await pause(500);
  check(
    off.events().every((entry) => !entry.event.startsWith("agreements.")) &&
      agreementsGiven(off.events(), [ids.quiet]).stops.count === 0,
    "that computer's log counts no agreement told, due or closed, and no stop",
  );
  // A session of the computer that has agreements on hears it as well, here and now.
  check(
    countOf(heardBy(ana, ids.later.claude), WORDS) === 1 &&
      countOf(heardBy(ana, ids.later.codex), WORDS) === 1 &&
      heardBy(bob, ids.settlers.bob).every((text) => !mentionsAgreement(text)),
    "from the logs: each later session on KRK-1 heard it once, and the session that settled it never did",
  );
  for (const agent of [later.claude, quiet]) agent.hook("SessionEnd", { reason: "exit" });
  later.codex.hook("SessionEnd", { reason: "other" });

  // 5. KRK-1 is marked done while nobody works on KRK-2: the agreement falls due for KRK-2 and Bob sees it.
  await waitFor("no agent works on KRK-2: Bob's agent's session has ended at the Hub", async () =>
    (await input.sessions()).every((one) => one.task !== tasks.bob.id),
  );
  await input.markDone(tasks.ana.id);
  const [due] = await kept();
  check(
    due?.state === "due" &&
      due.dueFor === tasks.bob.id &&
      due.landed.join() === tasks.ana.id &&
      due.closed === undefined,
    "the Hub says the agreement is due for KRK-2: KRK-1 landed",
  );
  await waitFor("Bob's Peer lists the agreement as due for him", async () =>
    ((await bob.state())?.workspaces[0]?.dueForMe ?? []).some((one) => one.id === id),
  );
  const slice = (await bob.state())?.workspaces[0];
  check(
    slice?.dueForMe.some((one) => one.project === "lab" && one.id === id) === true &&
      slice.due?.some(
        (one) => one.id === id && one.dueFor === tasks.bob.id && one.landed === tasks.ana.id,
      ) === true &&
      slice.tasks?.find((row) => row.task === tasks.bob.id)?.due === 1,
    "his status shows it in dueForMe, with the task it is due for and the one that landed",
  );
  check(
    ((await ana.state())?.workspaces[0]?.dueForMe ?? []).every((one) => one.id !== id),
    "and Ana's does not: it fell due for the task her agent did not work on",
  );

  // 5b. Bob presses Handled: the agreement closes as his, and leaves his status.
  const closed = await bob.close(id);
  check(
    closed.agreement.state === "closed" &&
      closed.agreement.closed?.why === "handled" &&
      closed.agreement.closed.by === people.bob,
    "Handled closes the agreement as handled by Bob",
  );
  const [after] = await kept();
  check(
    after?.state === "closed" && after.closed?.why === "handled" && after.closed.by === people.bob,
    "the Hub says it is closed, handled by Bob",
  );
  await waitFor("it left Bob's status", async () =>
    ((await bob.state())?.workspaces[0]?.dueForMe ?? []).every((one) => one.id !== id),
  );

  // 6. The logs count it, and the content-free one holds no words, task or path.
  await pause(500);
  const happened = (
    computer: AgreementComputer,
    event: string,
    fields: Record<string, unknown> = {},
  ) =>
    computer
      .events()
      .filter(
        (entry) =>
          entry.event === event &&
          Object.entries(fields).every(([key, value]) => entry[key] === value),
      ).length;
  check(
    happened(bob, "agreements.due") === 1 &&
      happened(bob, "agreements.closed", { why: "handled" }) === 1,
    "Bob's log counts the agreement falling due once, and closing as handled once",
  );
  const secrets = [
    "orderTotal",
    "loyalty",
    "euros",
    "src/",
    "KRK-1",
    "KRK-2",
    "krk-1",
    "krk-2",
    tasks.ana.id,
    tasks.bob.id,
    id,
  ];
  const lines = [...ana.metrics(), ...bob.metrics()];
  check(
    lines.some((line) => line.includes('"event":"agreements.told"')) &&
      lines.some((line) => line.includes('"event":"landing.stopped"')) &&
      leaks(lines, secrets).length === 0,
    "no agreement or landing line of either computer's coordination log names the words, a task or a path",
  );
  say(
    "agreements",
    "kept at the settle, told once to the sessions that were not there, due, handled",
  );
}

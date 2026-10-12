// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off globalConsole:off preferSchemaOverJson:off - host-side lab harness: reads the logs of computers it did not start itself.
/**
 * The lab's plans step: what an agent hears when it declares a plan with `peer plan`, and what the
 * other side hears, checked against the Hub's own view and the computers' coordination logs, with
 * the words the design canvas gives (4b, "peer plan and what agents hear").
 *
 *   Ana's provider declares what it changes and the contract it provides, and goes idle. Bob's
 *   consumer declares what it uses: its answer lists the relation with Ana's contract line as
 *   fenced teammate text. Ana's agent is not woken; it hears the relation once at its next step,
 *   and Bob's agent hears Ana's contract line again only when it changes, and once more after a
 *   compaction. A session that declared nothing but changed a file the consumer uses is an
 *   observed relation, heard once by both sides. Withdrawing ends a plan and its relations;
 *   turning plans off for a computer withdraws its plans; the coordination logs hold sizes and
 *   counts, never a path, a name, a contract or a task.
 *
 * It takes sessions that already run (the lab owns the processes), and reads what a session was
 * told from its computer's log as well, whichever hook carried it.
 */
import * as NodeFS from "node:fs";

import { toldTexts, type HookOut, type LabEvent } from "./told.ts";

/** What the step asks of a simulated agent: the lab's `agent()`. */
export interface PlanAgent {
  readonly name: string;
  readonly start: () => { readonly told: string | undefined };
  readonly peer: (...args: string[]) => string;
  readonly peerStatus: number;
  readonly hook: (event: string, extra?: Record<string, unknown>) => HookOut;
  readonly edit: (event: "PreToolUse" | "PostToolUse", path: string) => HookOut;
  readonly idle: () => Promise<string | null>;
}

/** The plugin's status field on a computer, as its Peer says it. */
export interface PlansState {
  readonly hubSupport: string;
  readonly counts: ReadonlyArray<{
    readonly task: string;
    readonly plans: number;
    readonly relations: number;
  }>;
}

/** A computer as the step reads it: its Peer's status and view, its plugin switch, and its logs. */
export interface PlanComputer {
  readonly name: string;
  readonly state: () => Promise<PlansState | undefined>;
  /** The view a person's task page reads (`peer.plans.list`): read from the Hub now. */
  readonly list: () => Promise<{
    readonly plans: ReadonlyArray<{ readonly session: string; readonly live: boolean }>;
    readonly relations: ReadonlyArray<unknown>;
  }>;
  readonly setEnabled: (enabled: boolean) => Promise<void>;
  /** The debug log: what each hook and command answered. */
  readonly events: () => ReadonlyArray<LabEvent>;
  /** The coordination log as it is kept by default, without texts, paths or answers. */
  readonly metrics: () => ReadonlyArray<string>;
}

/** What the Hub says of a project's plans, as it sends it. */
export interface HubPlans {
  readonly plans: ReadonlyArray<Record<string, unknown>>;
  readonly relations: ReadonlyArray<Record<string, any>>;
}

export interface PlansLabInput {
  /** Ana's agent on PF1, which declares what it changes and provides. */
  readonly provider: PlanAgent;
  /** Ana's other session on PF1, which declares nothing and edits a file. */
  readonly editor: PlanAgent;
  /** A session that starts on Ana's computer while plans are off there. */
  readonly latecomer: PlanAgent;
  /** Bob's agent on PF2, which declares what it uses. */
  readonly consumer: PlanAgent;
  readonly ana: PlanComputer;
  readonly bob: PlanComputer;
  readonly hub: () => Promise<HubPlans>;
  /** `peer <args>` typed in a terminal in the checkout: no agent session. */
  readonly terminal: (...args: string[]) => { readonly status: number; readonly out: string };
  readonly check: (ok: unknown, what: string) => void;
  readonly told: (who: string, text: string | null | undefined) => void;
  readonly pause: (milliseconds: number) => Promise<void>;
  readonly say: (label: string, text: string) => void;
}

// ---- the design canvas's words (4b) ----

/** The line every session start carries. */
export const START_WORDS =
  'Before your first edit run peer plan --change <path[#symbol]> --uses <path#symbol> --provides "<symbol> (<path>): <contract>"; it shows whose work meets yours.';
export const WITHDRAWN_WORDS = "Plan withdrawn. Its relations are gone from every view.";
export const NOTHING_MEETS = "Nothing in the project meets your plan.";
export const NOTHING_NEW = "Nothing new meets your plan.";
export const CONTRACT_LEAD = "Their contract (teammate text):";
/** The most characters an answer to `peer plan` takes, a notice to the other side, and the start line. */
export const ANSWER_LIMIT = 1500;
export const NOTICE_LIMIT = 400;
export const START_LIMIT = 200;

export type RelationKind = "uses-their-change" | "changes-their-use" | "same-change";

/** One relation as an answer lists it: its line, and what is written under it. */
export interface ListedRelation {
  readonly kind: RelationKind;
  /** `uncertain` and `observed`. */
  readonly marks: ReadonlyArray<string>;
  /** What it meets at: `applyTax (src/tax.ts)`, or the path alone. */
  readonly what: string;
  /** The line under it that names the other work. */
  readonly detail: string;
  /** The other side's contract as it was fenced, `<what>: <contract>`. */
  readonly contract: string | undefined;
  /** The task `peer ask` names. */
  readonly ask: string | undefined;
}

export interface ParsedAnswer {
  readonly header: string;
  readonly relations: ReadonlyArray<ListedRelation>;
  /** How many more `peer plan` shows. */
  readonly more: number;
  /** The other lines: what came of the plan (nothing met it), and what the code index made of the names. */
  readonly notes: ReadonlyArray<string>;
}

const RELATION = /^(uses-their-change|changes-their-use|same-change)(?: \(([^)]*)\))? {2}(\S.*)$/;

/**
 * An answer to `peer plan` read as the design shows it: a header, what came of it, the relations (a
 * line, what the other work does, its contract fenced as teammate text, `peer ask <task>`), how many
 * more there are, and the notes on what the code index made of the names. A line that is none of
 * the relations is a note, so the answer to a plan that meets nothing keeps its words there too.
 */
export function parseAnswer(text: string): ParsedAnswer {
  const lines = text.split("\n");
  const relations: Array<{ start: RegExpExecArray; body: string[] }> = [];
  const notes: string[] = [];
  let more = 0;
  let inside = false;
  for (const line of lines.slice(1)) {
    const start = RELATION.exec(line);
    const left = /^(\d+) more: peer plan$/.exec(line);
    if (start !== null) {
      relations.push({ start, body: [] });
      inside = true;
    } else if (left !== null) more = Number(left[1]);
    else if (line === "") inside = false;
    else if (inside && line.startsWith("  ")) relations.at(-1)?.body.push(line);
    else notes.push(line);
  }
  return {
    header: lines[0] ?? "",
    relations: relations.map(({ start, body }) => {
      const fence = body.findIndex((line) => line.trim() === "<shared-context>");
      const end = body.findIndex((line) => line.trim() === "</shared-context>");
      const quoted = fence >= 0 && end > fence ? body[fence + 1]?.trim() : undefined;
      return {
        kind: start[1] as RelationKind,
        marks: (start[2] ?? "").split(", ").filter((mark) => mark !== ""),
        what: start[3] ?? "",
        detail: (body[0] ?? "").trim(),
        contract: quoted?.startsWith("- ") ? quoted.slice(2) : undefined,
        ask: /peer ask (\S+)\s*$/.exec(body.at(-1) ?? "")?.[1],
      };
    }),
    more,
    notes,
  };
}

/**
 * The plan notices in what a session was told: the paragraphs that say another work plans to change
 * or use what it does, or that a session already changed it.
 */
export const planNotices = (texts: ReadonlyArray<string>): ReadonlyArray<string> =>
  texts
    .flatMap((text) => text.split("\n\n"))
    .filter((paragraph) =>
      /^\[Peer\] .*(plans to (change|use)|also plans to change|session already changed)/s.test(
        paragraph,
      ),
    );

/** The events of a log for one session, whose id is as its hooks log it (`claude:<id>`). */
const ofSession = (events: ReadonlyArray<LabEvent>, id: string) =>
  events.filter((entry) => entry.session === `claude:${id}` || entry.session === id);

/**
 * What the content-free coordination log says of plans that it should not: each plan line that names
 * one of `secrets` (a path, a symbol, a contract, a task), with what it names.
 */
export function leaks(lines: ReadonlyArray<string>, secrets: ReadonlyArray<string>) {
  return lines
    .filter((line) => line.includes('"event":"plans.'))
    .flatMap((line) =>
      secrets.filter((secret) => line.includes(secret)).map((secret) => ({ line, secret })),
    );
}

/** A plan's JSON as the Hub sends it holds these and nothing else: no code, diff, line number, prompt or prose. */
export const PLAN_FIELDS = [
  "project",
  "session",
  "email",
  "environment",
  "task",
  "label",
  "seq",
  "version",
  "changes",
  "maybes",
  "uses",
  "provides",
  "declaredAt",
  "updatedAt",
  "live",
] as const;

/** Whether a log line is `event` with every one of `fields`. */
const logged = (entry: LabEvent, event: string, fields: Readonly<Record<string, unknown>> = {}) =>
  entry.event === event && Object.entries(fields).every(([key, value]) => entry[key] === value);

const countOf = (texts: ReadonlyArray<string>, part: string) =>
  texts.filter((text) => text.includes(part)).length;

export async function plansLab(input: PlansLabInput) {
  const { provider, editor, latecomer, consumer, ana, bob, check, pause, say, told } = input;
  const money = "formatPrice (src/money.ts)";
  const first = "takes cents, returns a string with the currency";
  const second = "takes cents, returns the currency symbol and the amount";
  const providerId = "lab-plan-ana";
  const consumerId = "lab-plan-bob";
  const editorId = "lab-plan-ana-edit";
  const heardBy = (computer: PlanComputer, id: string) =>
    toldTexts(ofSession(computer.events(), id));
  const noticesOf = (out: HookOut) =>
    planNotices([out?.hookSpecificOutput?.additionalContext ?? ""]);

  /** Waits until `ready`, looking every 250 ms for up to 20 s. */
  const waitFor = async (what: string, ready: () => Promise<boolean> | boolean) => {
    let ok = false;
    for (let attempt = 0; attempt < 80 && !ok; attempt += 1) {
      ok = await ready();
      if (!ok) await pause(250);
    }
    check(ok, what);
  };
  /**
   * The plan notices an agent hears at its next step once its Peer has them: a step is a prompt, so
   * the agent takes one now and again until its Peer has read what the Hub said.
   */
  const hearsNext = async (agent: PlanAgent) => {
    for (let step = 0; step < 80; step += 1) {
      const heard = noticesOf(agent.hook("UserPromptSubmit", { prompt: "continue" }));
      if (heard.length > 0) return heard;
      await pause(250);
    }
    return [];
  };
  /** What a few more steps say of plans: nothing, once an agent was told. A step is a prompt or a shell command. */
  const quiet = (agent: PlanAgent) => {
    const shell = { tool_name: "Bash", tool_input: { command: "ls" } };
    return (
      [
        agent.hook("UserPromptSubmit", { prompt: "go on" }),
        agent.hook("PreToolUse", shell),
        agent.hook("PostToolUse", shell),
      ].flatMap(noticesOf).length === 0
    );
  };
  /** The relations a computer's Peer has read, by the task they name. */
  const relationsAt = async (computer: PlanComputer, task: string) =>
    (await computer.state())?.counts.find((row) => row.task === task)?.relations ?? 0;
  const wakes = () =>
    ana.events().filter((entry) => logged(entry, "wake", { session: `claude:${providerId}` }))
      .length;

  // Both computers read plans from this Hub.
  for (const computer of [ana, bob]) {
    await waitFor(
      `${computer.name}'s Peer reads plans from this Hub`,
      async () => (await computer.state())?.hubSupport === "supported",
    );
  }
  const empty = await input.hub();
  check(empty.plans.length === 0 && empty.relations.length === 0, "no plan is declared yet");

  // 1. The nudge, and the forms an agent gets wrong.
  const start = provider.start();
  told(`${provider.name} (on PF1)`, start.told);
  check(
    start.told?.includes(START_WORDS) === true && START_WORDS.length <= START_LIMIT,
    `a session starts with the line that asks for a plan, of at most ${START_LIMIT} characters`,
  );
  const none = provider.peer("plan");
  check(
    provider.peerStatus === 0 &&
      none.startsWith("This session has no plan yet.") &&
      none.includes("peer plan --withdraw") &&
      none.includes("<item> = <path> | <dir>/ | <path>#<symbol>"),
    "an agent without a plan is shown the form of one",
  );
  const outside = provider.peer("plan", "--change", "../other/a.ts");
  check(
    provider.peerStatus === 2 &&
      outside.startsWith("peer: usage: ../other/a.ts is outside the repository") &&
      outside.includes("<item> = <path> | <dir>/ | <path>#<symbol>"),
    "a path outside the repository is a usage error that names it and shows the form",
  );
  const pathless = provider.peer("plan", "--provides", "Fee.refundCents: integer cents");
  check(
    provider.peerStatus === 2 &&
      pathless.includes('a contract names its path: "<symbol> (<path>): <contract>"'),
    "a contract line without a path is a usage error that shows the form",
  );
  const stranger = input.terminal("plan", "--change", "src/a.ts");
  check(
    stranger.status === 3 && stranger.out.startsWith("peer: refused:"),
    "a terminal without an agent session is refused a declaration",
  );
  check((await input.hub()).plans.length === 0, "none of those recorded anything");

  // 2. Ana's agent declares what it changes and the contract it provides.
  const declared = provider.peer(
    "plan",
    "--change",
    "src/money.ts#formatPrice",
    "--provides",
    `${money}: ${first}`,
  );
  told(`${provider.name} (peer plan)`, declared);
  const anaAnswer = parseAnswer(declared);
  check(
    provider.peerStatus === 0 &&
      anaAnswer.header === "Plan v1 recorded: 1 change, 1 contract." &&
      declared.includes(NOTHING_MEETS) &&
      declared.length <= ANSWER_LIMIT,
    "a declaration is answered with the plan's version and counts, and says nothing meets it",
  );
  check(
    !declared.includes("Kept as written") && !declared.includes("No usable code index"),
    "a name the code index lists is kept as the index spells it, with nothing to add",
  );
  const stored = await input.hub();
  const own = stored.plans.find((plan) => plan.session === `claude:${providerId}`);
  check(
    own?.live === true &&
      own.version === 1 &&
      JSON.stringify(own.provides) ===
        JSON.stringify([{ name: "formatPrice", path: "src/money.ts", contract: first }]),
    "the Hub holds the plan live, with its contract line",
  );
  check(
    stored.plans.every((plan) =>
      Object.keys(plan).every((key) => (PLAN_FIELDS as readonly string[]).includes(key)),
    ),
    "a plan at the Hub holds paths, names, contract lines and ids, nothing else",
  );

  // 3. Ana's agent goes idle; Bob's agent declares what it uses.
  const wait = provider.idle();
  let waitEnded = false;
  void wait.then(() => {
    waitEnded = true;
  });
  await waitFor("Ana's agent registered its wait for a note", () =>
    ana.events().some((entry) => logged(entry, "wait", { session: `claude:${providerId}` })),
  );
  const wakesBefore = wakes();
  told(`${consumer.name} (on PF2)`, consumer.start().told);
  await pause(1500);
  const answer = consumer.peer(
    "plan",
    "--change",
    "src/receipt.ts#receiptLine",
    "--uses",
    "src/money.ts#formatPrice",
  );
  told(`${consumer.name} (peer plan)`, answer);
  const bobAnswer = parseAnswer(answer);
  const use = bobAnswer.relations.find((relation) => relation.kind === "uses-their-change");
  check(
    consumer.peerStatus === 0 &&
      bobAnswer.header === "Plan v1 recorded: 1 change, 1 use." &&
      bobAnswer.relations.length === 1 &&
      use?.what === money &&
      use.marks.length === 0,
    "the answer lists the relation: Bob's use meets Ana's change, certain and declared",
  );
  check(
    use?.detail.startsWith("PF1 · Ana’s agent plans to change it.") === true &&
      use.detail.endsWith(CONTRACT_LEAD) &&
      use.contract === `${money}: ${first}` &&
      use.ask === "PF1",
    "it names Ana's work, gives her contract line as fenced teammate text, and says peer ask PF1",
  );
  check(
    answer.length <= ANSWER_LIMIT,
    `the answer stays within ${ANSWER_LIMIT} characters (${answer.length})`,
  );
  const joined = await input.hub();
  const relation = joined.relations.find((one) => one.kind === "use");
  check(
    joined.relations.length === 1 &&
      relation?.a.session === `claude:${consumerId}` &&
      relation.b.session === `claude:${providerId}` &&
      relation.contract === first &&
      relation.certain === true &&
      relation.observed === false,
    "the Hub holds one use: Bob's session uses what Ana's session changes, with her contract",
  );

  // 4. The idle changer is not woken, and hears the relation once at its next step.
  await waitFor("Ana's Peer read the relation", async () => (await relationsAt(ana, "pf1")) >= 1);
  await pause(1500);
  check(wakes() === wakesBefore && !waitEnded, "Ana's idle agent is not woken for the relation");
  const heardOnce = await hearsNext(provider);
  told(`${provider.name} (next step)`, heardOnce.join("\n\n") || null);
  check(
    heardOnce.length === 1 &&
      heardOnce[0]?.startsWith(
        "[Peer] PF2 · Bob’s agent plans to use formatPrice (src/money.ts), which your plan changes.",
      ) === true &&
      heardOnce[0].includes(
        'If its contract changes, update your contract line: peer plan --amend --provides "formatPrice (src/money.ts): <contract>".',
      ) &&
      heardOnce[0].length <= NOTICE_LIMIT,
    `Ana's agent hears at its next step that PF2 plans to use it, in at most ${NOTICE_LIMIT} characters, and how to update its contract line`,
  );
  check(
    quiet(provider),
    "and hears nothing more of it: not at a prompt, not before or after an edit",
  );
  check(
    quiet(consumer),
    "Bob's agent, which was told in its answer, is not told again at its next step",
  );
  const status = provider.peer("status");
  check(
    /Plan v1: 1 change, 1 contract; 1 relation\. peer plan shows them\./.test(status),
    "peer status ends with a line about the agent's plan",
  );

  // 5. A changed contract line is told again, once.
  const amended = provider.peer("plan", "--amend", "--provides", `${money}: ${second}`);
  told(`${provider.name} (peer plan --amend)`, amended);
  check(
    provider.peerStatus === 0 && amended.startsWith("Plan v2 recorded: added 1 contract."),
    "an amendment says what it added",
  );
  const again = await hearsNext(consumer);
  told(`${consumer.name} (next step)`, again.join("\n\n") || null);
  check(
    again.length === 1 &&
      again[0]?.startsWith(
        "[Peer] PF1 · Ana’s agent plans to change formatPrice (src/money.ts), which your plan uses.",
      ) === true &&
      again[0].includes(CONTRACT_LEAD) &&
      again[0].includes(`- ${money}: ${second}`) &&
      again[0].includes("peer ask PF1") &&
      again[0].length <= NOTICE_LIMIT,
    "Bob's agent hears again, once and within the limit, that Ana's contract line changed",
  );
  check(quiet(consumer), "and not a third time");

  // 6. After a compaction an agent hears its open relations once more.
  consumer.hook("SessionStart", { source: "compact" });
  const recalled = await hearsNext(consumer);
  check(
    recalled.length === 1 && recalled[0]?.includes(`- ${money}: ${second}`) === true,
    "after its context is compacted, Bob's agent hears the open relation once more",
  );
  check(quiet(consumer), "and then not again");

  // 7. A session that declared nothing but changed a file Bob uses: an observed relation.
  told(`${editor.name} (on PF1, no plan)`, editor.start().told);
  const used = consumer.peer("plan", "--amend", "--uses", "src/tax.ts");
  told(`${consumer.name} (peer plan --amend)`, used);
  check(
    consumer.peerStatus === 0 &&
      used.startsWith("Plan v2 recorded: added 1 use.") &&
      used.includes(NOTHING_NEW),
    "Bob's agent adds a use of a file nobody changed: nothing new meets the plan",
  );
  await pause(1500);
  editor.edit("PreToolUse", "src/tax.ts");
  editor.edit("PostToolUse", "src/tax.ts");
  await waitFor("the Hub holds the observed relation", async () =>
    (await input.hub()).relations.some((one) => one.item?.path === "src/tax.ts" && one.observed),
  );
  const observed = (await input.hub()).relations.find((one) => one.item?.path === "src/tax.ts");
  check(
    observed?.kind === "use" &&
      observed.a.session === `claude:${consumerId}` &&
      observed.b.session === `claude:${editorId}` &&
      observed.contract === undefined &&
      observed.item.name === undefined,
    "it is a use of the file, by Bob's session, of what Ana's other session changed, with no plan behind it",
  );
  const bobHears = await hearsNext(consumer);
  told(`${consumer.name} (next step)`, bobHears.join("\n\n") || null);
  check(
    bobHears.length === 1 &&
      bobHears[0]?.startsWith(
        "[Peer] PF1’s session already changed src/tax.ts, which your plan uses.",
      ) === true &&
      bobHears[0].length <= NOTICE_LIMIT,
    "Bob's agent hears once, at its next step, that a session already changed the file it uses",
  );
  const editorHears = await hearsNext(editor);
  told(`${editor.name} (next step)`, editorHears.join("\n\n") || null);
  check(
    editorHears.length === 1 &&
      editorHears[0]?.startsWith(
        "[Peer] PF2 · Bob’s agent plans to use src/tax.ts, which your session already changed.",
      ) === true,
    "the session that made the change hears once that PF2 plans to use it, though it has no plan",
  );
  check(quiet(editor) && quiet(consumer), "and neither hears it again");

  // 8. A name the index does not know is kept as written, and listed.
  const typo = consumer.peer("plan", "--amend", "--uses", "src/receipt.ts#receiptLines");
  told(`${consumer.name} (peer plan --amend)`, typo);
  const kept = parseAnswer(typo);
  check(
    kept.header === "Plan v3 recorded: added 1 use." &&
      kept.notes.includes(
        "Kept as written: receiptLines (src/receipt.ts). The index does not know it.",
      ) &&
      kept.notes.includes("It meets other plans by exact name and by path."),
    "a name the code index does not know stays as written and the answer says so",
  );

  // 9. What people read: the same plans and relations through each computer.
  for (const computer of [ana, bob]) {
    const view = await computer.list();
    check(
      view.plans.filter((plan) => plan.live).length === 2 && view.relations.length === 2,
      `${computer.name}'s Peer shows both live plans and both relations`,
    );
  }
  const people = input.terminal("plan");
  told("a person's terminal (peer plan)", people.out);
  check(
    people.status === 0 &&
      people.out.startsWith("Live plans in lab (read-only):") &&
      people.out.includes("PF1 · Ana · Plan v2 · 1 change, 1 contract") &&
      people.out.includes("PF2 · Bob · Plan v3 · 1 change, 3 uses"),
    "a person's terminal lists the project's live plans and records nothing",
  );

  // 10. The coordination logs hold sizes and counts, never what a plan names.
  await pause(500);
  const anaDeclared = ana
    .events()
    .filter((entry) => logged(entry, "plans.declared", { session: `claude:${providerId}` }));
  check(
    anaDeclared.length >= 2 &&
      anaDeclared[0]?.version === 1 &&
      anaDeclared[0].changes === 1 &&
      anaDeclared[0].provides === 1 &&
      anaDeclared[0].relations === 0 &&
      anaDeclared[0].chars === declared.length,
    "Ana's log counts the declaration's items and relations and the size of the answer the agent read",
  );
  const bobDeclared = bob
    .events()
    .find((entry) => logged(entry, "plans.declared", { session: `claude:${consumerId}` }));
  check(
    bobDeclared?.uses === 1 && bobDeclared.relations === 1 && bobDeclared.chars === answer.length,
    "Bob's log counts one relation and the size of the answer that carried it",
  );
  const noticesTold = [
    ...ana.events().filter((entry) => logged(entry, "plans.told")),
    ...bob.events().filter((entry) => logged(entry, "plans.told")),
  ];
  check(
    noticesTold.length === 5 &&
      noticesTold.every((entry) => typeof entry.chars === "number" && entry.chars <= NOTICE_LIMIT),
    "each notice a computer told is logged with its size: five, none over the limit",
  );
  const anaNotice = ana
    .events()
    .find((entry) => logged(entry, "plans.told", { session: `claude:${providerId}` }));
  check(
    anaNotice?.relations === 1 && anaNotice.chars === heardOnce[0]?.length,
    "the log's size for a notice is the size of the notice the agent heard",
  );
  const spoken = [
    ...heardBy(ana, providerId),
    ...heardBy(bob, consumerId),
    ...heardBy(ana, editorId),
  ];
  check(
    countOf(spoken, "plans to use formatPrice (src/money.ts), which your plan changes") === 1 &&
      countOf(spoken, `- ${money}: ${first}`) === 0 &&
      countOf(spoken, `- ${money}: ${second}`) === 2,
    "over the whole step, from the logs: Ana's agent was told of Bob's use once; Bob's agent heard her contract only in its answer, and her changed contract twice, the second time after the compaction",
  );
  const secrets = [
    "src/",
    "formatPrice",
    "receiptLine",
    "tax",
    "takes cents",
    "PF1",
    "PF2",
    "pf1",
    "pf2",
  ];
  const lines = [...ana.metrics(), ...bob.metrics()];
  check(
    lines.some((line) => line.includes('"event":"plans.declared"')) &&
      leaks(lines, secrets).length === 0,
    "no plan line of either computer's coordination log names a path, a symbol, a contract or a task",
  );

  // 11. Withdrawing ends a plan and its relations.
  const withdrawn = consumer.peer("plan", "--withdraw");
  told(`${consumer.name} (peer plan --withdraw)`, withdrawn);
  check(
    consumer.peerStatus === 0 && withdrawn === WITHDRAWN_WORDS,
    "withdrawing says the plan and its relations are gone",
  );
  const left = await input.hub();
  check(
    left.relations.length === 0 &&
      !left.plans.some((plan) => plan.session === `claude:${consumerId}`),
    "the Hub holds neither Bob's plan nor a relation of it",
  );
  const nothing = consumer.peer("plan", "--withdraw");
  check(
    consumer.peerStatus === 3 && nothing.includes("this session has no plan to withdraw"),
    "withdrawing without a plan is refused, and says there is none",
  );
  await waitFor(
    "Ana's Peer dropped the relations",
    async () => (await relationsAt(ana, "pf1")) === 0,
  );
  const shown = provider.peer("plan");
  check(
    provider.peerStatus === 0 &&
      shown.includes("Relations: none") &&
      shown.startsWith("Plan v2 · declared "),
    "Ana's agent sees its plan without the relation",
  );
  check(
    !input.terminal("plan").out.includes("PF2 · Bob"),
    "and a person's terminal no longer lists Bob's plan",
  );

  // 12. Turning plans off for a computer withdraws its plans.
  await ana.setEnabled(false);
  await waitFor(
    "the Hub dropped Ana's plan when she turned plans off",
    async () => !(await input.hub()).plans.some((plan) => plan.session === `claude:${providerId}`),
  );
  const refused = provider.peer("plan");
  check(
    provider.peerStatus === 3 && refused.includes("plan is turned off on this environment"),
    "with plans off, peer plan is refused and says plans are turned off here",
  );
  check(
    !(latecomer.start().told ?? "").includes(START_WORDS),
    "with plans off, a new session is not asked for a plan",
  );
  latecomer.hook("SessionEnd", { reason: "exit" });
  await ana.setEnabled(true);
  await waitFor(
    "plans work on Ana's computer again",
    async () => (await ana.state())?.hubSupport === "supported",
  );
  const back = provider.peer("plan");
  check(
    provider.peerStatus === 0 && back.startsWith("This session has no plan yet."),
    "turned on again, its sessions have no plan: it was withdrawn, not paused",
  );

  // 13. Ending a session ends its plan.
  const last = consumer.peer("plan", "--change", "src/receipt.ts#receiptLine");
  check(
    consumer.peerStatus === 0 && last.startsWith("Plan v1 recorded"),
    "a new plan is recorded after a withdrawal",
  );
  for (const agent of [consumer, editor, provider]) agent.hook("SessionEnd", { reason: "exit" });
  await waitFor("no plan outlives its session", async () => (await input.hub()).plans.length === 0);
  await Promise.race([
    wait,
    pause(5000).then(() => {
      throw new Error("Ana's idle wait did not end with her session");
    }),
  ]);
  say("plans", "declared, told once, withdrawn and ended with their sessions");
}

/** Reads a coordination log's JSON lines. */
export function readLines(path: string): ReadonlyArray<string> {
  return NodeFS.existsSync(path)
    ? NodeFS.readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line !== "")
    : [];
}

/** The content-free log next to a debug log: `coordination.debug.jsonl` is kept beside `coordination.jsonl`. */
export const metricsPathOf = (debugPath: string) => debugPath.replace(/\.debug\.jsonl$/, ".jsonl");

import {
  AgreementsRpcScopes,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  isPeerAgreementPersonReason,
  type PeerAgreement,
  type PeerAgreementsStatus,
  type PeerAgreementsView,
  type PeerHubStatus,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  CLOSE_CHOICES,
  NEEDS_OPERATE,
  agoWords,
  agreementRows,
  agreementSignals,
  agreementsExpected,
  agreementsSection,
  canChangeAgreements,
  failureWords,
  taskName,
  withAgreement,
  type AgreementsSectionInput,
} from "./agreements.logic";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const settledAt = "2026-10-13T11:18:22Z";
const NOW = Date.parse(settledAt) + 2 * DAY;
const minutesAgo = (minutes: number) => new Date(NOW - minutes * MINUTE).toISOString();

const task = (id: string, key: string | undefined, title: string) => ({
  id,
  ...(key === undefined ? {} : { key }),
  title,
});
const TASKS = [
  task("krk-1", "KRK-1", "Order rounding"),
  task("krk-2", "KRK-2", "Loyalty points"),
  task("t-3", undefined, "Receipt layout"),
];
const NAMES: Record<string, string> = { "ana@acme.test": "Ana", "bob@acme.test": "Bob" };
const personLabel = (email: string) => NAMES[email] ?? email;

/** An agreement between KRK-1 (Ana's agent) and KRK-2 (Bob's, who settled it), open until overridden. */
const agreement = (id: string, over: Partial<PeerAgreement> = {}): PeerAgreement => ({
  id,
  project: "lab",
  tasks: ["krk-1", "krk-2"],
  words: "Loyalty keeps euros; src/loyalty.js divides by 100 once KRK-1 lands",
  by: { email: "bob@acme.test", task: "krk-2" },
  settledAt,
  sides: [
    { session: "claude:abc", environment: "env-a", email: "ana@acme.test", task: "krk-1" },
    { session: "codex:def", environment: "env-b", email: "bob@acme.test", task: "krk-2" },
  ],
  state: "open",
  landed: [],
  ...over,
});
/** KRK-1 landed, so it is due for KRK-2. */
const due = (id: string, over: Partial<PeerAgreement> = {}) =>
  agreement(id, { state: "due", dueFor: "krk-2", landed: ["krk-1"], ...over });
const closed = (id: string, why: string, by?: string, over: Partial<PeerAgreement> = {}) =>
  agreement(id, {
    state: "closed",
    closed: { at: "2026-10-13T12:30:00Z", ...(by === undefined ? {} : { by }), why },
    ...over,
  });
const view = (...agreements: ReadonlyArray<PeerAgreement>): PeerAgreementsView => ({
  agreements,
  at: "2026-10-15T10:00:00Z",
});

const slice = (
  workspaces: PeerAgreementsStatus["workspaces"],
): Pick<PeerHubStatus, "agreements"> => ({
  agreements: { enabled: true, forcedOff: false, hubSupport: "supported", workspaces },
});
const LAB = { workspace: "acme", projectId: "lab", tasks: TASKS };

describe("the project's agreement signal", () => {
  const waiting = (id: string, project = "lab") => ({ project, id });
  const facts = (id: string, over: object = {}) => ({
    project: "lab",
    id,
    dueFor: "krk-2",
    landed: "krk-1",
    ...over,
  });

  it("names the two tasks of a single agreement that waits on the person", () => {
    const status = slice([
      { workspace: "acme", open: 3, dueForMe: [waiting("a1")], due: [facts("a1")] },
    ]);
    expect(agreementSignals(status, LAB)).toEqual([
      {
        id: "agreements",
        label: "Agreement due",
        icon: "doc.text",
        count: 1,
        detail: "KRK-1 landed — KRK-2 agreed to follow up",
        tone: "needs",
      },
    ]);
  });

  it("counts several without naming them", () => {
    const status = slice([
      {
        workspace: "acme",
        open: 3,
        dueForMe: [waiting("a1"), waiting("a2")],
        due: [facts("a1"), facts("a2", { dueFor: "t-3" })],
      },
    ]);
    expect(agreementSignals(status, LAB)).toMatchObject([
      { label: "Agreements due", count: 2, detail: "2 agreements wait on you", tone: "needs" },
    ]);
  });

  it("is absent while nothing waits on the person in the project", () => {
    expect(agreementSignals({}, LAB)).toEqual([]);
    expect(agreementSignals(slice([]), LAB)).toEqual([]);
    expect(agreementSignals(slice([{ workspace: "acme", open: 4, dueForMe: [] }]), LAB)).toEqual(
      [],
    );
  });

  it("counts only the agreements of its own project and workspace", () => {
    const status = slice([
      {
        workspace: "acme",
        open: 3,
        dueForMe: [waiting("a1"), waiting("elsewhere", "other")],
        due: [facts("a1"), facts("elsewhere", { project: "other" })],
      },
      { workspace: "beta", open: 1, dueForMe: [waiting("b1")], due: [facts("b1")] },
    ]);
    expect(agreementSignals(status, LAB)).toMatchObject([
      { count: 1, detail: "KRK-1 landed — KRK-2 agreed to follow up" },
    ]);
    expect(agreementSignals(status, { ...LAB, projectId: "other" })).toMatchObject([{ count: 1 }]);
    expect(agreementSignals(status, { ...LAB, projectId: "third" })).toEqual([]);
    expect(agreementSignals(status, { ...LAB, workspace: "gamma" })).toEqual([]);
  });

  it("only counts a single agreement when an older Peer sends no facts of the due ones", () => {
    const status = slice([{ workspace: "acme", open: 1, dueForMe: [waiting("a1")] }]);
    expect(agreementSignals(status, LAB)).toMatchObject([
      { count: 1, label: "Agreement due", detail: "1 agreement waits on you" },
    ]);
    // Facts of another agreement do not stand in for this one's.
    const other = slice([
      { workspace: "acme", open: 1, dueForMe: [waiting("a1")], due: [facts("a2")] },
    ]);
    expect(agreementSignals(other, LAB)).toMatchObject([{ detail: "1 agreement waits on you" }]);
  });

  it("names a task by its key, else its title, else its id", () => {
    const named = (landed: string, dueFor: string) =>
      agreementSignals(
        slice([
          {
            workspace: "acme",
            open: 1,
            dueForMe: [waiting("a1")],
            due: [facts("a1", { landed, dueFor })],
          },
        ]),
        LAB,
      )[0]?.detail;
    expect(named("t-3", "krk-2")).toBe("Receipt layout landed — KRK-2 agreed to follow up");
    expect(named("krk-1", "gone")).toBe("KRK-1 landed — gone agreed to follow up");
    expect(taskName(TASKS, "krk-1")).toBe("KRK-1");
    expect(taskName([task("x", "", "Empty key")], "x")).toBe("Empty key");
  });
});

describe("how long ago", () => {
  const ago = (ms: number) => agoWords(NOW, new Date(NOW - ms).toISOString());

  it("says just now under a minute, then minutes, hours and days", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(MINUTE - 1)).toBe("just now");
    expect(ago(MINUTE)).toBe("1 min ago");
    expect(ago(59 * MINUTE)).toBe("59 min ago");
    expect(ago(HOUR)).toBe("1 h ago");
    expect(ago(23 * HOUR + 59 * MINUTE)).toBe("23 h ago");
    expect(ago(DAY)).toBe("1 day ago");
    expect(ago(47 * HOUR)).toBe("1 day ago");
    expect(ago(2 * DAY)).toBe("2 days ago");
    expect(ago(29 * DAY)).toBe("29 days ago");
  });

  it("counts a moment in the future as just now, and has no words for one it cannot read", () => {
    expect(ago(-5 * MINUTE)).toBe("just now");
    expect(agoWords(NOW, "soon")).toBe("");
    expect(agoWords(NOW, "")).toBe("");
  });
});

describe("a task's agreement rows", () => {
  const rowsOf = (shown: PeerAgreementsView | undefined, taskId = "krk-2", over = {}) =>
    agreementRows({
      view: shown,
      projectId: "lab",
      taskId,
      tasks: TASKS,
      personLabel,
      now: NOW,
      ...over,
    });
  const all = view(
    due("due-krk-2"),
    agreement("open-t-3", {
      tasks: ["krk-2", "t-3"],
      by: { email: "ana@acme.test", task: "t-3" },
      settledAt: minutesAgo(40),
    }),
    closed("closed-handled", "handled", "ana@acme.test", {
      settledAt: "2026-10-08T09:00:00Z",
    }),
    closed("closed-replaced", "replaced", undefined, { settledAt: "2026-10-09T09:00:00Z" }),
    agreement("other-pair", { tasks: ["krk-3", "krk-4"] }),
    agreement("other-project", { project: "other" }),
  );

  it("lists the task's agreements, those not closed first, each with the other task", () => {
    expect(rowsOf(all).map((row) => [row.id, row.heading])).toEqual([
      ["open-t-3", "With Receipt layout"],
      ["due-krk-2", "With KRK-1 · Order rounding"],
      ["closed-replaced", "With KRK-1 · Order rounding"],
      ["closed-handled", "With KRK-1 · Order rounding"],
    ]);
    expect(rowsOf(all, "krk-1").map((row) => row.id)).toEqual([
      "due-krk-2",
      "closed-replaced",
      "closed-handled",
    ]);
    expect(rowsOf(all, "krk-9")).toEqual([]);
    expect(rowsOf(undefined)).toEqual([]);
  });

  it("says the state, who settled it and when, and quotes the words", () => {
    const [openRow, dueRow, replaced, handled] = rowsOf(all);
    expect(dueRow).toEqual({
      id: "due-krk-2",
      project: "lab",
      tone: "needs",
      state: "Due — KRK-1 landed",
      heading: "With KRK-1 · Order rounding",
      settled: "Settled by Bob on KRK-2 · 2 days ago",
      quote: "“Loyalty keeps euros; src/loyalty.js divides by 100 once KRK-1 lands”",
      close: true,
      reopen: false,
    });
    expect(openRow).toMatchObject({
      tone: "coordination",
      state: "Open",
      settled: "Settled by Ana on Receipt layout · 40 min ago",
      close: true,
      reopen: false,
    });
    expect(handled).toMatchObject({
      tone: "neutral",
      state: "Closed · handled by Ana",
      close: false,
      reopen: true,
    });
    expect(replaced).toMatchObject({ state: "Replaced", close: false, reopen: false });
  });

  it("seen from the task that landed, still names the pair's other task and who landed", () => {
    expect(rowsOf(all, "krk-1")[0]).toMatchObject({
      state: "Due — KRK-1 landed",
      heading: "With KRK-2 · Loyalty points",
    });
  });

  it("offers Reopen only to what a person closed, while no task landed and within 30 days", () => {
    const rows = rowsOf(
      view(
        closed("fresh", "not-needed", "bob@acme.test"),
        closed("landed", "handled", "bob@acme.test", { landed: ["krk-1"] }),
        closed("old", "handled", "bob@acme.test", { settledAt: "2026-09-01T09:00:00Z" }),
        closed("by-hub", "expired"),
      ),
    );
    // Newest settled first; the same moment falls back to the id.
    expect(rows.map((row) => [row.id, row.reopen])).toEqual([
      ["by-hub", false],
      ["fresh", true],
      ["landed", false],
      ["old", false],
    ]);
  });

  it("reads a state or a reason a newer Hub names neutrally, and offers nothing for it", () => {
    const [paused, odd] = rowsOf(
      view(
        agreement("paused", { state: "paused", settledAt: minutesAgo(5) }),
        closed("odd", "superseded", "ana@acme.test"),
      ),
    );
    expect(paused).toMatchObject({
      tone: "neutral",
      state: "Unknown state",
      close: false,
      reopen: false,
    });
    expect(odd).toMatchObject({ state: "Closed", close: false, reopen: false });
  });

  it("keeps what teammates wrote as text, whatever it looks like", () => {
    const hostile = "<img src=x onerror=alert(1)> [pay now](https://evil.example) **bold**";
    const [row] = rowsOf(
      view(
        agreement("a", {
          words: hostile,
          by: { email: "<b>bob</b>@acme.test", task: "krk-2" },
        }),
      ),
      "krk-1",
      { tasks: [task("krk-2", "<script>KRK-2</script>", "t")] },
    );
    expect(row?.quote).toBe(`“${hostile}”`);
    expect(row?.settled).toContain("Settled by <b>bob</b>@acme.test on <script>KRK-2</script>");
  });

  it("quotes the words without the blanks around them, and leaves their own lines alone", () => {
    const [row] = rowsOf(view(agreement("a", { words: "\n  Keep euros;\nround once.  \n" })));
    expect(row?.quote).toBe("“Keep euros;\nround once.”");
  });

  it("names a task the project does not list by its id, and leaves out a time it cannot read", () => {
    const [row] = rowsOf(view(agreement("a", { settledAt: "soon" })), "krk-2", { tasks: [] });
    expect(row).toMatchObject({
      heading: "With krk-1",
      settled: "Settled by Bob on krk-2",
    });
  });

  it("falls back to a bare heading where the task is not in the pair at all", () => {
    expect(rowsOf(view(agreement("a", { tasks: ["krk-2", "krk-2"] })), "krk-2")[0]?.heading).toBe(
      "Agreement",
    );
  });
});

describe("what a task's section draws", () => {
  const OPEN_ON_KRK_2: PeerAgreementsStatus["workspaces"] = [
    {
      workspace: "acme",
      open: 2,
      dueForMe: [],
      tasks: [
        { project: "lab", task: "krk-2", open: 1, due: 0 },
        { project: "lab", task: "krk-1", open: 1, due: 0 },
      ],
    },
  ];
  const input = (over: Partial<AgreementsSectionInput> = {}): AgreementsSectionInput => ({
    status: slice(OPEN_ON_KRK_2),
    workspace: "acme",
    projectId: "lab",
    taskId: "krk-2",
    tasks: TASKS,
    personLabel,
    view: undefined,
    error: null,
    now: NOW,
    canChange: true,
    ...over,
  });
  const known = view(agreement("open"), closed("closed", "handled", "ana@acme.test"));

  it("is absent for a task that has none, and while none is known", () => {
    expect(agreementsSection(input({ view: known, taskId: "krk-9" }))).toEqual({ kind: "none" });
    expect(agreementsSection(input({ view: view() }))).toEqual({ kind: "none" });
    // Nothing is known of this task before a list is read, and the status says it has none.
    expect(agreementsSection(input({ taskId: "krk-9" }))).toEqual({ kind: "none" });
    expect(
      agreementsSection(input({ taskId: "krk-9", error: "The environment request failed." })),
    ).toEqual({ kind: "none" });
    expect(agreementsSection(input({ status: {} }))).toEqual({ kind: "none" });
  });

  it("waits for the list of a task the status says has an agreement, and says if it fails", () => {
    expect(agreementsSection(input())).toEqual({ kind: "loading" });
    expect(agreementsSection(input({ error: "The environment request failed." }))).toEqual({
      kind: "failed",
      message: "The environment request failed.",
    });
  });

  it("waits when an older Peer counts only the workspace and the workspace has one", () => {
    const [row] = OPEN_ON_KRK_2;
    const without = (open: number) => {
      const { tasks: _tasks, ...rest } = row!;
      return slice([{ ...rest, open }]);
    };
    expect(agreementsExpected(without(2), "acme", "lab", "krk-9")).toBe(true);
    expect(agreementsExpected(without(0), "acme", "lab", "krk-2")).toBe(false);
    expect(agreementsExpected(slice(OPEN_ON_KRK_2), "acme", "lab", "krk-9")).toBe(false);
    expect(agreementsExpected(slice(OPEN_ON_KRK_2), "acme", "lab", "krk-2")).toBe(true);
    expect(agreementsExpected(slice(OPEN_ON_KRK_2), "beta", "lab", "krk-2")).toBe(false);
    expect(agreementsExpected({}, "acme", "lab", "krk-2")).toBe(false);
  });

  it("lists the rows, with the buttons where this pairing may use them", () => {
    const section = agreementsSection(input({ view: known }));
    expect(section).toMatchObject({ kind: "list", error: null, note: null });
    expect(
      section.kind === "list" ? section.rows.map((row) => [row.id, row.close, row.reopen]) : [],
    ).toEqual([
      ["open", true, false],
      ["closed", false, true],
    ]);
  });

  it("keeps the rows while a later read fails, and says so", () => {
    expect(
      agreementsSection(input({ view: known, error: "The environment request failed." })),
    ).toMatchObject({ kind: "list", error: "The environment request failed." });
  });

  it("offers neither button to a pairing that cannot operate, and says why once", () => {
    const section = agreementsSection(input({ view: known, canChange: false }));
    expect(section).toMatchObject({ kind: "list", note: NEEDS_OPERATE });
    expect(
      section.kind === "list" ? section.rows.map((row) => [row.id, row.close, row.reopen]) : [],
    ).toEqual([
      ["open", false, false],
      ["closed", false, false],
    ]);
    // The words and the state stay.
    expect(section.kind === "list" ? section.rows[0] : null).toMatchObject({
      state: "Open",
      quote: expect.stringContaining("Loyalty keeps euros"),
    });
  });

  it("does not explain what nothing would have offered", () => {
    const nothingToDo = view(closed("hub", "replaced"), closed("later", "expired"));
    expect(agreementsSection(input({ view: nothingToDo, canChange: false }))).toMatchObject({
      kind: "list",
      note: null,
    });
  });
});

describe("what closing and reopening ask of the pairing", () => {
  it("is the scope the Hub's methods ask for: operate, not read", () => {
    expect(AgreementsRpcScopes["peer.agreements.close"]).toBe(AuthOrchestrationOperateScope);
    expect(AgreementsRpcScopes["peer.agreements.reopen"]).toBe(AuthOrchestrationOperateScope);
    expect(canChangeAgreements([AuthOrchestrationReadScope])).toBe(false);
    expect(canChangeAgreements([AuthOrchestrationReadScope, AuthOrchestrationOperateScope])).toBe(
      true,
    );
    expect(canChangeAgreements([])).toBe(false);
    expect(canChangeAgreements(undefined)).toBe(false);
    expect(canChangeAgreements(null)).toBe(false);
  });

  it("closes as handled or as not needed, the two reasons a person may give", () => {
    expect(CLOSE_CHOICES.map((choice) => choice.why)).toEqual(["handled", "not-needed"]);
    expect(CLOSE_CHOICES.map((choice) => choice.label)).toEqual(["Handled", "Not needed"]);
    expect(CLOSE_CHOICES.every((choice) => isPeerAgreementPersonReason(choice.why))).toBe(true);
  });
});

describe("what a close or a reopen leaves behind", () => {
  it("puts the agreement as the Hub answered in place of the row, and nothing else moves", () => {
    const before = view(agreement("a"), agreement("b", { tasks: ["krk-2", "t-3"] }));
    const after = withAgreement(before, closed("a", "handled", "ana@acme.test"));
    expect(after.agreements.map((row) => [row.id, row.state])).toEqual([
      ["a", "closed"],
      ["b", "open"],
    ]);
    expect(after.agreements[1]).toBe(before.agreements[1]);
    expect(after.at).toBe(before.at);
    // The view it was given is left as it was.
    expect(before.agreements[0]?.state).toBe("open");
  });

  it("tells an agreement apart by its project as well as its id, and adds one it did not hold", () => {
    const before = view(agreement("a"), agreement("a", { project: "other" }));
    const after = withAgreement(
      before,
      closed("a", "handled", "ana@acme.test", { project: "other" }),
    );
    expect(after.agreements.map((row) => [row.project, row.state])).toEqual([
      ["lab", "open"],
      ["other", "closed"],
    ]);
    const added = withAgreement(view(), agreement("new"));
    expect(added.agreements.map((row) => row.id)).toEqual(["new"]);
  });

  it("says a failure in its own words, short, and plainly where it has none", () => {
    expect(failureWords(new Error("This agreement is already closed."), "handled")).toBe(
      "This agreement is already closed.",
    );
    expect(failureWords(new Error("  spaced  "), "reopen")).toBe("spaced");
    expect(failureWords(new Error(""), "not-needed")).toBe("Could not close the agreement.");
    expect(failureWords(new Error("   "), "reopen")).toBe("Could not reopen the agreement.");
    expect(failureWords("not an error", "handled")).toBe("Could not close the agreement.");
    expect(failureWords(undefined, "reopen")).toBe("Could not reopen the agreement.");
    const long = failureWords(new Error("x".repeat(400)), "handled");
    expect(long).toHaveLength(140);
    expect(long.endsWith("…")).toBe(true);
  });
});

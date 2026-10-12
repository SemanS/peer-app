import { STALE_AFTER_MS, type WorkTaskNode } from "@t3tools/client-runtime/peer/work";
import { describe, expect, it } from "vite-plus/test";
import {
  expiryLabel,
  matchesTeammate,
  onlineEmails,
  requestRow,
  requestTask,
  sentOutcome,
  taskBroughtBy,
  taskOptions,
  teammateOptions,
} from "./requests.logic";
const row = {
  id: "one",
  project: "app",
  task: "task",
  sender: "ana@test.sk",
  recipient: "bob@test.sk",
  title: "Pull",
  prompt: "Flows",
  status: "pending" as const,
  createdAt: "now",
  updatedAt: "now",
};
describe("request row wording", () => {
  it("only offers supported withdrawal and words expiry without a timer", () => {
    const now = Date.parse("2026-10-09T00:00:00Z");
    expect(expiryLabel(row, now)).toBeUndefined();
    for (const [days, text] of [
      [0, "Expires today"],
      [1, "Expires tomorrow"],
      [13, "Expires in 13 days"],
    ] as const)
      expect(
        expiryLabel({ ...row, expiresAt: new Date(now + days * 86400000).toISOString() }, now),
      ).toBe(text);
    expect(requestRow({ ...row, expiresAt: "2026-10-23" }, row.sender, now).withdraw).toBe(true);
    expect(
      requestRow({ ...row, status: "dismissed", closedBy: "sender" }, row.sender, now),
    ).toMatchObject({ outcome: "withdrawn", withdraw: false });
  });
});

describe("what the sender reads", () => {
  it("names each outcome, and a recipient's dismissal is a decline", () => {
    expect(sentOutcome(row)).toEqual({ label: "Waiting", badge: "team" });
    expect(sentOutcome({ ...row, status: "accepted" }).label).toBe("Accepted");
    expect(
      sentOutcome({ ...row, status: "dismissed", closedBy: "recipient", reason: "Monday?" }),
    ).toEqual({ label: "Declined", badge: "secondary" });
    expect(sentOutcome({ ...row, status: "dismissed", closedBy: "sender" }).label).toBe(
      "Withdrawn",
    );
    expect(sentOutcome({ ...row, status: "dismissed", closedBy: "expiry" }).label).toBe("Expired");
  });
});

describe("the people a request can go to", () => {
  const members = [
    { email: "eva@acme.dev", name: "Eva" },
    { email: "me@acme.dev", name: "Me" },
    { email: "ana@acme.dev", name: "Ana" },
    { email: "bo.lang@acme.dev", name: "" },
  ];

  it("lists the project's members by name, without the sender", () => {
    expect(teammateOptions(members, "ME@acme.dev").map((o) => [o.name, o.group])).toEqual([
      ["Ana", "project"],
      ["Bo", "project"],
      ["Eva", "project"],
    ]);
  });

  it("puts the workspace's other members after them, and never twice", () => {
    const options = teammateOptions(members, "me@acme.dev", {
      elsewhere: [
        { email: "martin@acme.dev", name: "Martin" },
        { email: "ANA@acme.dev", name: "Ana again" },
        { email: "me@acme.dev", name: "Me" },
        { email: "zoe@acme.dev", name: null },
      ],
    });
    expect(options.map((o) => [o.email, o.group])).toEqual([
      ["ana@acme.dev", "project"],
      ["bo.lang@acme.dev", "project"],
      ["eva@acme.dev", "project"],
      ["martin@acme.dev", "elsewhere"],
      ["zoe@acme.dev", "elsewhere"],
    ]);
    expect(options.at(-1)?.name).toBe("Zoe");
  });

  it("marks who is online from the addresses its computers report", () => {
    const options = teammateOptions(members, null, { online: new Set(["eva@acme.dev"]) });
    expect(options.filter((o) => o.online).map((o) => o.name)).toEqual(["Eva"]);
  });

  it("reads a colleague as online while their computer's report is fresh", () => {
    const now = Date.parse("2026-10-12T12:00:00Z");
    const seen = (ms: number) => new Date(now - ms).toISOString();
    expect(
      onlineEmails(
        [
          { email: "Ana@acme.dev", seenAt: seen(STALE_AFTER_MS - 1) },
          { email: "eva@acme.dev", seenAt: seen(STALE_AFTER_MS) },
          { email: "bo@acme.dev", seenAt: "not a time" },
        ],
        now,
      ),
    ).toEqual(new Set(["ana@acme.dev"]));
  });

  it("finds a person by any part of their name or address", () => {
    const [ana] = teammateOptions([{ email: "ana.novak@acme.dev", name: "Ana Novak" }], null);
    expect(ana).toBeDefined();
    for (const query of ["", "  ", "ana", "NOVAK", "k@acme", "a.n"]) {
      expect(matchesTeammate(ana!, query)).toBe(true);
    }
    for (const query of ["eva", "novak ana", "ana@"]) {
      expect(matchesTeammate(ana!, query)).toBe(false);
    }
  });
});

describe("the tasks a request can name", () => {
  const task = (id: string, extra: Partial<WorkTaskNode> = {}): WorkTaskNode => ({
    id,
    key: undefined,
    title: `Task ${id}`,
    done: false,
    status: "idle",
    threads: [],
    removable: false,
    context: undefined,
    ...extra,
  });

  it("offers open tasks with their label and state, and leaves out what is done", () => {
    expect(
      taskOptions([
        task("a", { key: "ORD-5", title: "Allergen check" }),
        task("b", { done: true }),
        task("c", { inReview: true }),
        task("d", { status: "done" }),
      ]),
    ).toEqual([
      { id: "a", title: "Allergen check", label: "ORD-5 · Allergen check", state: "Not started" },
      { id: "c", title: "Task c", label: "Task c", state: "Waiting for review" },
    ]);
  });

  it("sends an open task by its id, titled as the task is", () => {
    const tasks = [{ id: "a", title: "  Allergen check " }];
    expect(requestTask({ kind: "existing", taskId: "a" }, tasks)).toEqual({
      title: "Allergen check",
      task: "a",
    });
    expect(requestTask({ kind: "existing", taskId: "gone" }, tasks)).toBeNull();
    expect(requestTask({ kind: "existing", taskId: "" }, tasks)).toBeNull();
  });

  it("sends a new task as a title alone, which is what the Hub makes the task of", () => {
    expect(requestTask({ kind: "new", title: "  Allergen icons " }, [])).toEqual({
      title: "Allergen icons",
    });
    expect(requestTask({ kind: "new", title: "   " }, [])).toBeNull();
    expect(requestTask({ kind: "new", title: "x".repeat(200) }, [])?.title).toHaveLength(120);
  });
});

describe("the task a sent request brought", () => {
  const request = (id: string, extra: Record<string, string> = {}) => ({
    workspace: "acme",
    request: {
      id,
      project: "orders",
      task: `${id}-task`,
      sender: "ana@acme.dev",
      recipient: "bo@acme.dev",
      title: "Allergen icons",
      prompt: "Please",
      status: "pending" as const,
      createdAt: "now",
      updatedAt: "now",
      ...extra,
    },
  });
  const input = {
    workspace: "acme",
    project: "orders",
    sender: "Ana@acme.dev",
    recipient: "bo@acme.dev",
    title: "Allergen icons",
  };

  it("is the one new request of the sender to that person with that title", () => {
    const after = [
      request("old"),
      request("fresh"),
      request("other", { recipient: "eva@acme.dev" }),
    ];
    expect(taskBroughtBy({ ...input, known: new Set(["old"]), after })).toBe("fresh-task");
  });

  it("names nothing when no request is new, or when two are", () => {
    const after = [request("old"), request("one"), request("two")];
    expect(
      taskBroughtBy({ ...input, known: new Set(["old", "one", "two"]), after }),
    ).toBeUndefined();
    expect(taskBroughtBy({ ...input, known: new Set(["old"]), after })).toBeUndefined();
    expect(taskBroughtBy({ ...input, known: new Set(), after: undefined })).toBeUndefined();
    expect(taskBroughtBy({ ...input, sender: null, known: new Set(), after })).toBeUndefined();
  });

  it("ignores requests of other people, projects and workspaces", () => {
    const after = [
      request("a", { sender: "eva@acme.dev" }),
      request("b", { project: "receipts" }),
      { ...request("c"), workspace: "other" },
      request("d", { task: "" }),
    ];
    expect(taskBroughtBy({ ...input, known: new Set(), after })).toBeUndefined();
  });
});

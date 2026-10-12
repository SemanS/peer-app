import { describe, expect, it } from "vite-plus/test";

import {
  ANA,
  BOB,
  CYRIL,
  MEMBERS,
  NOW,
  TASKS,
  THREADS,
  call,
  hoursAgo,
  minutesAgo,
  statusOf,
  type Setup,
} from "./ownership.testkit";
import {
  TEAM_WORDS,
  teamAreaRows,
  teamHeading,
  teamPeople,
  teamProjects,
  teamSignalRows,
} from "./team.logic";

/** The Team view of "Ordering demo" as the person `setup` names sees it. */
function teamOf(setup: Setup = {}, now = NOW) {
  const [view] = teamProjects(statusOf(setup), now);
  if (view === undefined) throw new Error("the project has no Team view");
  return view;
}

describe("which projects have a Team section", () => {
  it("has one for each project whose ownership is known", () => {
    const views = teamProjects(statusOf(), NOW);
    expect(views.map((view) => [view.workspace, view.project, view.name])).toEqual([
      ["acme", "ordering", "Ordering demo"],
    ]);
  });

  it("has none while the plugin is off or the Hub does not serve it, which leave the status without ownership", () => {
    expect(teamProjects(statusOf({ ownership: null }), NOW)).toEqual([]);
  });

  it("heads a project by its name, and by its workspace's too where there are several", () => {
    const status = statusOf();
    const [view] = teamProjects(status, NOW);
    expect(teamHeading(status, view!)).toBe("Ordering demo");
    const [acme] = status.workspaces;
    const two = { ...status, workspaces: [acme!, { ...acme!, slug: "beta", name: "Beta" }] };
    expect(teamHeading(two, view!)).toBe("Acme · Ordering demo");
  });
});

describe("the people", () => {
  const cards = teamPeople(teamOf());
  const card = (name: string) => cards.find((candidate) => candidate.name === name)!;

  it("lists the project's members, the person looking first", () => {
    expect(cards.map((candidate) => candidate.name)).toEqual([
      "Slavo",
      "Ana",
      "Bob",
      "Cyril",
      "Eva",
    ]);
  });

  it("counts each person's agents and what waits on them, in the phone artboard's words", () => {
    expect(
      cards.map(({ name, agents, waiting, needsThem }) => [name, agents, waiting, needsThem]),
    ).toEqual([
      ["Slavo", "No agents at work", "1 waits on you", true],
      ["Ana", "2 at work", "2 wait on Ana", true],
      ["Bob", "3 at work", "Nothing waits", false],
      ["Cyril", "1 waits for Cyril", "Nothing waits", false],
      ["Eva", "1 at work", "Nothing waits", false],
    ]);
  });

  it("says both where a person has agents at work and agents that wait for them", () => {
    const mixed = teamPeople(
      teamOf({
        threads: [
          ...THREADS,
          {
            id: "t10",
            task: "ord-12",
            title: "SECRET",
            email: CYRIL,
            status: "working",
            source: "peer",
            environment: "cyril-desktop",
            seenAt: minutesAgo(0),
          },
        ],
      }),
    );
    expect(mixed.find((person) => person.name === "Cyril")?.agents).toBe(
      "1 at work · 1 waits for Cyril",
    );
    // For the person looking, it is theirs to answer.
    const mine = teamPeople(
      teamOf({
        viewer: CYRIL,
        threads: THREADS,
      }),
    );
    expect(mine.find((person) => person.name === "Cyril")?.agents).toBe("1 waits for you");
  });

  it("keeps what a person owns for a screen reader, where a card has no room for it", () => {
    expect(card("Ana").label).toBe("Ana, 2 at work, Owns 1 task · area Payments, 2 wait on Ana");
    expect(card("Eva").label).toBe("Eva, 1 at work, Owns no tasks, Nothing waits");
  });
});

describe("what needs a person", () => {
  it("lists each, with the line a phone has room for, as the artboard words them", () => {
    expect(teamSignalRows(teamOf()).map(({ what, detail }) => [what, detail])).toEqual([
      ["Bob's agent waits for Ana's call", "ORD-9 · src/payments/fees.ts · 40 min"],
      ["ORD-11 waits for its review by Ana", "1 day"],
      ["Cyril's agent waits for Cyril", "ORD-12 · 18 min"],
      ["Overlap open on src/orders/notes.ts", "ORD-7 (Slavo) and ORD-12 (Cyril) · 35 min"],
      [
        "A push from ORD-15 waits for Ana's call",
        "Bob's agent changed src/payments/refunds.ts and has not asked yet · 6 min",
      ],
      ["ORD-14 has an agent at work and no owner", "Checkout copy · Eva · 1 working"],
    ]);
  });

  it("says the same to the owner who will decide the call, and to everyone else", () => {
    const first = (setup: Setup) => teamSignalRows(teamOf(setup))[0];
    const expected = {
      what: "Bob's agent waits for Ana's call",
      detail: "ORD-9 · src/payments/fees.ts · 40 min",
    };
    expect(first({ viewer: ANA })).toMatchObject(expected);
    expect(first({ viewer: BOB })).toMatchObject(expected);
  });

  it("tells a review's wait in days once it is over a day, and keeps the waits of a call on a task that is done", () => {
    const longer = teamOf({
      tasks: TASKS.map((task) =>
        task.id === "ord-11" ? { ...task, updatedAt: hoursAgo(80) } : task,
      ),
    });
    expect(teamSignalRows(longer).find((row) => row.what.startsWith("ORD-11"))?.detail).toBe(
      "3 days",
    );
    // The call's task finished: no row of the areas knows it, so the page's own words stand.
    const done = teamOf({
      tasks: TASKS.map((task) =>
        task.id === "ord-9" ? { ...task, status: "done" as const } : task,
      ),
    });
    expect(teamSignalRows(done)[0]).toMatchObject({
      what: "Bob's agent waits for Ana's call",
      detail: "ORD-9 · src/payments/fees.ts · “add a refund fee field” · 40 min",
    });
  });

  it("tells apart two calls that one ask opened at the same moment, each with its own paths", () => {
    const at = minutesAgo(40);
    const both = teamOf({
      ownership: {
        calls: [
          call({ id: "oc-1", owner: ANA, paths: ["src/payments/fees.ts"], createdAt: at }),
          call({ id: "oc-2", owner: CYRIL, paths: ["src/menu/photos.ts"], createdAt: at }),
        ],
      },
    });
    expect(
      teamSignalRows(both)
        .filter((row) => row.what.startsWith("Bob's agent waits for"))
        .map(({ what, detail }) => [what, detail]),
    ).toEqual([
      ["Bob's agent waits for Ana's call", "ORD-9 · src/payments/fees.ts · 40 min"],
      ["Bob's agent waits for Cyril's call", "ORD-9 · src/menu/photos.ts · 40 min"],
    ]);
  });

  it("lists nothing where nothing waits", () => {
    const calm = teamOf({
      ownership: { calls: [], tasks: {} },
      sessions: [],
      overlaps: [],
      tasks: TASKS.filter((task) => task.status === "open" && task.id !== "ord-14"),
      threads: THREADS.filter((thread) => thread.id !== "t8"),
    });
    expect(teamSignalRows(calm)).toEqual([]);
    expect(TEAM_WORDS.nothingWaits).toBe("Nothing waits for a person.");
  });

  it("leaves out what only this computer's coordination can see, where it is off", () => {
    const view = teamOf({ coordination: false });
    expect(view.coordinationOff).toBe(true);
    expect(teamSignalRows(view).map((row) => row.what)).toEqual([
      "Bob's agent waits for Ana's call",
      "ORD-11 waits for its review by Ana",
      "ORD-14 has an agent at work and no owner",
    ]);
    expect(TEAM_WORDS.coordinationOff).toBe(
      "Agent coordination is off on this computer, so changes agents make in owned paths cannot be shown here.",
    );
    expect(teamOf().coordinationOff).toBe(false);
  });
});

describe("the areas", () => {
  const rows = teamAreaRows(teamOf());
  const row = (name: string) => rows.find((candidate) => candidate.name === name)!;

  it("lists each in the project's order with its owner, as the artboard words them", () => {
    expect(rows.map(({ name, tasks, owner }) => [name, tasks, owner])).toEqual([
      ["Orders", "1 task in review", "Slavo"],
      ["Payments", "3 tasks · Ana decides changes by others", "Ana"],
      ["Menu", "1 task waiting on Cyril", "Cyril"],
      ["Not in an area", "ORD-14 has no owner", "—"],
    ]);
  });

  it("says a review that asks someone else is a review, not a task that waits on them", () => {
    // ORD-11 reads "Waiting for Ana's review" to Slavo; the area still says in review.
    const payments = teamOf({
      tasks: TASKS.filter((task) => task.area !== "Payments" || task.id === "ord-11"),
    });
    expect(teamAreaRows(payments).find((candidate) => candidate.name === "Payments")?.tasks).toBe(
      "1 task in review · Ana decides changes by others",
    );
  });

  it("leaves out what an owner decides where the owner map says they decide nothing", () => {
    const quiet = teamOf({
      ownership: {
        map: {
          version: 8,
          areas: { Orders: "slavo@acme.test", Payments: ANA },
          paths: { "src/payments/**": ANA },
          decide: [],
        },
      },
    });
    expect(teamAreaRows(quiet).find((candidate) => candidate.name === "Payments")?.tasks).toBe(
      "3 tasks",
    );
  });

  it("says which tasks nobody owns: one by its key, several by their number", () => {
    const loose = teamOf({
      ownership: { map: { version: 9, areas: {}, paths: {}, decide: [] }, tasks: {} },
    });
    expect(teamAreaRows(loose).map(({ name, tasks, owner }) => [name, tasks, owner])).toEqual([
      ["Orders", "ORD-7 has no owner · in review", "—"],
      ["Payments", "3 tasks · 3 without an owner", "—"],
      ["Menu", "ORD-12 has no owner · waiting on Cyril", "—"],
      ["Not in an area", "ORD-14 has no owner", "—"],
    ]);
  });

  it("reads the single task of an area by its title where it has no key", () => {
    const keyless = teamOf({
      tasks: [{ ...TASKS.find((task) => task.id === "ord-14")!, key: undefined }],
    });
    expect(teamAreaRows(keyless).map((candidate) => candidate.tasks)).toEqual([
      "Checkout copy has no owner",
    ]);
  });

  it("names the owner, or none, for a screen reader", () => {
    expect(row("Payments").label).toBe(
      "Payments, 3 tasks · Ana decides changes by others, owner Ana",
    );
    expect(row("Not in an area").label).toBe("Not in an area, ORD-14 has no owner, no owner");
  });

  it("counts a member who left as no owner of the area", () => {
    const left = teamOf({ members: MEMBERS.filter((member) => member.email !== ANA) });
    expect(teamAreaRows(left).find((candidate) => candidate.name === "Payments")?.owner).toBe("—");
  });
});

describe("what the section never shows", () => {
  it("carries no chat title, session label, request or prompt of anyone, whoever looks", () => {
    for (const viewer of [undefined, ANA, BOB]) {
      const view = teamOf(viewer === undefined ? {} : { viewer });
      const shown = JSON.stringify([
        teamPeople(view),
        teamSignalRows(view),
        teamAreaRows(view),
        view.coordinationOff,
      ]);
      expect(shown, String(viewer)).not.toContain("SECRET");
    }
  });
});

import { projectOwnership } from "@t3tools/client-runtime/peer/ownership";
import { describe, expect, it } from "vite-plus/test";

import {
  currentOwnerWords,
  handOverCandidateLine,
  handOverNotes,
  ownerBadgeLabel,
  ownerBadgeWhy,
  ownerCandidates,
  ownerMenuChoices,
  ownersSummary,
  setOwnerConfirm,
  setOwnerExplanation,
  taskCallChips,
  taskOwnerFacts,
  type TaskOwnerFacts,
} from "./ownership.logic";
import {
  ANA,
  BOB,
  CYRIL,
  DAN,
  EVA,
  NOW,
  hubTask,
  ownerCall,
  minutesAgo,
  statusFor,
  type Looking,
} from "./ownership.testkit";

/** Task `id` of ordering as `email` sees it. */
function facts(email: string, id: string, looking: Looking = {}): TaskOwnerFacts {
  const found = taskOwnerFacts(statusFor(email, looking), {
    workspace: "acme",
    project: "ordering",
    task: id,
  });
  if (found === undefined) throw new Error(`no facts for ${id}`);
  return found;
}

const choices = (email: string, id: string, looking: Looking = {}) =>
  ownerMenuChoices(facts(email, id, looking).actions).map((choice) => choice.label);

describe("who is offered which owner item", () => {
  it("offers Hand over… and Give back to a task's own owner, and nothing to anyone else", () => {
    expect(choices(BOB, "vl9")).toEqual(["Hand over…", "Give back"]);
    // Cyril is neither its owner nor a lead nor an admin; Ana owns another task.
    expect(choices(CYRIL, "vl9")).toEqual([]);
    expect(choices(ANA, "vl9")).toEqual([]);
  });

  it("offers Set owner… to the project's leads and the workspace's admins", () => {
    expect(choices(EVA, "vl9")).toEqual(["Set owner…"]);
    expect(choices(CYRIL, "vl9", { workspace: "admin" })).toEqual(["Set owner…"]);
    expect(choices(CYRIL, "vl9", { workspace: "owner" })).toEqual(["Set owner…"]);
  });

  it("offers a lead who owns the task all three, Set owner… first", () => {
    const eva = {
      ownership: {
        tasks: {
          vl9: {
            project: "ordering",
            task: "vl9",
            owner: EVA,
            since: minutesAgo(5),
            reason: "named",
          },
        },
      },
    };
    expect(choices(EVA, "vl9", eva)).toEqual(["Set owner…", "Hand over…", "Give back"]);
  });

  it("does not let an owner through the area hand the task over: it has no owner of its own", () => {
    // VL10 has no row of its own and sits in Payments, which Ana owns.
    expect(facts(ANA, "vl10").owner).toMatchObject({ email: ANA, throughArea: "Payments" });
    expect(choices(ANA, "vl10")).toEqual([]);
    expect(choices(EVA, "vl10")).toEqual(["Set owner…"]);
  });

  it("offers nothing where ownership is not known: the plugin is off, or the Hub does not serve it", () => {
    const status = statusFor(EVA, { ownership: null });
    expect(
      taskOwnerFacts(status, { workspace: "acme", project: "ordering", task: "vl9" }),
    ).toBeUndefined();
    expect(
      taskOwnerFacts(statusFor(EVA), { workspace: "acme", project: "gone", task: "vl9" }),
    ).toBeUndefined();
    expect(
      taskOwnerFacts(statusFor(EVA), { workspace: "acme", project: "ordering", task: "gone" }),
    ).toBeUndefined();
  });

  it("does not count a person who left the project as an owner: the task falls back as if unowned", () => {
    const left = {
      ownership: {
        tasks: {
          vl9: {
            project: "ordering",
            task: "vl9",
            owner: DAN,
            since: minutesAgo(5),
            reason: "named",
          },
        },
      },
    };
    // Dan owned VL9 by its own row; with him gone it is owned through its area, which Ana owns.
    expect(facts(EVA, "vl9", left).owner).toMatchObject({ email: ANA, throughArea: "Payments" });
    // VL11 sits in no owned area, so nobody owns it.
    const gone = {
      ownership: {
        tasks: {
          vl11: {
            project: "ordering",
            task: "vl11",
            owner: DAN,
            since: minutesAgo(5),
            reason: "named",
          },
        },
      },
    };
    expect(facts(EVA, "vl11", gone).owner).toBeUndefined();
    expect(choices(EVA, "vl11", gone)).toEqual(["Take it", "Set owner…"]);
  });

  it("offers Take it to any member of the project while nobody owns the task and it is not done", () => {
    // VL11 sits in Menu, which nobody owns, and has no owner of its own.
    expect(choices(CYRIL, "vl11")).toEqual(["Take it"]);
    expect(choices(EVA, "vl11")).toEqual(["Take it", "Set owner…"]);
    // Owned by its own row, or through its area: there is an owner to ask instead.
    expect(choices(CYRIL, "vl9")).toEqual([]);
    expect(choices(CYRIL, "vl10")).toEqual([]);
  });

  it("does not offer Take it for a task that is done, or to someone not on the project", () => {
    const done = {
      tasks: [hubTask("vl11", { title: "Menu photos", area: "Menu", status: "done" })],
    };
    expect(choices(CYRIL, "vl11", done)).toEqual([]);
    // An admin who is not on the project names owners, but has nothing of theirs to take.
    const outsider = {
      workspace: "admin" as const,
      members: [
        { email: ANA, name: "Ana" },
        { email: BOB, name: "Bob" },
      ],
    };
    expect(choices(CYRIL, "vl11", outsider)).toEqual(["Set owner…"]);
  });
});

describe("how a task's owner reads on its page", () => {
  const label = (email: string, id: string) => ownerBadgeLabel(facts(email, id).owner);

  it("says who owns it, and you when it is you", () => {
    expect(label(BOB, "vl9")).toBe("Owner: Bob (you)");
    expect(label(ANA, "vl9")).toBe("Owner: Bob");
  });

  it("says a task owned through its area is, and by whom", () => {
    expect(label(ANA, "vl10")).toBe("Owned through Payments · you");
    expect(label(BOB, "vl10")).toBe("Owned through Payments · Ana");
  });

  it("says when a task has no owner", () => {
    expect(label(BOB, "vl11")).toBe("No owner");
  });

  it("says why, and since when, where the Hub says so", () => {
    const why = (email: string, id: string, looking?: Looking) =>
      ownerBadgeWhy(facts(email, id, looking).owner, NOW);
    expect(why(ANA, "vl9")).toBe("Named by Eva, 30 min ago");
    expect(why(ANA, "vl7")).toBe("By request, 2 h ago");
    expect(why(ANA, "vl10")).toBe("Through the area Payments");
    expect(why(ANA, "vl11")).toBeUndefined();
  });

  it("says a task was taken, or came with an invitation", () => {
    const why = (reason: string, by?: string) =>
      ownerBadgeWhy(
        facts(ANA, "vl11", {
          ownership: {
            tasks: {
              vl11: {
                project: "ordering",
                task: "vl11",
                owner: CYRIL,
                since: minutesAgo(5),
                reason,
                ...(by === undefined ? {} : { by }),
              },
            },
          },
        }).owner,
        NOW,
      );
    expect(why("taken", CYRIL)).toBe("Taken, 5 min ago");
    expect(why("invited", EVA)).toBe("Invited by Eva, 5 min ago");
    expect(why("invited")).toBe("By invitation, 5 min ago");
  });

  it("leaves out a reason a newer Hub names, rather than guess its words", () => {
    const odd = {
      ownership: {
        tasks: {
          vl9: {
            project: "ordering",
            task: "vl9",
            owner: BOB,
            since: minutesAgo(5),
            reason: "telepathy",
          },
        },
      },
    };
    expect(ownerBadgeWhy(facts(ANA, "vl9", odd).owner, NOW)).toBeUndefined();
  });
});

describe("the owner's calls waiting on a task", () => {
  const withCall = (overrides = {}): Looking => ({ ownership: { calls: [ownerCall(overrides)] } });
  const labels = (email: string, id: string, looking: Looking) =>
    taskCallChips(facts(email, id, looking), NOW).map((chip) => chip.label);

  it("says whom a call waits on, and that it waits on you when it does", () => {
    expect(labels(BOB, "vl9", withCall())).toEqual(["Waiting on Ana's call · 40 min"]);
    expect(labels(CYRIL, "vl9", withCall())).toEqual(["Waiting on Ana's call · 40 min"]);
    expect(labels(ANA, "vl9", withCall())).toEqual(["Waits for your call · 40 min"]);
  });

  it("lists a pill for each call, and none for a call that is decided, expired or about another task", () => {
    expect(labels(BOB, "vl9", withCall({ state: "accepted" }))).toEqual([]);
    expect(labels(BOB, "vl9", withCall({ expiresAt: minutesAgo(1) }))).toEqual([]);
    expect(labels(BOB, "vl7", withCall())).toEqual([]);
    expect(
      labels(BOB, "vl9", {
        ownership: { calls: [ownerCall(), ownerCall({ id: "call-2", owner: EVA })] },
      }),
    ).toEqual(["Waiting on Ana's call · 40 min", "Waiting on Eva's call · 40 min"]);
  });
});

describe("the people a dialog offers as the owner", () => {
  const names = (
    email: string,
    id: string,
    options: { query?: string; leaveOut?: ReadonlyArray<string> } = {},
    looking: Looking = {},
  ) => {
    const found = facts(email, id, looking);
    return ownerCandidates(found, statusFor(email, looking), options);
  };

  it("lists the project's members by name, you among them", () => {
    expect(names(BOB, "vl10").map((candidate) => [candidate.name, candidate.mine])).toEqual([
      ["Ana", false],
      ["Bob", true],
      ["Cyril", false],
      ["Eva", false],
    ]);
  });

  it("narrows them by name or address, and leaves out whom a dialog says to", () => {
    expect(names(BOB, "vl10", { query: "ev" }).map((candidate) => candidate.email)).toEqual([EVA]);
    expect(names(BOB, "vl10", { query: " CYRIL@ " }).map((candidate) => candidate.name)).toEqual([
      "Cyril",
    ]);
    expect(names(BOB, "vl10", { query: "nobody" })).toEqual([]);
    expect(names(BOB, "vl10", { leaveOut: [BOB] }).map((candidate) => candidate.name)).toEqual([
      "Ana",
      "Cyril",
      "Eva",
    ]);
  });

  it("says what each has to do with the work, the first that is true", () => {
    const eva = {
      sessions: [
        { workspace: "acme", project: "ordering", email: EVA, task: "vl10", status: "working" },
        { workspace: "acme", project: "ordering", email: CYRIL, task: "vl10", status: "idle" },
      ],
      // Eva owns the area Menu, but her agent being at work on this task comes first.
      ownership: {
        map: { version: 1, areas: { Payments: ANA, Menu: EVA }, paths: {}, decide: [] },
      },
    };
    const notes = Object.fromEntries(
      names(BOB, "vl10", {}, eva).map((candidate) => [candidate.name, candidate.note]),
    );
    expect(notes).toEqual({
      Ana: "Owns the area Payments",
      // Bob owns VL9 by its own row; Ana's VL7 and VL10 are hers.
      Bob: "Owns 1 task",
      // An agent that is idle is not at work.
      Cyril: undefined,
      Eva: "Their agent is at work on VL10",
    });
    const yours = {
      sessions: [
        { workspace: "acme", project: "ordering", email: BOB, task: "vl10", status: "working" },
      ],
    };
    expect(names(BOB, "vl10", {}, yours).find((candidate) => candidate.mine)?.note).toBe(
      "Your agent is at work on VL10",
    );
  });

  it("does not offer a person who left, though the owner map still names them", () => {
    const left = {
      ownership: {
        map: { version: 1, areas: { Payments: ANA, Menu: DAN }, paths: {}, decide: [] },
      },
    };
    expect(names(BOB, "vl11", {}, left).map((candidate) => candidate.email)).not.toContain(DAN);
    expect(facts(BOB, "vl11", left).owner).toBeUndefined();
  });

  it("writes Hand over's line with the address first", () => {
    const [ana] = names(BOB, "vl10", { query: "ana" });
    expect(handOverCandidateLine(ana!)).toBe("ana@acme.test · owns the area Payments");
    const [cyril] = names(BOB, "vl10", { query: "cyril" });
    expect(handOverCandidateLine(cyril!)).toBe("cyril@acme.test");
  });
});

describe("what Set owner tells the person", () => {
  const task = facts(EVA, "vl10").task;
  const [, , cyril, eva] = ownerCandidates(facts(EVA, "vl10"), statusFor(EVA));

  it("says where the owner will see the task and what is recorded", () => {
    expect(setOwnerExplanation(cyril!, task)).toBe(
      "Cyril will see VL10 under Mine and can give it back. The change is recorded in the project's history with your name.",
    );
    expect(setOwnerExplanation(eva!, task)).toMatch(/^You will see VL10 under Mine/);
  });

  it("says a task without an owner falls back to its area's owner", () => {
    expect(setOwnerExplanation(null, task)).toBe(
      "VL10 will have no owner and falls back to its area's owner, if any. The change is recorded in the project's history with your name.",
    );
  });

  it("names what the button does for the pick", () => {
    expect(setOwnerConfirm(cyril!)).toBe("Make Cyril the owner");
    expect(setOwnerConfirm(eva!)).toBe("Make yourself the owner");
    expect(setOwnerConfirm(null)).toBe("Clear the owner");
  });

  it("says what the task has now, under its title", () => {
    expect(currentOwnerWords(undefined)).toBe("no owner");
    expect(currentOwnerWords(facts(EVA, "vl9").owner)).toBe("owned by Bob");
    expect(currentOwnerWords(facts(BOB, "vl9").owner)).toBe("owned by you");
    expect(currentOwnerWords(facts(BOB, "vl10").owner)).toBe("owned through Payments by Ana");
  });
});

describe("what Hand over tells the person", () => {
  const sessions = [
    { workspace: "acme", project: "ordering", email: BOB, task: "vl9", status: "working" },
  ];
  const notes = (looking: Looking, to = ANA) => {
    const found = facts(BOB, "vl9", looking);
    const status = statusFor(BOB, looking);
    const pick = ownerCandidates(found, status).find((candidate) => candidate.email === to)!;
    return handOverNotes({ facts: found, status, pick, now: NOW });
  };

  it("says the person's agents keep working and hear once, a call to the new owner stays open, and they can give it back", () => {
    expect(notes({ sessions, ownership: { calls: [ownerCall()] } })).toEqual([
      "Your agents on VL9 keep working; they hear once that Ana owns the task now.",
      "Your pending call to Ana stays open. Ana can give the task back.",
    ]);
  });

  it("says an agent that is not at work only hears, since it has nothing to keep doing", () => {
    const idle = [{ ...sessions[0]!, status: "idle" }];
    expect(notes({ sessions: idle })).toEqual([
      "Your agents on VL9 hear once that Ana owns the task now.",
      "Ana can give the task back.",
    ]);
  });

  it("says only what is true: no agent of theirs on the task, no call to the new owner", () => {
    expect(notes({})).toEqual(["Ana can give the task back."]);
    expect(notes({ sessions })).toEqual([
      "Your agents on VL9 keep working; they hear once that Ana owns the task now.",
      "Ana can give the task back.",
    ]);
    // A call to someone else does not stay open for Cyril.
    expect(notes({ ownership: { calls: [ownerCall()] } }, CYRIL)).toEqual([
      "Cyril can give the task back.",
    ]);
  });
});

describe("what a project's Owners row counts", () => {
  const summary = (looking: Looking = {}) => {
    const status = statusFor(BOB, looking);
    const workspace = status.workspaces[0]!;
    const state = workspace.projects[0]!;
    return ownersSummary(projectOwnership(status, workspace, state.project), state);
  };

  it("counts the areas that have an owner and the open tasks that have none", () => {
    // Payments is Ana's; Menu has no owner, so VL11 has none either.
    expect(summary()).toBe("1 area with an owner · 1 task without one");
    expect(
      summary({
        ownership: {
          map: { version: 4, areas: { Payments: ANA, Menu: CYRIL }, paths: {}, decide: [] },
        },
      }),
    ).toBe("2 areas with an owner · Every open task has an owner");
  });

  it("does not count a task that is done, or an area whose owner left", () => {
    expect(
      summary({
        tasks: [
          hubTask("vl7", { area: "Payments" }),
          hubTask("vl11", { area: "Menu", status: "done" }),
        ],
        ownership: {
          map: { version: 4, areas: { Payments: DAN, Menu: DAN }, paths: {}, decide: [] },
          tasks: {},
        },
      }),
    ).toBe("No area has an owner · 1 task without one");
  });

  it("has nothing to say for a project with no areas and no open tasks, or without ownership", () => {
    expect(summary({ areas: [], tasks: [] })).toBeUndefined();
    const status = statusFor(BOB, { ownership: null });
    const state = status.workspaces[0]!.projects[0]!;
    expect(ownersSummary(undefined, state)).toBeUndefined();
  });
});

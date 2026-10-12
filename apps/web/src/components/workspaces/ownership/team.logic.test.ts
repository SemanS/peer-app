import { projectOwnership } from "@t3tools/client-runtime/peer/ownership";
import { describe, expect, it } from "vite-plus/test";

import {
  historyRevision,
  ownerMapSummary,
  peopleCount,
  personRole,
  signalAction,
  signalAge,
  splitCallBadges,
  teamHeaderState,
  teamPageState,
  viewAgeLabel,
  whenLabel,
} from "./team.logic";
import {
  ANA,
  BOB,
  CYRIL,
  DAN,
  EVA,
  NOW,
  hubTask,
  minutesAgo,
  ownerCall,
  statusFor,
  teamProject,
} from "./ownership.testkit";

const SYNCED = { signedIn: true, lastSyncAt: minutesAgo(1) } as const;

describe("which page the Team address opens", () => {
  const tree = [teamProject(EVA)];
  const input = { workspace: "acme", project: "ordering" };

  it("opens the page for a project the person is on", () => {
    expect(teamPageState({ ...input, status: { ...statusFor(EVA), ...SYNCED }, tree }).kind).toBe(
      "ready",
    );
  });

  it("says the project is not available to someone who is not on it, once Peer has synced", () => {
    const status = { ...statusFor(EVA), ...SYNCED };
    expect(teamPageState({ workspace: "acme", project: "payments", status, tree })).toEqual({
      kind: "unavailable",
    });
    // The same words for a workspace the person is not in: nothing tells the two apart.
    expect(teamPageState({ workspace: "elsewhere", project: "ordering", status, tree })).toEqual({
      kind: "unavailable",
    });
  });

  it("waits while the status, or the first sync of the workspace, has not arrived", () => {
    expect(teamPageState({ ...input, status: null, tree: [] })).toEqual({ kind: "loading" });
    const base = statusFor(EVA);
    const unsynced = {
      ...base,
      signedIn: true,
      lastSyncAt: null,
      workspaces: [{ ...base.workspaces[0]!, projects: [], lastSyncAt: null }],
    };
    expect(teamPageState({ ...input, status: unsynced, tree: [] })).toEqual({ kind: "loading" });
    expect(teamPageState({ ...input, status: { ...unsynced, signedIn: false }, tree: [] })).toEqual(
      { kind: "unavailable" },
    );
  });

  it("says ownership is not known for a project that is the person's but has no view yet", () => {
    const status = { ...statusFor(EVA, { ownership: null }), ...SYNCED };
    expect(
      teamPageState({ ...input, status, tree: [teamProject(EVA, { ownership: null })] }).kind,
    ).toBe("unknown");
  });
});

describe("how old the view is", () => {
  it("counts seconds under a minute and then the largest whole unit", () => {
    expect(viewAgeLabel(minutesAgo(0), NOW)).toBe("0 s");
    expect(viewAgeLabel(new Date(NOW - 8_000).toISOString(), NOW)).toBe("8 s");
    expect(viewAgeLabel(minutesAgo(3), NOW)).toBe("3 min");
    expect(viewAgeLabel(minutesAgo(125), NOW)).toBe("2 h");
    expect(viewAgeLabel(minutesAgo(26 * 60), NOW)).toBe("1 day");
    expect(viewAgeLabel(minutesAgo(50 * 60), NOW)).toBe("2 days");
  });

  it("is never negative, and says nothing of a date nobody can read", () => {
    expect(viewAgeLabel(new Date(NOW + 5_000).toISOString(), NOW)).toBe("0 s");
    expect(viewAgeLabel("yesterday-ish", NOW)).toBeUndefined();
    expect(viewAgeLabel(undefined, NOW)).toBeUndefined();
  });

  it("says in the header whether this computer coordinates and how old the Hub's view is", () => {
    const at = new Date(NOW - 8_000).toISOString();
    expect(teamHeaderState({ at, coordinationOff: false }, NOW)).toEqual({
      label: "Coordination on this computer · view 8 s old",
      tone: "delivery",
    });
    expect(teamHeaderState({ at, coordinationOff: true }, NOW)).toEqual({
      label: "Coordination off on this computer · view 8 s old",
      tone: "neutral",
    });
    expect(teamHeaderState({ at: undefined, coordinationOff: false }, NOW).label).toBe(
      "Coordination on this computer",
    );
  });
});

describe("the people strip and the signals in words", () => {
  it("says a person's role on the project", () => {
    expect(personRole({ mine: true, lead: true })).toBe("You · lead");
    expect(personRole({ mine: true, lead: false })).toBe("You · member");
    expect(personRole({ mine: false, lead: true })).toBe("Lead");
    expect(personRole({ mine: false, lead: false })).toBe("Member");
    expect(peopleCount([1, 2, 3, 4, 5])).toBe("5 on the project");
  });

  it("says how long something waited, in a column", () => {
    expect(signalAge(undefined)).toBe("now");
    expect(signalAge(30_000)).toBe("now");
    expect(signalAge(6 * 60_000)).toBe("6 min");
    expect(signalAge(2 * 3_600_000)).toBe("2 h");
    expect(signalAge(26 * 3_600_000)).toBe("1 day");
    expect(signalAge(49 * 3_600_000)).toBe("2 days");
    expect(whenLabel(minutesAgo(40), NOW)).toBe("40 min");
    expect(whenLabel("never", NOW)).toBe("");
  });
});

describe("the owner map in words", () => {
  const summary = (looking = {}, email = EVA) => {
    const status = statusFor(email, looking);
    const workspace = status.workspaces[0]!;
    const project = workspace.projects[0]!;
    return ownerMapSummary({
      ownership: projectOwnership(status, workspace, project.project)!,
      areas: ["Payments", "Menu"],
      now: NOW,
    });
  };

  it("lists each area with its owner and each pattern, with the ones where the owner decides", () => {
    const view = summary({
      ownership: {
        map: {
          version: 7,
          areas: { Payments: ANA },
          paths: { "src/payments/**": ANA, "src/menu/**": "cyril@acme.test" },
          decide: ["src/payments/**"],
          updatedBy: EVA,
          updatedAt: minutesAgo(60),
        },
      },
    });
    expect(view.version).toBe(7);
    expect(view.card).toBe("v7 · Eva changed it 1 h ago");
    expect(view.page).toBe("Version 7 · last changed by Eva 1 h ago");
    expect(view.areas).toEqual([
      { name: "Payments", owner: "Ana", stale: false },
      { name: "Menu", owner: undefined, stale: false },
    ]);
    expect(view.paths).toEqual([
      { pattern: "src/menu/**", owner: "Cyril", decides: false },
      { pattern: "src/payments/**", owner: "Ana", decides: true },
    ]);
  });

  it("says a map nobody saved yet is not saved", () => {
    const view = summary({
      ownership: { map: { version: 0, areas: {}, paths: {}, decide: [] } },
    });
    expect(view.card).toBe("Not saved yet");
    expect(view.page).toBe("Version 0 · not saved yet");
    expect(view.areas.map((area) => area.owner)).toEqual([undefined, undefined]);
  });

  it("shows a person who left as no owner, and an area the project no longer lists as left behind", () => {
    const view = summary({
      ownership: {
        map: {
          version: 2,
          areas: { Payments: DAN, Billing: ANA },
          paths: { "src/old/**": DAN },
          decide: ["src/old/**", "src/ghost/**"],
          updatedBy: DAN,
          updatedAt: minutesAgo(5),
        },
      },
    });
    expect(view.areas).toEqual([
      { name: "Payments", owner: undefined, stale: false },
      { name: "Menu", owner: undefined, stale: false },
      { name: "Billing", owner: "Ana", stale: true },
    ]);
    // A pattern that decides but names no owner is listed too: it is a row a lead should see.
    expect(view.paths).toEqual([
      { pattern: "src/ghost/**", owner: undefined, decides: true },
      { pattern: "src/old/**", owner: undefined, decides: true },
    ]);
    // Who saved it is a fact whether or not they are still on the project.
    expect(view.card).toBe("v2 · Dan changed it 5 min ago");
  });
});

describe("what a signal's button does", () => {
  const ownershipOf = (email: string, calls = [ownerCall()]) => {
    const status = statusFor(email, { ownership: { calls } });
    const workspace = status.workspaces[0]!;
    return projectOwnership(status, workspace, workspace.projects[0]!.project)!;
  };
  const waiting = (task?: string) => ({
    open: { kind: "owner-call" as const, call: "call-1" },
    action: task === undefined ? "Decide" : "Open task",
  });

  it("opens the page that resolves a signal: the task, its review, the overlap, the owner dialog", () => {
    const input = { ownership: ownershipOf(EVA), now: NOW };
    expect(
      signalAction({ open: { kind: "task", task: "vl9" }, action: "Open task" }, input),
    ).toEqual({
      label: "Open task",
      target: { kind: "task", task: "vl9" },
    });
    expect(
      signalAction({ open: { kind: "review", task: "vl9" }, action: "Open review" }, input)?.target,
    ).toEqual({ kind: "review", task: "vl9" });
    expect(
      signalAction({ open: { kind: "overlap", overlap: "o1" }, action: "Open overlap" }, input)
        ?.target,
    ).toEqual({ kind: "overlap", overlap: "o1" });
    expect(
      signalAction({ open: { kind: "set-owner", task: "vl11" }, action: "Set owner" }, input)
        ?.target,
    ).toEqual({ kind: "set-owner", task: "vl11" });
  });

  it("offers nothing for a signal that points at no page", () => {
    const input = { ownership: ownershipOf(EVA), now: NOW };
    expect(signalAction({ open: { kind: "none" }, action: "" }, input)).toBeUndefined();
    expect(
      signalAction({ open: { kind: "task", task: "vl9" }, action: "" }, input),
    ).toBeUndefined();
  });

  it("lets the owner decide a call waiting on them, in the words of its card", () => {
    const action = signalAction(waiting(), { ownership: ownershipOf(ANA), now: NOW });
    expect(action).toMatchObject({
      label: "Decide",
      target: { kind: "decide", accept: "Accept…", decline: "Decline…", onBehalf: false },
    });
  });

  it("lets a lead decide it for the owner, and nobody else, and not one that is gone", () => {
    expect(signalAction(waiting(), { ownership: ownershipOf(EVA), now: NOW })).toMatchObject({
      target: { kind: "decide", accept: "Accept for Ana…", onBehalf: true },
    });
    // Bob's own agent asked; Cyril is neither the owner nor a lead.
    expect(signalAction(waiting(), { ownership: ownershipOf(BOB), now: NOW })).toBeUndefined();
    expect(signalAction(waiting(), { ownership: ownershipOf(CYRIL), now: NOW })).toBeUndefined();
    expect(signalAction(waiting(), { ownership: ownershipOf(ANA, []), now: NOW })).toBeUndefined();
  });
});

describe("a task's badges", () => {
  const call = {
    id: "c1",
    asker: "Bob",
    askerMine: false,
    owner: "Ana",
    ownerMine: false,
  } as never;
  const badge = (text: string) => ({ text, tone: "plain" as const });

  it("tells the badges of the calls it waits on, which come first, from the rest", () => {
    const { calls, rest } = splitCallBadges({
      calls: [call],
      badges: [badge("Waiting on Ana's call"), badge("Review by Ana")],
    });
    expect(calls.map((item) => item.badge.text)).toEqual(["Waiting on Ana's call"]);
    expect(rest.map((item) => item.text)).toEqual(["Review by Ana"]);
  });

  it("takes a list that does not start with them as having none to tell apart", () => {
    const badges = [badge("Review by Ana"), badge("Waiting on Ana's call")];
    expect(splitCallBadges({ calls: [call], badges })).toEqual({ calls: [], rest: badges });
    expect(splitCallBadges({ calls: [], badges })).toEqual({ calls: [], rest: badges });
  });
});

describe("when the history is read again", () => {
  const revision = (email: string, looking = {}) => {
    const project = teamProject(email, looking);
    return historyRevision(project, statusFor(email, looking));
  };

  it("changes when a task moves, an owner or a call changes, the map is saved or an overlap opens", () => {
    const base = revision(EVA);
    const moved = revision(EVA, {
      tasks: [hubTask("vl9", { status: "review", area: "Payments" })],
    });
    const called = revision(EVA, { ownership: { calls: [ownerCall()] } });
    const decided = revision(EVA, { ownership: { calls: [ownerCall({ state: "accepted" })] } });
    const saved = revision(EVA, {
      ownership: { map: { version: 4, areas: {}, paths: {}, decide: [] } },
    });
    const overlap = revision(EVA, {
      overlaps: [{ id: "o1", workspace: "acme", project: "ordering", state: "open", sessions: [] }],
    });
    expect(new Set([base, moved, called, decided, saved, overlap]).size).toBe(6);
  });

  it("does not change when only the view's age or an agent's report does", () => {
    expect(revision(EVA, { ownership: { at: minutesAgo(9) } })).toBe(revision(EVA));
    expect(revision(EVA, { sessions: [{ id: "s", workspace: "acme", project: "ordering" }] })).toBe(
      revision(EVA),
    );
  });
});

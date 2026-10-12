import { projectOwnership } from "@t3tools/client-runtime/peer/ownership";
import { describe, expect, it } from "vite-plus/test";

import {
  ownerMapSummary,
  peopleCount,
  personRole,
  signalAge,
  teamHeaderState,
  teamPageState,
  viewAgeLabel,
  whenLabel,
} from "./team.logic";
import { EVA, NOW, DAN, ANA, minutesAgo, statusFor, teamProject } from "./ownership.testkit";

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

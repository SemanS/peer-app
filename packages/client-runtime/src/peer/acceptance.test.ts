import type { PeerAcceptanceSummary, PeerHubStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  acceptanceActions,
  acceptanceBadge,
  acceptanceRevision,
  acceptanceState,
  acceptedLine,
  currentOf,
  deliveryOf,
  handoffAcceptanceLine,
  historyLine,
  historyNewestFirst,
  mayAccept,
  personName,
  taskAcceptance,
  teamAcceptanceFact,
} from "./acceptance.ts";

const ANA = "ana@acme.test";
const PLACE = { workspace: "acme", project: "pay", task: "vl-7" };
const row: PeerAcceptanceSummary = {
  ...PLACE,
  by: ANA,
  at: "2026-10-28T10:00:00Z",
  statusThen: "review",
};
const status = (accepted: ReadonlyArray<PeerAcceptanceSummary> | undefined) =>
  ({
    acceptance: accepted === undefined ? undefined : { accepted },
    workspaces: [
      {
        slug: "acme",
        projects: [{ project: { members: [{ email: ANA, name: "Ana Novak" }] } }],
      },
    ],
  }) as unknown as Pick<PeerHubStatus, "acceptance" | "workspaces">;
const name = (email: string) => (email === ANA ? "Ana" : email);
const clock = (at: string) => at.slice(11, 16);

describe("acceptance in the status", () => {
  it("finds a task's acceptance and keys its page on who and when", () => {
    expect(taskAcceptance(status([row]), PLACE)).toBe(row);
    expect(taskAcceptance(status([row]), { ...PLACE, task: "vl-8" })).toBeUndefined();
    // The plugin inactive: no slice, nothing accepted.
    expect(taskAcceptance(status(undefined), PLACE)).toBeUndefined();
    expect(acceptanceRevision(status([row]), PLACE)).toBe(`${ANA}@2026-10-28T10:00:00Z`);
    expect(acceptanceRevision(status([]), PLACE)).toBe("none");
  });

  it("names people as the workspace does", () => {
    expect(personName(status([]), "acme", "ANA@acme.test")).toBe("Ana Novak");
    expect(personName(status([]), "acme", "cyril.dvorak@acme.test")).toBe("Cyril");
  });
});

describe("who may accept", () => {
  it("is a lead of the project or an admin of the workspace", () => {
    expect(mayAccept({ role: "member" }, { role: "lead" })).toBe(true);
    expect(mayAccept({ role: "admin" }, { role: "member" })).toBe(true);
    expect(mayAccept({ role: "owner" }, { role: "member" })).toBe(true);
    expect(mayAccept({ role: "member" }, { role: "member" })).toBe(false);
  });

  it("accepts a delivered task with none, withdraws one that stands, never an open task", () => {
    expect(acceptanceActions({ allowed: true, current: null, task: "review" })).toEqual(["accept"]);
    expect(acceptanceActions({ allowed: true, current: null, task: "done" })).toEqual(["accept"]);
    expect(acceptanceActions({ allowed: true, current: null, task: "open" })).toEqual([]);
    expect(acceptanceActions({ allowed: true, current: row, task: "done" })).toEqual(["withdraw"]);
    expect(acceptanceActions({ allowed: true, current: row, task: "open" })).toEqual(["withdraw"]);
    expect(acceptanceActions({ allowed: false, current: null, task: "done" })).toEqual([]);
  });
});

describe("an acceptance given before a reopening", () => {
  const reopened = { ...row, beforeReopening: true };
  it("stays before the reopening once the task is in review or done again, as the Hub says", () => {
    expect(acceptanceState(reopened, "review")).toBe("accepted-before-reopening");
    expect(acceptanceState(reopened, "done")).toBe("accepted-before-reopening");
    expect(acceptedLine(reopened, "review", name, clock)).toBe(
      "Accepted by Ana · 10:00 · before reopening",
    );
    expect(teamAcceptanceFact(reopened, "review", name)).toBe("accepted by Ana before reopening");
    // The Hub saying it was not reopened wins over the task's status.
    expect(acceptanceState({ ...row, beforeReopening: false }, "open")).toBe("accepted");
  });

  it("offers Accept again once the task is delivered again", () => {
    expect(acceptanceActions({ allowed: true, current: reopened, task: "review" })).toEqual([
      "accept",
      "withdraw",
    ]);
    expect(acceptanceActions({ allowed: true, current: reopened, task: "done" })).toEqual([
      "accept",
      "withdraw",
    ]);
    expect(acceptanceActions({ allowed: true, current: reopened, task: "open" })).toEqual([
      "withdraw",
    ]);
    expect(
      acceptanceActions({
        allowed: true,
        current: { ...row, beforeReopening: false },
        task: "done",
      }),
    ).toEqual(["withdraw"]);
  });

  it("reads beforeReopening from a task's read", () => {
    const view = { ...PLACE, current: { by: ANA, at: row.at, statusThen: "review" }, history: [] };
    expect(currentOf({ ...view, beforeReopening: true })?.beforeReopening).toBe(true);
    expect(currentOf({ ...view, current: null, beforeReopening: false })).toBeUndefined();
  });
});

describe("acceptance words", () => {
  it("tells done and accepted from done without acceptance", () => {
    expect(acceptanceState(row, "done")).toBe("accepted");
    expect(acceptanceState(row, "open")).toBe("accepted-before-reopening");
    expect(acceptanceState(null, "done")).toBe("not-accepted");
    expect(acceptanceState(undefined, "review")).toBe("none");
    expect(acceptanceBadge("accepted")).toBe("Accepted");
    expect(acceptanceBadge("accepted-before-reopening")).toBe("Accepted before reopening");
    expect(acceptanceBadge("not-accepted")).toBeNull();
  });

  it("says who accepted and when, and each withdrawal", () => {
    expect(acceptedLine(row, "done", name, clock)).toBe("Accepted by Ana · 10:00");
    expect(acceptedLine(row, "open", name, clock)).toBe(
      "Accepted by Ana · 10:00 · before reopening",
    );
    expect(
      historyLine({ kind: "withdrawn", by: ANA, at: "2026-10-28T11:00:00Z" }, name, clock),
    ).toBe("Withdrawn by Ana · 11:00");
    expect(
      historyNewestFirst([
        { kind: "accepted", by: ANA, at: "2026-10-28T10:00:00Z" },
        { kind: "withdrawn", by: ANA, at: "2026-10-28T11:00:00Z" },
      ]).map((event) => event.kind),
    ).toEqual(["withdrawn", "accepted"]);
  });

  it("says an acceptance the review policy gave apart from a person's", () => {
    const policy = { ...row, via: "policy" as const };
    expect(acceptedLine(policy, "review", name, clock)).toBe("Accepted by Ana via policy · 10:00");
    expect(
      historyLine(
        { kind: "accepted", by: ANA, at: "2026-10-28T10:00:00Z", via: "policy" },
        name,
        clock,
      ),
    ).toBe("Accepted by Ana via policy · 10:00");
    expect(teamAcceptanceFact(policy, "review", name)).toBe("accepted by Ana via policy");
  });

  it("gives the Team page a fact for accepted and for done without acceptance", () => {
    expect(teamAcceptanceFact(row, "done", name)).toBe("accepted by Ana");
    expect(teamAcceptanceFact(row, "open", name)).toBe("accepted by Ana before reopening");
    expect(teamAcceptanceFact(undefined, "done", name)).toBe("done · not accepted");
    expect(teamAcceptanceFact(undefined, "review", name)).toBeUndefined();
    expect(deliveryOf({ done: false, inReview: true })).toBe("review");
    expect(deliveryOf({ done: true })).toBe("done");
    expect(deliveryOf({ done: false })).toBe("open");
  });
});

describe("the handoff package", () => {
  it("names the acceptance the Hub joined to it, and nothing without one", () => {
    expect(handoffAcceptanceLine({ by: ANA, at: "2026-10-28T10:00:00Z" }, name, clock)).toBe(
      "Accepted by Ana · 10:00",
    );
    expect(handoffAcceptanceLine(undefined, name, clock)).toBeNull();
  });
});

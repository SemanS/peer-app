import { projectOwnership } from "@t3tools/client-runtime/peer/ownership";
import { describe, expect, it } from "vite-plus/test";

import { callDetails, expiresLabel, pathsText } from "./ownerCall.logic";
import {
  ANA,
  BOB,
  CYRIL,
  EVA,
  NOW,
  iso,
  ownerCall,
  statusFor,
  type Looking,
} from "./ownership.testkit";

/** Ordering's ownership as `email` looks at it. */
function ownershipOf(email: string, looking: Looking = {}) {
  const status = statusFor(email, looking);
  const workspace = status.workspaces[0]!;
  return projectOwnership(status, workspace, workspace.projects[0]!.project)!;
}

describe("when an owner's call ends", () => {
  const at = (ms: number) => iso(NOW + ms);

  it("counts whole days, then hours, then minutes", () => {
    expect(expiresLabel(at(6.97 * 86_400_000), NOW)).toBe("expires in 6 days");
    expect(expiresLabel(at(86_400_000), NOW)).toBe("expires in 1 day");
    expect(expiresLabel(at(5.5 * 3_600_000), NOW)).toBe("expires in 5 h");
    expect(expiresLabel(at(20 * 60_000), NOW)).toBe("expires in 20 min");
    expect(expiresLabel(at(10_000), NOW)).toBe("expires in 1 min");
  });

  it("says it ended once it has, and says nothing for a date it cannot read", () => {
    expect(expiresLabel(at(0), NOW)).toBe("expired");
    expect(expiresLabel(at(-5 * 60_000), NOW)).toBe("expired");
    expect(expiresLabel("soon", NOW)).toBeUndefined();
  });
});

describe("the paths of a call, in words", () => {
  it("names one or two, and counts the rest", () => {
    expect(pathsText(["a.ts"])).toBe("a.ts");
    expect(pathsText(["a.ts", "b.ts"])).toBe("a.ts and b.ts");
    expect(pathsText(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"])).toBe("a.ts, b.ts and 3 more");
  });
});

describe("what a pending call says on the task's page", () => {
  const details = (email: string, overrides = {}) =>
    callDetails(ownershipOf(email), ownerCall(overrides), NOW);

  it("tells the asker's own call in the first person, with the path and who decides it", () => {
    expect(details(BOB)).toMatchObject({
      title: "Your agent asked Ana to change a path they decide",
      paths: [
        {
          path: "src/payments/fees.ts",
          rule: "Ana decides changes by others in src/payments/**",
        },
      ],
      reason: "Reason from your agent: “add a refund fee field”",
      meta: "Asked 40 min ago · expires in 6 days",
    });
  });

  it("names the asker for everyone else, and addresses the owner as you", () => {
    expect(details(CYRIL).title).toBe("Bob's agent asked Ana to change a path they decide");
    expect(details(CYRIL).reason).toBe("Reason from Bob's agent: “add a refund fee field”");
    expect(details(ANA).title).toBe("Bob's agent asks you to change a path you decide");
  });

  it("gives each person what the Hub lets them do with it", () => {
    // The asker takes it back; the owner decides; a lead decides for the owner; others only read.
    expect(details(BOB).actions).toEqual({ decide: undefined, withdraw: true });
    expect(details(ANA).actions).toEqual({ decide: "owner", withdraw: false });
    expect(details(EVA).actions).toEqual({ decide: "on-behalf", withdraw: false });
    expect(details(CYRIL).actions).toEqual({ decide: undefined, withdraw: false });
  });

  it("says no rule for a path nobody decides", () => {
    const quiet = callDetails(
      ownershipOf(BOB, { ownership: { map: { version: 1, areas: {}, paths: {}, decide: [] } } }),
      ownerCall({ paths: ["docs/readme.md"] }),
      NOW,
    );
    expect(quiet.paths).toEqual([{ path: "docs/readme.md", rule: undefined }]);
  });
});

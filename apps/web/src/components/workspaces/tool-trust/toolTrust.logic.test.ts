import { describe, expect, it } from "vite-plus/test";

import { MANAGED_IN_PEER, appliedByLine, toolStateBadge } from "./toolTrust.logic";

const ago = (iso: string) => (iso === "2026-10-12T14:02:11Z" ? "2h ago" : "?");

describe("the line under a workspace in the tool review", () => {
  it("names who applied the file and how long ago", () => {
    expect(
      appliedByLine(
        { appliedBy: "Slavo", appliedAt: "2026-10-12T14:02:11Z", managedInPeer: false },
        ago,
      ),
    ).toBe("Applied by Slavo · 2h ago");
  });

  it("says Peer manages a workspace nobody applied a file to, never a date", () => {
    const line = appliedByLine({ managedInPeer: true }, ago);
    expect(line).toBe("Managed in Peer; no workspace file applied");
    expect(line).toBe(MANAGED_IN_PEER);
    expect(line).not.toMatch(/ago|1970|Applied by/);
  });

  it("says nothing where this computer does not know the workspace's tools", () => {
    expect(appliedByLine({ managedInPeer: false }, ago)).toBeNull();
  });
});

describe("a tool's state as a status", () => {
  it("is connected when approved, set up when it waits on the person, off, or a problem", () => {
    expect(toolStateBadge("on")).toEqual({ state: "connected", label: "Approved" });
    expect(toolStateBadge("review")).toEqual({ state: "setup", label: "Needs review" });
    expect(toolStateBadge("changed")).toEqual({ state: "setup", label: "Changed" });
    expect(toolStateBadge("secret")).toEqual({ state: "setup", label: "Needs secret" });
    expect(toolStateBadge("off")).toEqual({ state: "off", label: "Off" });
    expect(toolStateBadge("invalid")).toEqual({ state: "problem", label: "Invalid" });
  });
});

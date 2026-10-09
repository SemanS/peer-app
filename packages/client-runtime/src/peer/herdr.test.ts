import { describe, expect, it } from "@effect/vitest";
import { peerLaunchBlocker, peerCoordinationDetail, peerCoordinationLabel } from "./herdr.ts";

const status = { signedIn: true, agents: { herdr: "running" as const } };
const project = { project: { capacity: { personal: "any" } }, repositories: [{ state: "ready" }] };
describe("the shared task launch blocker", () => {
  it("prioritizes sign in, herdr, capacity, then a ready checkout", () => {
    expect(peerLaunchBlocker({ ...status, signedIn: false }, project)).toContain("Sign in");
    expect(peerLaunchBlocker({ ...status, agents: { herdr: "not-running" } }, project)).toContain(
      "herdr",
    );
    expect(
      peerLaunchBlocker(status, { ...project, project: { capacity: { personal: "approved" } } }),
    ).toContain("approved provider");
    expect(
      peerLaunchBlocker(status, { ...project, repositories: [{ state: "cloning" }] }),
    ).toContain("Clone");
    expect(peerLaunchBlocker(status, project)).toBeNull();
  });
});
describe("coordination level labels", () => {
  it("renders advisory tools on C without upgrading the wire level", () => {
    expect(peerCoordinationLabel("C", true)).toBe("B-mcp · advisory tools");
    expect(peerCoordinationDetail("C", true)).toContain("cannot stop");
    for (const level of ["A", "B"] as const) {
      expect(peerCoordinationLabel(level, true)).toBe(peerCoordinationLabel(level));
      expect(peerCoordinationDetail(level, true)).toBe(peerCoordinationDetail(level));
    }
    expect(peerCoordinationLabel("C")).toBe("C · observed after work");
  });
});

import type { PeerHubStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { WorkProjectNode } from "../workTree.logic";
import { changesWebPlugin } from "./index.ts";

const status = {
  changes: {
    hubSupport: "supported",
    projects: [{ workspace: "acme", project: "ordering", inFlight: 4, needAttention: 2 }],
  },
} as unknown as PeerHubStatus;
const project = { workspace: "acme", projectId: "ordering" } as WorkProjectNode;

describe("the Changes row in a project's navigation", () => {
  const [signal] = changesWebPlugin.projectSignals?.(status, project) ?? [];

  it("counts what holds a conflict or two versions", () => {
    expect(signal?.navRow?.count).toBe(2);
  });

  it("is marked while the Changes page is open and not on another page", () => {
    expect(signal?.navRow?.active?.("changes:acme:ordering")).toBe(true);
    expect(signal?.navRow?.active?.("knowledge:acme:ordering")).toBe(false);
    expect(signal?.navRow?.active?.(null)).toBe(false);
  });

  it("adds no tile or chip of its own to the project's signals", () => {
    expect(signal?.count).toBeNull();
    expect(signal?.open).toBeUndefined();
  });
});

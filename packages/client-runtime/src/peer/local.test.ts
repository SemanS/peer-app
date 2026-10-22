import { describe, expect, it } from "vite-plus/test";
import { PEER_LOCAL_WORKSPACE, PeerCoordinationState } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { localCoordination } from "./local.ts";

const decodeCoordination = Schema.decodeUnknownSync(PeerCoordinationState);

const base = {
  enabled: true,
  policy: "coordinate" as const,
  claudeHooks: true,
  codexHooks: true,
  codexHooksTrusted: false,
  logPath: "/local/log",
  sessions: [],
  overlaps: [],
  findings: [],
  contexts: [],
  candidates: [],
};

describe("local coordination presentation", () => {
  it("accepts old status without inventing local support or a Hub requirement for chats", () => {
    const coordination = decodeCoordination(base);
    expect(localCoordination({ coordination })).toMatchObject({
      supported: false,
      available: false,
      title: "Local chats",
    });
  });
  it("counts local evidence only and reports paused hooks honestly", () => {
    const local = localCoordination({
      coordination: {
        ...base,
        enabled: false,
        local: { available: true, workspace: PEER_LOCAL_WORKSPACE },
        overlaps: [
          {
            id: "here",
            workspace: PEER_LOCAL_WORKSPACE,
            project: "p",
            sessions: ["a", "b"],
            files: ["x"],
            state: "resolved",
            resolution: "Reviewed",
            notes: [],
            updatedAt: "2026-10-22T10:00:00Z",
          },
          {
            id: "team",
            workspace: "team",
            project: "p",
            sessions: ["c", "d"],
            files: ["x"],
            state: "open",
            notes: [],
            updatedAt: "2026-10-22T10:00:00Z",
          },
        ],
      },
    });
    expect(local).toMatchObject({ title: "Peer Local · paused", open: 0, resolved: 1 });
    expect(local.overlaps).toHaveLength(1);
    expect(local.providers.every((provider) => !provider.ready)).toBe(true);
  });
  it("does not call untrusted Codex hooks ready or hide a failed local state load", () => {
    const local = localCoordination({
      coordination: {
        ...base,
        local: {
          available: false,
          workspace: PEER_LOCAL_WORKSPACE,
          error: "Could not read local history",
        },
      },
    });
    expect(local.title).toBe("Local coordination unavailable");
    expect(local.description).toBe("Could not read local history");
    expect(local.providers.find((p) => p.name === "Codex")?.ready).toBe(false);
  });
});

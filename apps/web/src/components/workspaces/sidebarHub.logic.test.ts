import type { PeerHubStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { hubDot } from "./sidebarHub.logic";

const status = (extra: object = {}) =>
  ({
    signedIn: true,
    hubUrl: "https://hub.webinson.com/",
    error: null,
    lastSyncAt: "2026-10-12T10:00:00Z",
    workspaces: [{ name: "Webinson", error: null }],
    ...extra,
  }) as unknown as Parameters<typeof hubDot>[0] & PeerHubStatus;

describe("hubDot", () => {
  it("is connected once the Hub answered and nothing failed, with when it last did", () => {
    expect(hubDot(status())).toEqual({
      state: "connected",
      title: "Peer Hub · connected to hub.webinson.com",
      syncedAt: "2026-10-12T10:00:00Z",
    });
  });

  it("is a problem while the Hub or a workspace failed, saying what", () => {
    expect(hubDot(status({ error: "Could not reach the hub" }))).toMatchObject({
      state: "problem",
      title: "Peer Hub · Could not reach the hub",
    });
    expect(
      hubDot(status({ workspaces: [{ name: "Webinson", error: "Sync refused" }] })),
    ).toMatchObject({ state: "problem", title: "Peer Hub · Webinson: Sync refused" });
  });

  it("treats an optional disconnected Hub as neutral before sign-in", () => {
    expect(hubDot(status({ signedIn: false })).state).toBe("off");
    expect(hubDot(null)).toMatchObject({ state: "off", syncedAt: null });
  });
});

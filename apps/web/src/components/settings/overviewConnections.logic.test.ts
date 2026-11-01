import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { CHECKING } from "./connectionFacts";
import { deviceHubConnection, providerConnection } from "./overviewComputer.logic";

describe("an agent provider", () => {
  const provider = (extra: Partial<ServerProvider> = {}): ServerProvider => ({
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: "0.47.0",
    status: "ready",
    auth: { status: "authenticated", label: "ChatGPT Pro" },
    checkedAt: "2026-10-12T10:15:00Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...extra,
  });

  it("is Connected with its plan and version, as of its last check", () => {
    expect(providerConnection(provider())).toEqual({
      state: "connected",
      detail: "ChatGPT Pro · v0.47.0",
      checkedAt: "2026-10-12T10:15:00Z",
    });
  });

  it("needs setup when signed out, and has a Problem when it failed its checks", () => {
    expect(providerConnection(provider({ auth: { status: "unauthenticated" } }))?.state).toBe(
      "setup",
    );
    expect(
      providerConnection(provider({ status: "error", message: "Binary crashed." })),
    ).toMatchObject({ state: "problem", detail: "Binary crashed." });
  });

  it("is not listed when it is not installed or turned off: that is not a connection", () => {
    expect(providerConnection(provider({ installed: false }))).toBeNull();
    expect(providerConnection(provider({ enabled: false }))).toBeNull();
    expect(providerConnection(provider({ status: "disabled" }))).toBeNull();
  });
});

describe("the device hub", () => {
  it("is Off until it is turned on, whatever it reports", () => {
    expect(deviceHubConnection({ enabled: false, status: "ready", detail: null }).state).toBe(
      "off",
    );
  });

  it("follows what the hub reports once it is on", () => {
    const hub = (
      status: Parameters<typeof deviceHubConnection>[0]["status"],
      detail: string | null = null,
    ) => deviceHubConnection({ enabled: true, status, detail });
    expect(hub(null)).toBe(CHECKING);
    expect(hub("starting").state).toBe("setup");
    expect(hub("ready").state).toBe("connected");
    expect(hub("failed", "No Xcode.")).toEqual({ state: "problem", detail: "No Xcode." });
  });
});

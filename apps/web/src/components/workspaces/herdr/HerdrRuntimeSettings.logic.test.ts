import type { PeerHerdrIntegration, PeerHerdrStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  herdrIntegrationRow,
  herdrRuntimeActions,
  integrationConfirmation,
  otherRunningLine,
  pendingUpgradeLine,
  restartConfirmation,
  runtimeDetailLine,
  turnOffConfirmation,
} from "./HerdrRuntimeSettings.logic";

type Runtime = PeerHerdrStatus["runtime"];

const view = (herdr: PeerHerdrStatus) => ({ agents: { herdr: "running" as const }, herdr });
const status = (runtime: Partial<Runtime>, bundled = true): PeerHerdrStatus => ({
  bundled,
  runtime: {
    source: "peer",
    state: "running",
    version: "0.9.3",
    bundledVersion: "0.9.3",
    agents: 0,
    resumable: 0,
    otherRunning: false,
    attachCommand: "herdr --session peer",
    ...runtime,
  },
  integrations: [],
});
const actions = (runtime: Partial<Runtime>, bundled = true, local = false) =>
  herdrRuntimeActions(view(status(runtime, bundled)), local);

describe("which actions the herdr runtime offers", () => {
  it("offers Turn off, Restart and Open herdr on the desktop for Peer's running herdr", () => {
    expect(actions({}, true, true)).toEqual({
      power: "turn-off",
      restart: true,
      attach: "open",
      waiting: false,
    });
  });

  it("offers the command to copy anywhere but the local desktop", () => {
    expect(actions({}).attach).toBe("copy");
    expect(actions({ attachCommand: undefined }).attach).toBe("none");
  });

  it("offers Turn on only, when it is off", () => {
    expect(actions({ source: "none", state: "off" }, false, true)).toEqual({
      power: "turn-on",
      restart: false,
      attach: "none",
      waiting: false,
    });
  });

  it("offers Restart on a failed herdr", () => {
    expect(actions({ source: "none", state: "failed", reason: "no" })).toMatchObject({
      power: "turn-off",
      restart: true,
      attach: "none",
    });
  });

  it("waits while herdr starts or stops", () => {
    for (const state of ["starting", "stopping"] as const) {
      expect(actions({ state })).toMatchObject({ restart: false, waiting: true });
    }
  });

  it("never turns off or restarts the person's own herdr", () => {
    expect(actions({ source: "own" }, true, true)).toEqual({
      power: "turn-off",
      restart: false,
      attach: "none",
      waiting: false,
    });
  });

  it("offers nothing to run where no herdr is bundled", () => {
    expect(
      actions({ source: "none", state: "unavailable", bundledVersion: undefined }, true, true),
    ).toEqual({ power: null, restart: false, attach: "none", waiting: false });
  });

  it("offers nothing from a server that predates the runtime", () => {
    expect(herdrRuntimeActions({ agents: { herdr: "running" } }, true)).toEqual({
      power: null,
      restart: false,
      attach: "none",
      waiting: false,
    });
  });
});

describe("the confirmations", () => {
  it("asks nothing of an idle herdr", () => {
    expect(turnOffConfirmation({ agents: 0, resumable: 0 })).toBeNull();
    expect(restartConfirmation({ agents: 0, resumable: 0 })).toBeNull();
  });

  it("says how many agents stop and how many can resume", () => {
    expect(turnOffConfirmation({ agents: 1, resumable: 0 })?.message).toBe(
      "Turn off Peer's herdr? It runs 1 agent. It stops.",
    );
    expect(restartConfirmation({ agents: 3, resumable: 2 })).toEqual({
      message: "Restart Peer's herdr? It runs 3 agents. 2 of 3 can resume; the others stop.",
      destructive: true,
    });
    expect(restartConfirmation({ agents: 2, resumable: 2 })?.message).toContain(
      "All stop and can resume when herdr is back.",
    );
    expect(restartConfirmation({ agents: 2, resumable: 0 })?.message).toContain("They all stop.");
  });

  it("names the herdr a restart moves to", () => {
    expect(
      restartConfirmation({
        agents: 1,
        resumable: 1,
        pendingUpgrade: true,
        bundledVersion: "0.10.0",
      })?.message,
    ).toBe(
      "Restart Peer's herdr? It runs 1 agent. It restarts on herdr 0.10.0. It stops and can resume when herdr is back.",
    );
  });

  it("names the files an integration changes", () => {
    const claude: PeerHerdrIntegration = {
      agent: "claude",
      state: "missing",
      files: ["~/.claude/settings.json"],
    };
    expect(integrationConfirmation(claude, "install").message).toBe(
      "Install the herdr integration for Claude Code? This changes ~/.claude/settings.json.",
    );
    expect(integrationConfirmation({ ...claude, state: "outdated" }, "install").message).toContain(
      "Update the herdr integration",
    );
    expect(integrationConfirmation({ ...claude, state: "installed" }, "remove")).toEqual({
      message:
        "Remove the herdr integration for Claude Code? This changes ~/.claude/settings.json. herdr can no longer resume its agents after a restart.",
      destructive: true,
    });
  });
});

describe("the integration rows", () => {
  const row = (state: PeerHerdrIntegration["state"], reason?: string) =>
    herdrIntegrationRow({ agent: "codex", state, files: [], ...(reason ? { reason } : {}) });

  it("offers Install, Update and Remove by state", () => {
    expect(row("missing").actions.map((a) => a.label)).toEqual(["Install"]);
    expect(row("outdated").actions.map((a) => a.label)).toEqual(["Update", "Remove"]);
    expect(row("installed").actions.map((a) => a.label)).toEqual(["Remove"]);
  });

  it("gives the reason and no action when unavailable", () => {
    expect(row("unavailable", "python3 is missing")).toEqual({
      name: "Codex",
      description: "python3 is missing",
      actions: [],
    });
  });
});

describe("the runtime lines", () => {
  const runtime = (patch: Partial<Runtime>) => status(patch).runtime;

  it("says Peer keeps its herdr until its agents finish", () => {
    expect(otherRunningLine(runtime({ otherRunning: true, agents: 2 }))).toBe(
      "Your herdr is running too; Peer keeps using its own until its 2 agents finish",
    );
    expect(otherRunningLine(runtime({ otherRunning: true, agents: 0 }))).toBeNull();
    expect(otherRunningLine(runtime({ agents: 2 }))).toBeNull();
  });

  it("says a newer herdr waits for its agents", () => {
    expect(pendingUpgradeLine(runtime({ pendingUpgrade: true, bundledVersion: "0.10.0" }))).toBe(
      "herdr 0.10.0 is ready; it starts when your agents finish or when you restart herdr",
    );
    expect(pendingUpgradeLine(runtime({}))).toBeNull();
  });

  it("points at the log of a failed herdr and the reason none is available", () => {
    expect(runtimeDetailLine(runtime({ state: "failed", log: "/tmp/herdr.log" }))).toBe(
      "herdr's log is at /tmp/herdr.log",
    );
    expect(runtimeDetailLine(runtime({ state: "unavailable", reason: "No binary" }))).toBe(
      "No binary",
    );
    expect(runtimeDetailLine(runtime({}))).toBeNull();
  });
});

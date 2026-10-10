import type { PeerHerdrIntegration, PeerHerdrStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  herdrIntegrationConfirmation,
  herdrIntegrationRow,
  herdrNoAgentsText,
  herdrRestartConfirmation,
  herdrRuntimeActions,
  herdrRuntimeNotes,
  herdrTurnOffConfirmation,
} from "./herdrRuntime.logic";

const runtime = (patch: Partial<PeerHerdrStatus["runtime"]> = {}): PeerHerdrStatus["runtime"] => ({
  source: "peer",
  state: "running",
  version: "0.9.3",
  bundledVersion: "0.9.3",
  agents: 0,
  resumable: 0,
  otherRunning: false,
  ...patch,
});
const herdr = (
  patch: Partial<PeerHerdrStatus["runtime"]> = {},
  bundled = true,
): PeerHerdrStatus => ({
  bundled,
  runtime: runtime(patch),
  integrations: [],
});

describe("herdrRuntimeActions", () => {
  it("offers Turn off and Restart on Peer's running herdr", () => {
    expect(herdrRuntimeActions(herdr())).toEqual({ power: "turn-off", restart: true });
  });
  it("offers Turn on and no Restart when it is off", () => {
    expect(herdrRuntimeActions(herdr({ state: "off", source: "none" }, false))).toEqual({
      power: "turn-on",
      restart: false,
    });
  });
  it("offers Restart and Turn off when it failed", () => {
    expect(herdrRuntimeActions(herdr({ state: "failed" }))).toEqual({
      power: "turn-off",
      restart: true,
    });
  });
  it("offers nothing while it starts or stops", () => {
    for (const state of ["starting", "stopping"] as const) {
      expect(herdrRuntimeActions(herdr({ state }))).toEqual({ power: null, restart: false });
    }
  });
  it("never restarts the person's own herdr", () => {
    expect(herdrRuntimeActions(herdr({ source: "own" })).restart).toBe(false);
  });
  it("offers nothing where the build has no herdr", () => {
    expect(
      herdrRuntimeActions(
        herdr({ source: "none", state: "unavailable", bundledVersion: undefined }),
      ),
    ).toEqual({ power: null, restart: false });
  });
});

describe("confirmations", () => {
  it("asks before turning off only when Peer's agents run, and names them", () => {
    expect(herdrTurnOffConfirmation(runtime(), [])).toBeNull();
    expect(herdrTurnOffConfirmation(runtime({ source: "own", agents: 2 }), ["a"])).toBeNull();
    expect(herdrTurnOffConfirmation(runtime({ agents: 2 }), ["Fix bug", "Docs"])?.message).toBe(
      "2 agents will stop: Fix bug, Docs.",
    );
  });
  it("asks before restarting only when agents run, saying how many resume", () => {
    expect(herdrRestartConfirmation(runtime())).toBeNull();
    expect(herdrRestartConfirmation(runtime({ agents: 2, resumable: 1 }))?.message).toContain(
      "resumes 1 of 2 agents. The other 1 will stop.",
    );
    expect(herdrRestartConfirmation(runtime({ agents: 1, resumable: 1 }))?.message).toBe(
      "herdr resumes all 1 agent after the restart.",
    );
  });
  it("names the files an integration changes", () => {
    const integration: PeerHerdrIntegration = {
      agent: "claude",
      state: "missing",
      files: ["~/.claude/settings.json"],
    };
    expect(herdrIntegrationConfirmation(integration, true).message).toContain(
      "~/.claude/settings.json",
    );
    expect(
      herdrIntegrationConfirmation({ ...integration, state: "installed" }, false).confirm,
    ).toBe("Remove");
  });
});

describe("herdrIntegrationRow", () => {
  const row = (state: PeerHerdrIntegration["state"], reason?: string) =>
    herdrIntegrationRow({
      agent: "codex",
      state,
      files: [],
      ...(reason === undefined ? {} : { reason }),
    });
  it("maps each state to its actions", () => {
    expect(row("installed")).toMatchObject({ install: null, remove: true });
    expect(row("outdated")).toMatchObject({ install: "Update", remove: true });
    expect(row("missing")).toMatchObject({ install: "Install", remove: false });
  });
  it("gives the reason and no Install when unavailable", () => {
    expect(row("unavailable", "python3 is missing")).toMatchObject({
      stateText: "python3 is missing",
      install: null,
      remove: false,
    });
  });
});

describe("herdrRuntimeNotes", () => {
  it("says your herdr runs too and a pending upgrade", () => {
    expect(
      herdrRuntimeNotes(
        runtime({ otherRunning: true, agents: 2, pendingUpgrade: true, bundledVersion: "0.9.4" }),
      ),
    ).toEqual([
      "Your herdr is running too; Peer keeps using its own until its 2 agents finish",
      "herdr 0.9.4 is ready; it starts when your agents finish or when you restart herdr",
    ]);
    expect(herdrRuntimeNotes(runtime({ otherRunning: true, agents: 1 }))[0]).toContain(
      "its 1 agent finishes",
    );
    expect(herdrRuntimeNotes(runtime())).toEqual([]);
  });
});

describe("herdrNoAgentsText", () => {
  it("tells no herdr from no agents", () => {
    expect(herdrNoAgentsText({ herdr: herdr(), agents: { herdr: "running" } })).toBe(
      "No agents are running in herdr.",
    );
    expect(
      herdrNoAgentsText({
        herdr: herdr({ state: "off" }, false),
        agents: { herdr: "not-running" },
      }),
    ).toBe("herdr is not running.");
    expect(herdrNoAgentsText({ agents: { herdr: "not-running" } })).toBe("herdr is not running.");
    expect(herdrNoAgentsText({ agents: { herdr: "running" } })).toBe(
      "No agents are running in herdr.",
    );
  });
});

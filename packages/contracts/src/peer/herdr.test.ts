import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { PeerHubStatus } from "../peerHub.ts";
import { PeerHerdrStatus, PeerHubFocusAgentInput } from "./herdr.ts";

const decodeHubStatus = Schema.decodeUnknownSync(PeerHubStatus);
const decodeHerdrStatus = Schema.decodeUnknownSync(PeerHerdrStatus);
const decodeFocusAgentInput = Schema.decodeUnknownSync(PeerHubFocusAgentInput);

const status = {
  hubUrl: "https://hub.example.test",
  signedIn: false,
  email: null,
  pendingSignIn: null,
  workspaces: [],
  joinable: [],
  workspaceRoot: "",
  environmentId: "computer",
  agents: { herdr: "not-running", list: [] },
  github: { cli: false, account: null, signIn: null, error: null },
  coordination: {
    enabled: false,
    policy: "coordinate",
    claudeHooks: false,
    logPath: "",
    sessions: [],
    overlaps: [],
    findings: [],
    contexts: [],
    candidates: [],
  },
  sharedThreads: [],
  syncing: false,
  lastSyncAt: null,
  error: null,
};

describe("herdr runtime wire contracts", () => {
  it("decodes a status without the herdr field, and with one", () => {
    expect(decodeHubStatus(status).herdr).toBeUndefined();
    const herdr = {
      bundled: true,
      runtime: {
        source: "peer",
        state: "running",
        version: "0.9.3",
        bundledVersion: "0.9.3",
        agents: 2,
        resumable: 1,
        otherRunning: false,
        attachCommand: "herdr --session peer-01234567",
      },
      integrations: [
        { agent: "claude", state: "installed", files: ["~/.claude/settings.json"] },
        { agent: "codex", state: "unavailable", reason: "python3 was not found", files: [] },
      ],
    };
    expect(decodeHerdrStatus(herdr)).toEqual(herdr);
    expect(decodeHubStatus({ ...status, herdr }).herdr?.runtime.state).toBe("running");
    expect(() =>
      decodeHerdrStatus({
        ...herdr,
        runtime: { ...herdr.runtime, source: "elsewhere" },
      }),
    ).toThrow();
  });

  it("decodes a focus input from a client that predates openWindow", () => {
    expect(decodeFocusAgentInput({ paneId: "w1:p1" })).toEqual({
      paneId: "w1:p1",
    });
    expect(decodeFocusAgentInput({ paneId: "w1:p1", openWindow: true })).toEqual({
      paneId: "w1:p1",
      openWindow: true,
    });
  });
});

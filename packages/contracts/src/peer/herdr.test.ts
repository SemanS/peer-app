import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { PeerHubStatus } from "../peerHub.ts";
import { PeerHerdrStatus, PeerHubFocusAgentInput } from "./herdr.ts";

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
    expect(Schema.decodeUnknownSync(PeerHubStatus)(status).herdr).toBeUndefined();
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
    expect(Schema.decodeUnknownSync(PeerHerdrStatus)(herdr)).toEqual(herdr);
    expect(Schema.decodeUnknownSync(PeerHubStatus)({ ...status, herdr }).herdr?.runtime.state).toBe(
      "running",
    );
    expect(() =>
      Schema.decodeUnknownSync(PeerHerdrStatus)({
        ...herdr,
        runtime: { ...herdr.runtime, source: "elsewhere" },
      }),
    ).toThrow();
  });

  it("decodes a focus input from a client that predates openWindow", () => {
    expect(Schema.decodeUnknownSync(PeerHubFocusAgentInput)({ paneId: "w1:p1" })).toEqual({
      paneId: "w1:p1",
    });
    expect(
      Schema.decodeUnknownSync(PeerHubFocusAgentInput)({ paneId: "w1:p1", openWindow: true }),
    ).toEqual({ paneId: "w1:p1", openWindow: true });
  });
});

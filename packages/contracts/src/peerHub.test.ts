import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { PeerHubStatus } from "./peerHub.ts";
import { PeerWorkThread } from "./peer/base.ts";

const decodeStatus = Schema.decodeUnknownSync(PeerHubStatus);

/** A signed-in environment's status as a Peer from before the Hub's own words sends it. */
const statusBeforeHubInfo = {
  hubUrl: "https://hub.example.com",
  signedIn: true,
  email: "ana@acme.dev",
  pendingSignIn: null,
  workspaces: [],
  joinable: [],
  workspaceRoot: "/home/ana/Peer",
  environmentId: "ana-laptop",
  agents: { herdr: "not-running", list: [] },
  github: { cli: false, account: null, signIn: null, error: null },
  coordination: {
    enabled: false,
    policy: "coordinate",
    claudeHooks: false,
    logPath: "/home/ana/.t3/userdata/logs/coordination.jsonl",
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

describe("what the signed-in Hub says of itself in the status", () => {
  it("is absent from the status of an environment that has read nothing of it", () => {
    expect(decodeStatus(statusBeforeHubInfo).hub).toBeUndefined();
  });

  it("carries the build, the features it serves and the ones its operator turned off", () => {
    const { hub } = decodeStatus({
      ...statusBeforeHubInfo,
      hub: {
        version: "0.8.4",
        commit: "a6bde95",
        features: { requests: 1, settings: 1 },
        featuresOff: ["resources"],
      },
    });
    expect(hub).toEqual({
      version: "0.8.4",
      commit: "a6bde95",
      features: { requests: 1, settings: 1 },
      featuresOff: ["resources"],
    });
  });

  it("takes a Hub that says less: one before the list of what is off, or before the catalog", () => {
    expect(
      decodeStatus({ ...statusBeforeHubInfo, hub: { features: { requests: 1 } } }).hub,
    ).toEqual({ features: { requests: 1 } });
    expect(decodeStatus({ ...statusBeforeHubInfo, hub: {} }).hub).toEqual({});
  });

  it("keeps the ids of features this client has never heard of", () => {
    const { hub } = decodeStatus({
      ...statusBeforeHubInfo,
      hub: { features: { telepathy: 2 }, featuresOff: ["clairvoyance"] },
    });
    expect(hub?.features?.telepathy).toBe(2);
    expect(hub?.featuresOff).toEqual(["clairvoyance"]);
  });
});

describe("the VCS kind of a listed work thread", () => {
  const thread = {
    id: "peer:t1",
    title: "Split payments",
    email: "ana@acme.dev",
    status: "working",
    source: "peer",
    environment: "ana-laptop",
    seenAt: "2026-10-18T09:00:00.000Z",
  } as const;
  const decode = Schema.decodeUnknownSync(PeerWorkThread);
  const encode = Schema.encodeSync(PeerWorkThread);

  it("decodes and encodes with Jujutsu's kind, and without one as before", () => {
    expect(decode({ ...thread, vcs: "jj" }).vcs).toBe("jj");
    expect(encode(decode({ ...thread, vcs: "jj" }))).toMatchObject({ vcs: "jj" });
    const before = decode(thread);
    expect(before.vcs).toBeUndefined();
    expect("vcs" in encode(before)).toBe(false);
  });
});

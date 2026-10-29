import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  PeerHubStatus,
  PeerWorkspaceMembers,
  PeerHubCreateTaskResult,
  PeerHubInviteResult,
} from "./peerHub.ts";
import { isExecutable, PeerTask, PeerWorkThread, taskKind } from "./peer/base.ts";

const decodeStatus = Schema.decodeUnknownSync(PeerHubStatus);
const decodeTaskReceipt = Schema.decodeUnknownSync(PeerHubCreateTaskResult);
const decodeInviteReceipt = Schema.decodeUnknownSync(PeerHubInviteResult);

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

describe("organizations and invitations across versions", () => {
  it("reads a status without foundings, and one with them and a hub administrator", () => {
    expect(decodeStatus(statusBeforeHubInfo).foundings).toBeUndefined();
    const decoded = decodeStatus({
      ...statusBeforeHubInfo,
      hubAdmin: true,
      foundings: [{ slug: "vocabulift", name: "Vocabulift" }],
    });
    expect(decoded.hubAdmin).toBe(true);
    expect(decoded.foundings).toEqual([{ slug: "vocabulift", name: "Vocabulift" }]);
  });

  it("reads an older Hub's members list and a newer Hub's invitation states", () => {
    const decodeMembers = Schema.decodeUnknownSync(PeerWorkspaceMembers);
    const older = decodeMembers({
      members: [],
      invites: [{ email: "bob@acme.dev", role: "member", invitedBy: "ana@acme.dev" }],
    });
    expect(older.invites[0]?.status).toBeUndefined();
    const newer = decodeMembers({
      members: [],
      invites: [
        {
          email: "bob@acme.dev",
          role: "member",
          invitedBy: "ana@acme.dev",
          invitedAt: "2026-10-20T00:00:00Z",
          status: "pending",
          expiresAt: "2026-11-03T00:00:00Z",
          delivery: { state: "failed", attempts: 1, lastAttemptAt: null, error: "bounced" },
          projects: [],
        },
      ],
    });
    expect(newer.invites[0]?.delivery?.error).toBe("bounced");
  });
});

describe("additive task creation and invitation receipts", () => {
  it("keeps older environments readable without guessing a created task", () => {
    expect(decodeTaskReceipt(statusBeforeHubInfo).createdTask).toBeUndefined();
    expect(decodeInviteReceipt(statusBeforeHubInfo).delivery).toBeUndefined();
  });

  it("retains creation identity and failed email delivery while older clients can read status", () => {
    const createdTask = {
      id: "mine",
      title: "Feature",
      status: "open",
      createdBy: "ana@acme.test",
      createdAt: "now",
      updatedAt: "now",
    };
    const taskReceipt = { ...statusBeforeHubInfo, createdTask };
    expect(decodeTaskReceipt(taskReceipt).createdTask?.id).toBe("mine");
    expect(decodeStatus(taskReceipt)).toEqual(decodeStatus(statusBeforeHubInfo));
    const delivery = { state: "failed", error: "SMTP unavailable" };
    const inviteReceipt = { ...statusBeforeHubInfo, delivery };
    expect(decodeInviteReceipt(inviteReceipt).delivery).toEqual(delivery);
    expect(decodeStatus(inviteReceipt)).toEqual(decodeStatus(statusBeforeHubInfo));
  });
});

describe("a task's place in the tree", () => {
  const decodeTask = Schema.decodeUnknownSync(PeerTask);
  const older = {
    id: "t1",
    title: "Feature",
    status: "open",
    createdBy: "ana@acme.test",
    createdAt: "now",
    updatedAt: "now",
  };

  it("reads an older Hub's task as a root task that runs as one", () => {
    const task = decodeTask(older);
    expect(task.parent).toBeUndefined();
    expect(taskKind(task)).toBe("task");
    expect(isExecutable(task)).toBe(true);
  });

  it("reads the tree's fields and drops what this build does not know", () => {
    const task = decodeTask({
      ...older,
      parent: "t0",
      kind: "group",
      unsettled: true,
      position: 2,
      source: { system: "openspec", ref: "add-x#1" },
      progress: { done: 1, total: 3 },
      laterField: { anything: true },
    });
    expect(task).not.toHaveProperty("laterField");
    expect(task.progress).toEqual({ done: 1, total: 3 });
    expect(isExecutable(task)).toBe(false);
    expect(isExecutable({ kind: "group", executable: true })).toBe(true);
    expect(isExecutable({ kind: "task", executable: false })).toBe(false);
  });
});

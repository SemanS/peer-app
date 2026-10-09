import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { PeerHubStatus, PeerOverlap } from "../peerHub.ts";
import {
  needsYouKey,
  needsYouPushId,
  isNeedsYouPushId,
  overlapAttention,
  PeerNeedsYouStatus,
  PeerHubSubscribeInput,
  OVERLAP_ASKED_MS,
  OVERLAP_RECENT_MS,
} from "./needs-you.ts";

const now = Date.parse("2026-10-09T12:00:00Z");
const ago = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(now - ms));
const overlap = (extra: object = {}) => ({
  state: "open" as const,
  updatedAt: ago(OVERLAP_RECENT_MS),
  notes: [],
  policy: "ask",
  ...extra,
});
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

describe("Needs you identities and overlap attention", () => {
  it("keeps identities stable and distinct for kinds and escaped segments", () => {
    const keys = [
      needsYouKey.thread("env", "id"),
      needsYouKey.agent("env", "id"),
      needsYouKey.request("env", "id"),
      needsYouKey.overlap("env", "project", "id"),
      needsYouKey.stale("env", "id"),
    ];
    expect(new Set(keys).size).toBe(5);
    expect(needsYouKey.request("env", "id")).toBe(keys[2]);
    expect(needsYouKey.agent("a/b", "c")).not.toBe(needsYouKey.agent("a", "b/c"));
    expect(needsYouPushId(keys[0]!)).toBeNull();
    for (const key of keys.slice(1)) {
      const id = needsYouPushId(key);
      expect(id).toMatch(/^peer-needs-you\.(agent|request|overlap|stale)\.[a-f0-9]{16}$/);
      expect(isNeedsYouPushId(id!)).toBe(true);
      expect(`/threads/${"e".repeat(200)}/${id}`.length).toBeLessThan(512);
      expect(needsYouPushId(key)).toBe(id);
    }
    expect(isNeedsYouPushId("peer-needs-you.thread.0000000000000000")).toBe(false);
    expect(isNeedsYouPushId("peer-needs-you.request.nope")).toBe(false);
  });
  it("uses exact requested and recent deadlines, resolution and policy", () => {
    expect(overlapAttention(overlap({ state: "resolved" }), now)).toBe("settled");
    expect(overlapAttention(overlap({ askedAt: ago(OVERLAP_ASKED_MS - 1) }), now)).toBe(
      "requested",
    );
    expect(overlapAttention(overlap({ askedAt: ago(OVERLAP_ASKED_MS) }), now)).toBe("unanswered");
    expect(overlapAttention(overlap({ updatedAt: ago(OVERLAP_RECENT_MS - 1) }), now)).toBe(
      "recent",
    );
    expect(overlapAttention(overlap({ notes: [{ at: ago(1) }] }), now)).toBe("recent");
    expect(overlapAttention(overlap({ filesAt: ago(1) }), now)).toBe("recent");
    expect(overlapAttention(overlap(), now)).toBe("decide");
    for (const policy of ["notify", "coordinate", "off", "future", undefined])
      expect(overlapAttention(overlap({ policy }), now)).toBe("quiet");
    expect(overlapAttention(overlap({ updatedAt: ago(-1) }), now)).toBe("recent");
  });
  it("lets old clients and servers ignore additive status and scope fields", () => {
    const fragment = {
      alerts: { enabled: false, delivery: "not-linked" },
      staleInputs: [
        {
          session: "claude:1",
          since: ago(0),
          scopes: [{ scope: "task:1", readVersion: 2, currentVersion: null }],
        },
      ],
    };
    expect(Schema.decodeUnknownSync(PeerNeedsYouStatus)(fragment)).toEqual(fragment);
    expect(Schema.decodeUnknownSync(PeerHubStatus)(status).needsYou).toBeUndefined();
    const { needsYou: _needsYou, ...oldFields } = PeerHubStatus.fields;
    expect(
      Schema.decodeUnknownSync(Schema.Struct(oldFields))({ ...status, needsYou: fragment }),
    ).not.toHaveProperty("needsYou");
    expect(Schema.decodeUnknownSync(PeerHubSubscribeInput)({ scope: "needs-you" })).toEqual({
      scope: "needs-you",
    });
    expect(() => Schema.decodeUnknownSync(Schema.Struct({}))({ scope: "needs-you" })).not.toThrow();
    const oldOverlap = {
      ...overlap(),
      id: "o",
      workspace: "w",
      project: "p",
      sessions: [],
      files: [],
    };
    expect(Schema.decodeUnknownSync(PeerOverlap)(oldOverlap).policy).toBe("ask");
    expect(
      Schema.decodeUnknownSync(PeerOverlap)({ ...oldOverlap, policy: undefined }).policy,
    ).toBeUndefined();
  });
});

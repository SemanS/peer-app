import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  PeerCoordEvent,
  PeerCoordinationState,
  PeerDecision,
  PeerOverlap,
  PeerOverlapRecord,
} from "../peerHub.ts";
import { PeerResourcesState } from "./resources.ts";

const decodeDecision = Schema.decodeUnknownSync(PeerDecision);
const decodeOverlap = Schema.decodeUnknownSync(PeerOverlap);
const decodeRecord = Schema.decodeUnknownSync(PeerOverlapRecord);
const decodeEvent = Schema.decodeUnknownSync(PeerCoordEvent);
const decodeResources = Schema.decodeUnknownSync(PeerResourcesState);

const record = {
  id: "abc123def456",
  project: "app",
  sessions: ["claude:ana", "claude:bob"],
  files: ["payments/webhooks.ts"],
  state: "open",
  notes: [],
  openedAt: "2026-10-11T10:00:00Z",
  updatedAt: "2026-10-11T10:00:00Z",
};
const event = {
  id: "one",
  kind: "overlap",
  project: "app",
  at: "2026-10-11T10:00:00Z",
  paths: ["payments/webhooks.ts"],
  participants: ["claude:ana"],
};

describe("what decided a request", () => {
  it("reads what the Hub writes: the policy and who set it, a rule's pattern and path rules left off", () => {
    expect(decodeDecision({ policy: "coordinate", source: "project" })).toEqual({
      policy: "coordinate",
      source: "project",
    });
    expect(
      decodeDecision({ policy: "exclusive", source: "project", pattern: "migrations/**" }),
    ).toEqual({ policy: "exclusive", source: "project", pattern: "migrations/**" });
    expect(decodeDecision({ policy: "ask", source: "client", pathRulesOff: true })).toEqual({
      policy: "ask",
      source: "client",
      pathRulesOff: true,
    });
  });

  it("does not let a policy of a newer Hub cost the view, and drops what it adds", () => {
    expect(decodeDecision({ policy: "lockstep", source: "project", kept: "no" })).toEqual({
      policy: "lockstep",
      source: "project",
    });
    expect(() => decodeDecision({ policy: "ask", source: "workspace" })).toThrow();
  });

  it("is optional on an overlap and on a ledger event, which an older Hub sends without it", () => {
    const decision = { policy: "ask", source: "client" } as const;
    expect(decodeRecord(record).decision).toBeUndefined();
    expect(decodeRecord({ ...record, decision }).decision).toEqual(decision);
    expect(decodeEvent(event).decision).toBeUndefined();
    expect(decodeEvent({ ...event, decision }).decision).toEqual(decision);
    // The status carries it on to the page as it came.
    const shown = { ...record, workspace: "acme" };
    expect(decodeOverlap(shown).decision).toBeUndefined();
    expect(decodeOverlap({ ...shown, decision }).decision).toEqual(decision);
  });
});

describe("what the coordination status says of policies and path rules", () => {
  const { policies, ...rest } = PeerCoordinationState.fields;
  const withoutPolicies = Schema.decodeUnknownSync(Schema.Struct(rest));
  const coordination = {
    enabled: true,
    policy: "coordinate",
    claudeHooks: true,
    logPath: "/tmp/coordination.jsonl",
    sessions: [],
    overlaps: [],
    findings: [],
    contexts: [],
    candidates: [],
  };

  it("lists each workspace's project policies, and nothing for an environment from before them", () => {
    expect(policies).toBeDefined();
    const decode = Schema.decodeUnknownSync(PeerCoordinationState);
    expect(decode(coordination).policies).toBeUndefined();
    const named = { acme: { booking: "coordinate" }, other: {} };
    expect(decode({ ...coordination, policies: named }).policies).toEqual(named);
    expect(withoutPolicies({ ...coordination, policies: named })).not.toHaveProperty("policies");
  });

  it("counts path rules by project in the resources slice, and reads a slice without counts", () => {
    expect(decodeResources({ held: [] }).pathRules).toBeUndefined();
    const counted = { held: [], pathRules: [{ workspace: "acme", project: "booking", count: 3 }] };
    expect(decodeResources(counted)).toEqual(counted);
  });
});

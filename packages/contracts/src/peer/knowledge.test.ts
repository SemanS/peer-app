import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import {
  PeerKnowledgeCandidate,
  PeerHubCandidateInput,
  PeerHubDecideCandidateInput,
  PeerHubKeepCandidateInput,
  PeerHubDecideChallengeInput,
  PeerHubOpenChallengeInput,
  PeerKnowledgeChallenge,
  isCandidateKept,
} from "./knowledge.ts";
const decode = Schema.decodeUnknownSync(PeerKnowledgeCandidate);
const decodeDecision = Schema.decodeUnknownSync(PeerHubDecideCandidateInput);
const decodeKeep = Schema.decodeUnknownSync(PeerHubKeepCandidateInput);
// The previous keep input, as an older app server decodes it.
const decodeOlderKeep = Schema.decodeUnknownSync(PeerHubCandidateInput);
const candidate = {
  id: "c",
  project: "app",
  text: "Retry",
  sources: [],
  finders: 1,
  firstAt: "2026-10-09T00:00:00Z",
  lastAt: "2026-10-09T00:00:00Z",
};
describe("knowledge candidate review lane", () => {
  it("reads all four persisted states while keeping decision input three-valued", () => {
    for (const status of ["proposed", "dismissed", "promoted", "kept_pending_review"]) {
      expect(decode({ ...candidate, status }).status).toBe(status);
    }
    expect(() => decode({ ...candidate, status: "future" })).toThrow();
    expect(
      ["proposed", "dismissed", "promoted", "kept_pending_review"].map((status) =>
        isCandidateKept(decode({ ...candidate, status }).status),
      ),
    ).toEqual([false, false, true, true]);
    expect(() =>
      decodeDecision({
        workspace: "acme",
        project: "app",
        id: "c",
        status: "kept_pending_review",
      }),
    ).toThrow();
  });
});
describe("keeping an edited candidate", () => {
  const place = { workspace: "acme", project: "app", id: "c" };
  it("keeps the candidate's own text without `text` and the person's words with it", () => {
    expect(decodeKeep(place)).toEqual(place);
    expect(decodeKeep({ ...place, text: "  Prices are integer cents.  " })).toEqual({
      ...place,
      text: "Prices are integer cents.",
    });
    expect(() => decodeKeep({ ...place, text: "   " })).toThrow();
    expect(() => decodeKeep({ ...place, text: "x".repeat(2001) })).toThrow();
  });
  it("lets an older server ignore the edited text", () => {
    expect(decodeOlderKeep({ ...place, text: "Prices are cents." })).toEqual(place);
  });
});
describe("knowledge challenges", () => {
  const decodeChallenge = Schema.decodeUnknownSync(PeerKnowledgeChallenge);
  const decodeOpen = Schema.decodeUnknownSync(PeerHubOpenChallengeInput);
  const decodeDecide = Schema.decodeUnknownSync(PeerHubDecideChallengeInput);
  const challenge = {
    id: "ch1",
    project: "app",
    entry: "2026-10-04-prices-in-cents",
    reason: "formatPrice takes decimals",
    sources: [],
    finders: 2,
    people: ["ana@acme.test"],
    status: "open",
    firstAt: "2026-10-09T00:00:00Z",
    lastAt: "2026-10-09T00:00:00Z",
  };
  it("reads the Hub's four states and its optional fields", () => {
    for (const status of ["open", "dismissed", "resolving", "resolved"]) {
      expect(decodeChallenge({ ...challenge, status }).status).toBe(status);
    }
    expect(() => decodeChallenge({ ...challenge, status: "future" })).toThrow();
    expect(
      decodeChallenge({
        ...challenge,
        entryRevision: "r1",
        resolvedAs: { path: ".ai/x.md", title: "X", kind: "decision" },
      }).resolvedAs?.path,
    ).toBe(".ai/x.md");
  });
  it("bounds a person's reason and refuses an empty one", () => {
    const place = { workspace: "acme", project: "app", entry: "e" };
    expect(decodeOpen({ ...place, reason: "  stale  " }).reason).toBe("stale");
    expect(() => decodeOpen({ ...place, reason: " " })).toThrow();
    expect(() => decodeOpen({ ...place, reason: "x".repeat(301) })).toThrow();
  });
  it("decides with one of five decisions", () => {
    const place = { workspace: "acme", project: "app", id: "ch1" };
    expect(decodeDecide({ ...place, decision: "retire" }).decision).toBe("retire");
    expect(() => decodeDecide({ ...place, decision: "promoted" })).toThrow();
  });
  it("reads a candidate's stale mark, and its absence from an older Hub", () => {
    expect(decode({ ...candidate, status: "proposed", stale: true }).stale).toBe(true);
    expect(decode({ ...candidate, status: "proposed" }).stale).toBeUndefined();
  });
});

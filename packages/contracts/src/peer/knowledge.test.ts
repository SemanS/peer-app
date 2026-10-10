import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import {
  PeerKnowledgeCandidate,
  PeerHubCandidateInput,
  PeerHubDecideCandidateInput,
  PeerHubKeepCandidateInput,
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

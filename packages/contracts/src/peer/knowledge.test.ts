import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import {
  PeerKnowledgeCandidate,
  PeerHubDecideCandidateInput,
  isCandidateKept,
} from "./knowledge.ts";
const decode = Schema.decodeUnknownSync(PeerKnowledgeCandidate);
const decodeDecision = Schema.decodeUnknownSync(PeerHubDecideCandidateInput);
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

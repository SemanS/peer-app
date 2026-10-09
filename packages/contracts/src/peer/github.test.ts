import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { PeerGitHubStatus, PeerGitHubEvidence } from "./github.ts";
import { PeerWorkPullRequest } from "./base.ts";
const evidence = {
  state: "merged",
  headBranch: "feature/test",
  baseBranch: "peer",
  updatedAt: "2026-10-09T10:00:00Z",
  verifiedAt: "2026-10-09T10:01:00Z",
  mergedAt: "2026-10-09T10:00:00Z",
  mergeCommit: "123456789",
};
const decodePr = Schema.decodeUnknownSync(PeerWorkPullRequest);
const decodeStatus = Schema.decodeUnknownSync(PeerGitHubStatus);
const decodeEvidence = Schema.decodeUnknownSync(PeerGitHubEvidence);
describe("GitHub delivery contracts", () => {
  it("keeps reported state and accepts evidence without persisting unknown payload fields", () => {
    const pr = {
      url: "https://github.com/acme/app/pull/12",
      state: "open",
      headBranch: "feature/test",
    };
    expect(decodePr(pr).github).toBeUndefined();
    const decoded = decodePr({ ...pr, github: { ...evidence, title: "private" } });
    expect(decoded.state).toBe("open");
    expect(decoded.github?.state).toBe("merged");
    expect(decodeEvidence({ ...evidence, title: "private" })).not.toHaveProperty("title");
  });
  it("accepts member and administrator status including nullable times and non-GitHub coverage", () => {
    const status = {
      configured: true,
      webhookPath: "/v1/workspaces/acme/github/webhook",
      lastPingAt: null,
      lastVerifiedAt: null,
      repositories: [{ project: "web", repository: "app", github: null }],
    };
    expect(decodeStatus(status).secret).toBeUndefined();
    expect(decodeStatus({ ...status, secret: "present", future: true }).secret).toBe("present");
  });
});

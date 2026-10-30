import { describe, expect, it } from "@effect/vitest";
import type { UsageProviderKind, UsageSource } from "@t3tools/contracts";

import { transcriptSourceFailed } from "./usageSessionTotals.ts";

const source = (provider: UsageProviderKind, status: UsageSource["status"]) =>
  ({ status, fingerprint: { provider } }) as UsageSource;

describe("a read that lost a transcript source", () => {
  it("is a failed Claude or Codex source", () => {
    expect(transcriptSourceFailed([source("claude", "ok"), source("claude", "failed")])).toBe(true);
    expect(transcriptSourceFailed([source("codex", "failed")])).toBe(true);
  });

  it("is not a partial one, or any other provider's", () => {
    expect(
      transcriptSourceFailed([
        source("claude", "partial"),
        source("codex", "missing"),
        source("cursor", "partial"),
        source("cursor", "failed"),
        source("antigravity", "failed"),
      ]),
    ).toBe(false);
  });
});

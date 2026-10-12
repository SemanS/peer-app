import { describe, it, expect } from "vite-plus/test";
import { CATALOG, project, metricsOf, reasonClassOf } from "./metricsCatalog.ts";
import { PeerHubError } from "@t3tools/contracts";
describe("catalog projection", () => {
  it("projects impact sizes and state without symbol names, roots, diffs, uses or contracts", () => {
    const detail = {
      session: "claude:a",
      changed: 2,
      uses: 3,
      deferred: false,
      state: "ready",
      root: "/private/source",
      name: "privateSymbol",
      contract: "private contract",
      source: "private diff",
    };
    expect(project("impact.check", detail)).toEqual({
      session: "claude:a",
      changed: 2,
      uses: 3,
      deferred: false,
      state: "ready",
    });
    expect(project("impact.report", { ...detail, sessions: 1, success: true })).toEqual({
      session: "claude:a",
      sessions: 1,
      changed: 2,
      uses: 3,
      success: true,
    });
    expect(project("impact.told", { ...detail, chars: 700 })).toEqual({
      session: "claude:a",
      chars: 700,
    });
  });
  it("projects ownership's kinds, places and outcomes, and never a path, a name, a reason or a note", () => {
    const detail = {
      session: "claude:a",
      path: "src/payments/fees.ts",
      email: "ana@acme.test",
      reason: "add a refund fee field",
      note: "keep fees in cents",
    };
    expect(project("ownership.stopped", { ...detail, where: "edit" })).toEqual({
      session: "claude:a",
      where: "edit",
    });
    expect(project("ownership.told", { ...detail, kind: "decision", chars: 210 })).toEqual({
      session: "claude:a",
      kind: "decision",
      chars: 210,
    });
    expect(project("ownership.call", { ...detail, outcome: "asked" })).toEqual({
      session: "claude:a",
      outcome: "asked",
    });
    // A kind, a place or an outcome that is not one of the named ones is dropped.
    expect(project("ownership.stopped", { where: "src/payments/fees.ts" })).toEqual({});
    expect(project("ownership.call", { outcome: "Ana accepted" })).toEqual({});
  });
  it("never accepts hostile content for any declared field", () => {
    const hostile = [
      "/tmp/SENTINEL/path",
      "a@example.test",
      "SENTINEL TITLE",
      "x".repeat(10000),
      NaN,
      -1,
      0.5,
      { text: "SENTINEL" },
      Array(100).fill("SENTINEL"),
    ];
    for (const [event, kinds] of Object.entries(CATALOG))
      for (const field of Object.keys(kinds))
        for (const value of hostile) {
          const out = JSON.stringify(project(event, { [field]: value }));
          expect(out).not.toMatch(/SENTINEL|\/tmp|@example|TITLE|NaN/);
        }
    expect(project("unknown", { session: "known", text: "secret" })).toEqual({});
    expect(
      project("session.started", { task: "SENTINEL-TITLE", session: "claude:1" }),
    ).toMatchObject({ session: "claude:1", task: expect.stringMatching(/^t_[0-9a-f]{12}$/) });
  });
  it("converts old details into separate sizes and classes without losing intent and provider counts", () => {
    expect(
      project(
        "intent",
        metricsOf("intent", {
          verdicts: [{ path: "private", verdict: "deny" }],
          files: ["private"],
          ms: 5,
        }),
      ),
    ).toMatchObject({ verdictCounts: { deny: 1 }, fileCount: 1, ms: 5 });
    expect(
      project(
        "cli",
        metricsOf("cli", { command: "ask", args: ["private"], out: "private", outcome: "done" }),
      ),
    ).toMatchObject({ command: "other", argCount: 1, outBytes: 7, outcome: "ok" });
    expect(
      project(
        "provider.usage",
        metricsOf("provider.usage", {
          usage: {
            input_tokens: 2,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 4,
            output_tokens: 5,
          },
        }),
      ),
    ).toMatchObject({ inputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, outputTokens: 5 });
    expect(reasonClassOf(new PeerHubError({ detail: "private", code: "stale_context" }))).toBe(
      "refused",
    );
  });
  it("logs Peer's herdr runtime as classes and counts, never paths, commands or environment", () => {
    const detail = {
      source: "peer",
      version: "0.9.3",
      fromVersion: "0.9.2",
      agents: 2,
      reasonClass: "upgrade",
      path: "/Users/ana/.peer/herdr/config.toml",
      command: "HERDR_CONFIG_PATH='/Users/ana/.peer/herdr/config.toml' herdr --session peer-1",
      env: { HOME: "/Users/ana" },
      reason: "herdr exited right after it started (code 1). See /Users/ana/log",
      text: "terminal text",
    };
    for (const event of [
      "started",
      "adopted",
      "stopped",
      "restarted",
      "upgraded",
      "failed",
    ] as const) {
      expect(project(`herdr.runtime.${event}`, detail)).toEqual({
        source: "peer",
        version: "0.9.3",
        fromVersion: "0.9.2",
        agents: 2,
        reasonClass: "upgrade",
      });
    }
    expect(
      project("herdr.runtime.failed", { source: "peer", agents: 0, reasonClass: "/etc/passwd" }),
    ).toEqual({ source: "peer", agents: 0 });
  });
});

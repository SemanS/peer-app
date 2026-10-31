import { assert, describe, it } from "@effect/vitest";

import { startArgs } from "./start.ts";

describe("startArgs", () => {
  it("lets the agent into a run's other projects, for both harnesses", () => {
    for (const harness of ["claude", "codex"] as const) {
      assert.deepStrictEqual(startArgs({ harness, dirs: ["/w/site", "/w/api"] }), [
        "--add-dir",
        "/w/site",
        "--add-dir",
        "/w/api",
      ]);
    }
  });

  it("passes nothing for a plain start", () => {
    assert.deepStrictEqual(startArgs({ harness: "claude" }), []);
  });

  it("says effort each harness's way", () => {
    assert.deepStrictEqual(startArgs({ harness: "claude", effort: "high" }), ["--effort", "high"]);
    assert.deepStrictEqual(startArgs({ harness: "codex", effort: "high" }), [
      "-c",
      'model_reasoning_effort="high"',
    ]);
  });

  it("puts the model before a resume, for either harness", () => {
    const resume = { agent: "codex", session: "s1" };
    assert.deepStrictEqual(startArgs({ harness: "codex", model: "gpt-6.1", resume }), [
      "--model",
      "gpt-6.1",
      "resume",
      "s1",
    ]);
  });
});

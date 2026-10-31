import { assert, describe, it } from "@effect/vitest";

import { startArgs } from "./start.ts";

describe("startArgs", () => {
  it("passes nothing for a plain start", () => {
    assert.deepStrictEqual(startArgs({ harness: "claude" }), []);
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

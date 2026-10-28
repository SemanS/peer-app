import { assert, describe, it } from "@effect/vitest";

import { isFlow, trail } from "./flows.ts";

const BODY = `This is the path a read takes.

## Trail

### Request
1. [[use-cache]] — Settles that reads are cached.
2. [[cache-warms-late]] — Bites on the first read.

### Answer
3. [[2026-10-14-answers-are-streamed|Streamed]] - Streams the answer.
4) [[no-such-entry]]
not a step
5. [[\`late\`]] — ignored, not an id

## Notes
6. [[outside-the-trail]] — after the trail, not a step
`;

describe("flows", () => {
  it("recognises a flow by its id or tag, never by kind alone", () => {
    assert.isTrue(isFlow({ id: "flow-read", kind: "architecture" }));
    assert.isTrue(isFlow({ id: "reads", kind: "architecture", tags: ["flow", "cache"] }));
    assert.isFalse(isFlow({ id: "flow-read", kind: "convention" }));
    assert.isFalse(isFlow({ id: "mod-cache", kind: "architecture", tags: ["module"] }));
  });

  it("reads the steps under ## Trail with their stage, and nothing outside it", () => {
    assert.deepStrictEqual(trail(BODY), [
      { stage: "Request", entry: "use-cache", text: "Settles that reads are cached." },
      { stage: "Request", entry: "cache-warms-late", text: "Bites on the first read." },
      { stage: "Answer", entry: "2026-10-14-answers-are-streamed", text: "Streams the answer." },
      { stage: "Answer", entry: "no-such-entry", text: "" },
    ]);
    assert.deepStrictEqual(trail("No trail here.\n1. [[x]] — a list"), []);
    assert.deepStrictEqual(trail("## Trail\r\n1. [[a]] — one\r\n"), [
      { stage: null, entry: "a", text: "one" },
    ]);
  });

  it("caps a trail at 200 steps", () => {
    const long = `## Trail\n${Array.from({ length: 250 }, (_, i) => `${i + 1}. [[e${i}]] — s`).join("\n")}`;
    assert.strictEqual(trail(long).length, 200);
  });
});

import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { ReviewDiffInput } from "./changes.ts";

const decode = Schema.decodeUnknownSync(ReviewDiffInput);
const base = { workspace: "acme", project: "app", changeId: "l".repeat(32), mode: "since" };

it("decodes a review diff input without a `from`, as an older app sends it", () => {
  assert.isUndefined(decode(base).from);
});

it("decodes a `from` that is a commit id, and refuses one that is not", () => {
  assert.strictEqual(decode({ ...base, from: "a".repeat(40) }).from, "a".repeat(40));
  assert.throws(() => decode({ ...base, from: "main" }));
});

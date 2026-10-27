import { assert, describe, it } from "@effect/vitest";

import { emptyShell, KEPT, remember, seen } from "./evidence.ts";

const AT = Date.parse("2026-10-27T14:02:00.000Z");

describe("seen run by Peer", () => {
  it("marks a command the session ran, passed or failed, as its latest run ended", () => {
    const shell = emptyShell();
    remember(shell, "cargo test features::handoff 2>&1 | head -30", false, AT);
    remember(shell, "vp test run x.test.ts", false, AT);
    remember(shell, "vp test run x.test.ts", true, AT + 60_000);
    assert.deepStrictEqual(seen(shell, "cargo test features::handoff"), {
      failed: false,
      at: "2026-10-27T14:02:00.000Z",
    });
    assert.deepStrictEqual(seen(shell, " vp test run x.test.ts "), {
      failed: true,
      at: "2026-10-27T14:03:00.000Z",
    });
    // A claim Peer did not see stays author-reported.
    assert.isUndefined(seen(shell, "manual check of the login flow"));
    assert.isUndefined(seen(shell, "cargo test"));
  });

  it("keeps only the last commands", () => {
    const shell = emptyShell();
    for (let at = 0; at < KEPT + 5; at++) remember(shell, `echo ${at}`, false, AT + at);
    assert.strictEqual(shell.ran.length, KEPT);
    assert.isUndefined(seen(shell, "echo 0"));
    assert.isDefined(seen(shell, `echo ${KEPT + 4}`));
  });
});

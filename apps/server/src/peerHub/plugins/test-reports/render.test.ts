import { assert, describe, it } from "@effect/vitest";
import type { PeerTestReport } from "@t3tools/contracts";

import { countsOf, replyLines, showText } from "./render.ts";

const report: PeerTestReport = {
  project: "app",
  task: "t-11",
  author: "ana@acme.test",
  number: 2,
  result: "mixed",
  summary: "The contract is in place",
  role: "author",
  at: "2026-10-30T08:52:00Z",
  shortened: false,
  items: [
    {
      kind: "pass",
      text: "pnpm test concurrency",
      seen: { failed: false, at: "2026-10-30T08:50:00Z" },
    },
    { kind: "unverified", text: "the actions consume the contract", task: "t-31" },
    { kind: "unverified", text: "the phone" },
  ],
};

describe("what peer tests says of items left to a task", () => {
  it("counts an item a dependent task covers as owned, and shows which task", () => {
    assert.deepStrictEqual(
      countsOf(report).unowned.map((item) => item.text),
      ["the phone"],
    );
    const reply = replyLines({ label: "SEC-1-1", filed: "mixed", report, changed: true });
    assert.include(reply[0], '2 unverified (1 needs an owner: "the phone")');
    assert.include(reply.at(-1), "@task:<key>");
    const shown = showText(
      "SEC-1-1",
      [report],
      (email) => email,
      (id) => (id === "t-31" ? "SEC-3-1" : id),
    );
    assert.include(shown, "- unverified: the actions consume the contract (left to task SEC-3-1)");
    assert.include(shown, "- unverified: the phone (needs an owner)");
    // Without a task label, the id stands.
    assert.include(
      showText("SEC-1-1", [report], (email) => email),
      "(left to task t-31)",
    );
  });
});

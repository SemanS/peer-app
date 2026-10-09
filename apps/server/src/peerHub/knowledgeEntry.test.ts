import { assert, describe, it } from "@effect/vitest";

import { parseEntry, parseList } from "./knowledgeEntry.ts";

/** An entry of this repository's own `.ai`, as kontext writes it. */
const SEES = `---
id: 2026-10-05-agents-see-the-projects-other-work-and-ask-its-agents
kind: decision
title: Agents see the project's other work and ask its agents before they share a file
status: accepted
date: 2026-10-05
summary: Each agent starts knowing Peer's command and the project's other works (who is at work, where their shared context stands); it reads them with peer context and asks their agents with peer ask.
tags: [peer, agents, coordination, context, clm]
paths: [peer/**, server/src/api/coord.rs, docs/architecture.md]
author: SemanS
---

## Context

In the two-Mac demo, VL2's agent needed to know where VL1 stores speaker names.
`;

describe("reading an entry", () => {
  it("lists what frontmatter lists, with or without brackets and quotes", () => {
    assert.deepStrictEqual(parseList("[peer/**, server/src/api/coord.rs]"), [
      "peer/**",
      "server/src/api/coord.rs",
    ]);
    assert.deepStrictEqual(parseList("[\"a b/**\", 'c.md']"), ["a b/**", "c.md"]);
    assert.deepStrictEqual(parseList("[]"), []);
    assert.deepStrictEqual(parseList(undefined), []);
  });

  it("is what kontext wrote, and nothing without an id and a title", () => {
    const entry = parseEntry(SEES, ".ai/decisions/x.md");
    assert.strictEqual(entry?.kind, "decision");
    assert.strictEqual(entry?.status, "accepted");
    assert.deepStrictEqual(entry?.paths, [
      "peer/**",
      "server/src/api/coord.rs",
      "docs/architecture.md",
    ]);
    assert.include(entry?.body ?? "", "VL2's agent");
    assert.isUndefined(parseEntry("# just a note\n", ".ai/decisions/y.md"));
    // An entry without a kind is read from the folder it is in.
    const bare = parseEntry("---\nid: a\ntitle: A pitfall\n---\nbody\n", ".ai/learnings/a.md");
    assert.strictEqual(bare?.kind, "learning");
  });

  it("carries only a known kind, status and date, and short plain text, whatever the entry says", () => {
    const hidden = String.fromCodePoint(0xe0069, 0xe0067, 0xe006e);
    const entry = parseEntry(
      `---\nid: sneaky\nkind: ${hidden}decision ${"k".repeat(5000)}\nstatus: accepted ${hidden}${"s".repeat(5000)}\ndate: ${hidden}2026-10-04 ${"d".repeat(5000)}\ntitle: ${"t".repeat(5000)}\nsummary: ${"u".repeat(5000)}\ntags: [${Array.from({ length: 50 }, (_, i) => `t${i}`).join(", ")}]\npaths: [${Array.from({ length: 50 }, (_, i) => `src/p${i}.ts`).join(", ")}, ${"z".repeat(500)}]\n---\nbody\n`,
      ".ai/decisions/sneaky.md",
    )!;
    assert.strictEqual(entry.kind, "decision");
    assert.isUndefined(entry.status);
    assert.isUndefined(entry.date);
    assert.isAtMost(entry.title.length, 200);
    assert.isAtMost(entry.summary.length, 400);
    assert.isAtMost(entry.tags.length, 12);
    assert.isAtMost(entry.paths.length, 12);
    // An id that is not an id is no entry.
    assert.isUndefined(parseEntry("---\nid: a b\ntitle: T\n---\n", ".ai/decisions/x.md"));
    assert.isUndefined(parseEntry(`---\nid: ${hidden}x\ntitle: T\n---\n`, ".ai/decisions/x.md"));
  });
});

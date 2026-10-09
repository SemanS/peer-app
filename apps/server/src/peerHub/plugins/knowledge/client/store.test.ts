// @effect-diagnostics nodeBuiltinImport:off - knowledge files in a temporary repository.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import { entryParts } from "../../../knowledgeEntry.ts";
import { projectGuidance, readKnowledge } from "./store.ts";

/** Entries of this repository's own `.ai`, as kontext writes them. */
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

const CONTEXT_FILE = `---
id: keeper-writes-context
kind: learning
title: Only the keeper writes a task context, and a stale write learns what it says now
date: 2026-10-04
summary: A write on an old version is refused with the current text, so a keeper never overwrites a person's restore.
tags: [context, keeper]
paths: [server/src/api/context.rs]
---

Writes carry the version they were made on.
`;

describe("a repository's knowledge on disk", () => {
  it("reads what each folder of .ai holds, and nothing where there is no store", async () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-knowledge-"));
    try {
      assert.deepStrictEqual(await readKnowledge(root), []);
      NodeFS.mkdirSync(NodePath.join(root, ".ai", "decisions"), { recursive: true });
      NodeFS.mkdirSync(NodePath.join(root, ".ai", "learnings"), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(root, ".ai", "decisions", "a.md"), SEES);
      NodeFS.writeFileSync(NodePath.join(root, ".ai", "learnings", "b.md"), CONTEXT_FILE);
      NodeFS.writeFileSync(NodePath.join(root, ".ai", "learnings", "notes.txt"), "not an entry");
      NodeFS.writeFileSync(NodePath.join(root, ".ai", "learnings", "c.md"), "no frontmatter");
      // A file name with spaces or invisible characters is not an entry to point an agent to.
      NodeFS.writeFileSync(NodePath.join(root, ".ai", "learnings", "has space.md"), CONTEXT_FILE);
      NodeFS.writeFileSync(
        NodePath.join(root, ".ai", "learnings", `hid${String.fromCodePoint(0xe0069)}den.md`),
        CONTEXT_FILE,
      );
      // A name in any script is a name: the entry is read, whatever language its people write in.
      NodeFS.writeFileSync(
        NodePath.join(root, ".ai", "learnings", "zaokrúhľovanie.md"),
        CONTEXT_FILE.replace("keeper-writes-context", "zaokrúhľovanie"),
      );
      NodeFS.writeFileSync(
        NodePath.join(root, ".ai", "learnings", "価格.md"),
        CONTEXT_FILE.replace("keeper-writes-context", "価格"),
      );
      const read = await readKnowledge(root);
      assert.deepStrictEqual(read.map((entry) => entry.file).toSorted(), [
        ".ai/decisions/a.md",
        ".ai/learnings/b.md",
        ".ai/learnings/zaokrúhľovanie.md",
        ".ai/learnings/価格.md",
      ]);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the project's guidance in its knowledge", () => {
  it("reads the project's guidance for its agents from its knowledge, newest and not superseded", async () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kx-"));
    try {
      const dir = NodePath.join(root, ".ai", "conventions");
      NodeFS.mkdirSync(dir, { recursive: true });
      const entry = (id: string, date: string, extra: string, body: string) =>
        `---\nid: ${id}\nkind: convention\ntitle: "Marks"\ndate: ${date}\ntags: [peer-skill]\n${extra}---\n\n${body}\n`;
      NodeFS.writeFileSync(
        NodePath.join(dir, "old.md"),
        entry("old", "2026-10-01", "status: superseded\n", "old rule"),
      );
      NodeFS.writeFileSync(
        NodePath.join(dir, "new.md"),
        entry("new", "2026-10-04", "", "Mark how the code behaves."),
      );
      NodeFS.writeFileSync(
        NodePath.join(dir, "other.md"),
        "---\nid: other\ntags: [style]\n---\nnot this",
      );
      assert.deepStrictEqual(await projectGuidance(root), {
        id: "new",
        text: "Mark how the code behaves.",
      });
      assert.strictEqual(entryParts(entry("x", "d", "", "body")).fields.kind, "convention");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});

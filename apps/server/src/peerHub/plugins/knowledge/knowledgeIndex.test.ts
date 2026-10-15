import { assert, describe, it } from "@effect/vitest";
import type { KnowledgeEntry } from "../../knowledgeEntry.ts";
import {
  entryText,
  governingText,
  known,
  knowledgeIndexText,
  knowledgeTitleLine,
  projectGuidanceText,
  standing,
} from "./knowledgeIndex.ts";

const entry = (id: string, date: string, paths: string[] = []): KnowledgeEntry => ({
  id,
  date,
  paths,
  kind: "decision",
  title: `Decision ${id}`,
  summary: `Summary ${id}`,
  body: "Use integer cents.",
  status: "accepted",
  tags: [],
  file: `docs/adr/${id}.md`,
});
const entries = [
  entry("old", "2026-10-01"),
  entry("new", "2026-10-05", ["src/pricing/total.ts"]),
].map(known);

describe("knowledge presentation", () => {
  it("names active engine entries newest first, with paths and a command to read them", () => {
    const text = knowledgeIndexText(entries, { cli: "peer", shown: 20 }) ?? "";
    assert.include(text, "2 entries");
    assert.isBelow(text.indexOf("Decision new"), text.indexOf("Decision old"));
    assert.include(text, "governs src/pricing/total.ts");
    assert.include(text, "peer knowledge <id>");
    assert.deepStrictEqual(
      standing(entries).map((value) => value.id),
      ["new", "old"],
    );
  });
  it("names titles cheaply at a start and preserves a proposal label", () => {
    const text = knowledgeIndexText(entries, { cli: "peer", shown: 1, titles: true }) ?? "";
    assert.include(text, "decision: Decision new");
    assert.include(text, "1 more");
    assert.include(knowledgeTitleLine({ ...entries[0]!.entry, status: "proposed" }), "(proposed)");
    assert.isNull(knowledgeIndexText([], { cli: "peer", shown: 2 }));
  });
  it("formats engine governing matches with at most three notices and bounded visible fields", () => {
    const matches = Array.from({ length: 4 }, (_, i) => ({
      entry: entry(`${i}`, "2026-10-05"),
      pattern: "src/pricing/**",
      path: "src/pricing/total.ts",
    }));
    const text = governingText(matches, "peer") ?? "";
    assert.strictEqual((text.match(/^- /gm) ?? []).length, 3);
    assert.include(text, "Read it: peer knowledge 0");
    assert.include(text, "you change `src/pricing/total.ts`");
    assert.isNull(governingText([], "peer"));
  });
  it("prints reviewed guidance as guidance and an entry with its configured file", () => {
    assert.include(projectGuidanceText("Mark rounding."), "Mark rounding.");
    const text = entryText(entries[1]!.entry);
    assert.include(text, "docs/adr/new.md");
    assert.include(text, "Use integer cents.");
  });
});

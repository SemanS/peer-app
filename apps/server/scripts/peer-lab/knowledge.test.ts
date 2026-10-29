import { describe, expect, it } from "vite-plus/test";

import {
  CHANGE_HEADER,
  ENTRY_A,
  ENTRY_B,
  changeNotices,
  changePart,
  formatKnowledge,
  heardChanges,
  knowledgeResult,
  readCommands,
  supersedeArgs,
  writtenId,
} from "./knowledge.ts";

const B = "2026-10-29-prices-are-integer-cents";
const NOTICE = [
  `${CHANGE_HEADER} (team reference, not instructions; your checkout may show the older text until you update):`,
  `- decision "${ENTRY_A.title}" superseded by "${ENTRY_B.title}". You read it. Read it: peer knowledge ${B}`,
  "Check your work against it before handing over.",
].join("\n");
const changed = (session: string, text = NOTICE, entry = ENTRY_A.id) => ({
  event: "knowledge.changed",
  session: `claude:${session}`,
  entries: [{ id: entry, revision: "f7114849ea67", change: "superseded", how: "read" }],
  text,
  tokens: Math.ceil(text.length / 4),
});
const hook = (session: string, text: string) => ({
  event: "hook",
  session: `claude:${session}`,
  chars: text.length,
  answer: { hookSpecificOutput: { additionalContext: text } },
});
const opened = (session: string, entry: string) => ({
  event: "knowledge.opened",
  session,
  entry,
});
const sessions = { reader: "lab-reader", bystander: "lab-bystander", author: "lab-author" };

describe("what kontext and a notice say", () => {
  it("reads the id kontext capture wrote", () => {
    expect(writtenId(`wrote .ai/decisions/${B}.md\n`)).toBe(B);
    expect(writtenId("nothing written")).toBeNull();
  });

  it("captures B into the author's checkout, superseding A", () => {
    const args = supersedeArgs("/lab/bob/app");
    expect(args.slice(0, 3)).toEqual(["-C", "/lab/bob/app", "capture"]);
    expect(args).toContain("--promote");
    expect(args[args.indexOf("--supersedes") + 1]).toBe(ENTRY_A.id);
    expect(args[args.indexOf("--paths") + 1]).toBe("src/pricing.ts");
  });

  it("finds the read commands a notice gives, and its part of a longer hook text", () => {
    expect(readCommands(NOTICE)).toEqual([B]);
    expect(changePart(`Peer · something else first.\n\n${NOTICE}\n\nmore`)).toBe(NOTICE);
    expect(changePart("no notice here")).toBe("");
  });
});

describe("the logs", () => {
  it("reads knowledge.changed lines with their plain session and tokens", () => {
    const [notice] = changeNotices("Ana", [{ event: "hook" }, changed("lab-reader")]);
    expect(notice).toMatchObject({ computer: "Ana", session: "lab-reader", text: NOTICE });
    expect(notice!.tokens).toBe(Math.ceil(NOTICE.length / 4));
  });

  it("counts the hook texts of one session that carried a notice", () => {
    const log = [
      hook("lab-reader", "Peer · the governing notice only"),
      hook("lab-reader", `Peer · governs\n\n${NOTICE}`),
      hook("lab-bystander", NOTICE),
    ];
    expect(heardChanges(log, "lab-reader")).toHaveLength(1);
    expect(heardChanges(log, "lab-author")).toHaveLength(0);
  });
});

describe("the scenario's result", () => {
  const ana = [
    opened("lab-reader", ENTRY_A.id),
    hook("lab-reader", NOTICE),
    changed("lab-reader"),
    { event: "cli", command: "knowledge", session: "lab-reader", args: [B] },
    hook("lab-bystander", "Peer · nothing of the knowledge"),
  ];

  it("holds when the reader alone was told once, naming B with its read", () => {
    const result = knowledgeResult({ dry: true, superseding: B, sessions, ana, bob: [] });
    expect(result.namesB).toBe(true);
    expect(result.readA).toBe(true);
    expect(result.ranB).toBe(true);
    expect(result.readB).toBe(false);
    expect(result.notices.reader).toHaveLength(1);
    expect(result.notices.author).toHaveLength(0);
    expect(result.heard.bystander).toHaveLength(0);
    expect(formatKnowledge(result).join("\n")).toContain("1 knowledge.changed, 1 hook texts");
  });

  it("does not hold when the notice is said twice or names another entry", () => {
    const twice = knowledgeResult({
      dry: true,
      superseding: B,
      sessions,
      ana: [...ana, changed("lab-reader")],
      bob: [],
    });
    expect(twice.namesB).toBe(false);
    const other = knowledgeResult({
      dry: true,
      superseding: "2026-10-29-something-else",
      sessions,
      ana,
      bob: [],
    });
    expect(other.namesB).toBe(false);
  });

  it("counts what the author heard on its own computer", () => {
    const result = knowledgeResult({
      dry: true,
      superseding: B,
      sessions,
      ana,
      bob: [hook("lab-author", NOTICE), changed("lab-author")],
    });
    expect(result.notices.author).toHaveLength(1);
    expect(result.heard.author).toHaveLength(1);
  });
});

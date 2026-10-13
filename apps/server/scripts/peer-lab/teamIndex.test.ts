import { expect, it } from "vite-plus/test";
import {
  askIndexText,
  askReminderText,
  type BoardEntry,
  indexText,
} from "../../src/peerHub/core/index/text.ts";
import { indexBlocks } from "./teamIndex.ts";

it("finds every index block Peer's texts make, at any hook, and nothing an agent asked for", () => {
  const work: BoardEntry = {
    scope: "task:krk-1",
    handle: "KRK-1",
    name: "KRK-1 · Pricing",
    agents: ["Ana's agent (Claude Code, working, on another computer)"],
    activity: "1 agent: Give price() a VAT rate",
  };
  const hook = (hookEvent: string, additionalContext: string) => ({
    event: "hook",
    session: "codex:bob",
    hookEvent,
    answer: { hookSpecificOutput: { hookEventName: hookEvent, additionalContext } },
  });
  const start = indexText({ works: [work], knowledge: null, now: 0, cli: "peer" })!;
  const knowledgeOnly = indexText({
    works: [],
    knowledge: "Project knowledge, kept in `.ai` by its people (1 entry):",
    now: 0,
    cli: "peer",
  })!;
  const first = askIndexText({ works: [work], changed: false, knowledge: false, cli: "peer" })!;
  const changed = askIndexText({ works: [work], changed: true, knowledge: false, cli: "peer" })!;
  const found = indexBlocks([
    hook("SessionStart", `You are Bob's agent here.\n\n${start}`),
    hook("SessionStart", `You are Bob's agent here.\n\n${knowledgeOnly}`),
    hook("UserPromptSubmit", first),
    hook("PostToolUse", `Peer: Overlap eb843b with Ana's agent on src/pricing.ts.\n\n${changed}`),
    hook("PostToolUse", changed),
    hook("UserPromptSubmit", askReminderText("peer")),
    {
      event: "cli",
      session: "codex:bob",
      out: indexText({ works: [work], knowledge: null, now: 0, cli: "peer", full: true }),
    },
  ]);
  expect(found.blocks.map((block) => [block.hookEvent, block.kind])).toEqual([
    ["SessionStart", "start"],
    ["UserPromptSubmit", "first"],
    ["PostToolUse", "changed"],
    ["PostToolUse", "changed"],
    ["UserPromptSubmit", "reminder"],
  ]);
  expect(found.summary).toBe(
    "SessionStart start, UserPromptSubmit first, PostToolUse changed ×2, UserPromptSubmit reminder",
  );
});

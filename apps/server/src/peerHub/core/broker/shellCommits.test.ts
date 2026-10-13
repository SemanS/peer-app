import { describe, expect, it } from "@effect/vitest";

import { committedPaths } from "../coordination/edits.ts";
import { brokerFixture } from "./testkit.ts";

describe("committedPaths", () => {
  const log = (commits: ReadonlyArray<{ readonly at: number; readonly files: string[] }>) =>
    commits.map((commit) => `\0${commit.at}\n\n${commit.files.join("\n")}\n`).join("");

  it("takes the files of the commits made since the command started", () => {
    const out = log([
      { at: 1_760_000_010, files: ["src/payments/fees.ts", "src/totals.ts"] },
      { at: 1_760_000_005, files: ["src/totals.ts"] },
    ]);
    expect(committedPaths(out, 1_760_000_004_500)).toEqual([
      "src/payments/fees.ts",
      "src/totals.ts",
    ]);
  });

  it("leaves out older commits, which a pull or a checkout only brought in", () => {
    const out = log([
      { at: 1_760_000_010, files: ["src/mine.ts"] },
      { at: 1_759_000_000, files: ["src/theirs.ts"] },
    ]);
    expect(committedPaths(out, 1_760_000_000_000)).toEqual(["src/mine.ts"]);
  });

  it("is empty when git printed nothing", () => {
    expect(committedPaths("", 0)).toEqual([]);
  });
});

/**
 * A broker whose repository commits when `ran` says the agent's command ran: git then shows no
 * change, and HEAD names a new commit holding the file.
 */
async function committingFixture(options: { readonly moveHead: boolean }) {
  const state = { ran: false, since: [] as Array<{ from: string; sinceMs: number }> };
  const fixture = await brokerFixture(() => ({
    gitStatus: async () => "",
    gitHead: async () => (state.ran && options.moveHead ? "b2" : "a1"),
    gitCommittedSince: async (_root, from, sinceMs) => {
      state.since.push({ from, sinceMs });
      return from === "a1" ? ["src/payments/fees.ts"] : [];
    },
  }));
  await fixture.register("one");
  const tool = (event: "PreToolUse" | "PostToolUse") =>
    fixture.broker["hook"](
      {
        session_id: "one",
        cwd: fixture.root,
        hook_event_name: event,
        tool_name: "Bash",
        tool_input: { command: "cat >> src/payments/fees.ts <<'EOF'\nx\nEOF\ngit commit -am fee" },
      },
      {},
    );
  return { fixture, state, tool };
}

describe("a shell command that commits what it changed", () => {
  it("counts the committed files as the session's changes", async () => {
    const { fixture, state, tool } = await committingFixture({ moveHead: true });
    try {
      await tool("PreToolUse");
      state.ran = true;
      await tool("PostToolUse");
      const session = fixture.broker["sessions"].get("claude:one")!;
      expect(session.files).toContain("src/payments/fees.ts");
      expect(state.since).toHaveLength(1);
      expect(state.since[0]?.from).toBe("a1");
      expect(state.since[0]?.sinceMs).toBeGreaterThan(0);
      expect(session.head).toBe("b2");
    } finally {
      await fixture.dispose();
    }
  });

  it("asks nothing of the history when HEAD did not move", async () => {
    const { fixture, state, tool } = await committingFixture({ moveHead: false });
    try {
      await tool("PreToolUse");
      state.ran = true;
      await tool("PostToolUse");
      expect(state.since).toHaveLength(0);
      expect(fixture.broker["sessions"].get("claude:one")!.files).not.toContain(
        "src/payments/fees.ts",
      );
    } finally {
      await fixture.dispose();
    }
  });

  it("counts no commit at a stop that follows no shell command", async () => {
    const { fixture, state } = await committingFixture({ moveHead: true });
    try {
      state.ran = true;
      await fixture.broker["hook"](
        { session_id: "one", cwd: fixture.root, hook_event_name: "Stop" },
        {},
      );
      expect(state.since).toHaveLength(0);
      expect(fixture.broker["sessions"].get("claude:one")!.files).not.toContain(
        "src/payments/fees.ts",
      );
    } finally {
      await fixture.dispose();
    }
  });
});

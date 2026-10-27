import { assert, describe, it } from "@effect/vitest";

import { responseText } from "../../core/broker/hooks.ts";
import {
  captureOf,
  isTestRun,
  proofNudge,
  TEST_RUNS_KEPT,
  wantsProof,
  withTestRun,
} from "./client/proof.ts";

describe("test runs a capture may be asked about", () => {
  it("knows a project's test runners, also after cd, environment and a timer", () => {
    for (const command of [
      "cargo test money",
      "cargo nextest run",
      "cd server && cargo test --features memory",
      "PATH=/x/node_modules/.bin:$PATH vp test run src/a.test.ts",
      "pnpm test",
      "npm run test -- --watch=false",
      "bun test",
      "yarn test",
      "npx vitest run",
      "vitest run src",
      "jest",
      "pytest -q tests/test_money.py",
      "python3 -m pytest",
      "python -m unittest discover",
      "go test ./...",
      "make check",
      "mix test",
      "rspec spec/money_spec.rb",
      "dotnet test",
      "./gradlew test",
      "mvn test",
      "bun run check",
      "time cargo test",
      'RUST_LOG="debug info" cargo test',
    ])
      assert.isTrue(isTestRun(command), command);
  });

  it("leaves other commands out, a test runner only named in them among them", () => {
    for (const command of [
      "git commit -m 'cargo test passes'",
      "cargo build",
      "echo pytest",
      "grep -rn 'go test' .",
      "pnpm install",
      "vp lint src",
      "cargo testing",
    ])
      assert.isFalse(isTestRun(command), command);
  });

  it("keeps the newest few, each command once", () => {
    let runs = withTestRun([], "cargo test", 1);
    for (let i = 0; i < 6; i += 1) runs = withTestRun(runs, `go test ./p${i}`, i + 2);
    runs = withTestRun(runs, "go test ./p2", 10);
    assert.lengthOf(runs, TEST_RUNS_KEPT);
    assert.deepStrictEqual(runs.at(-1), { command: "go test ./p2", at: 10 });
    assert.strictEqual(runs.filter((run) => run.command === "go test ./p2").length, 1);
  });
});

describe("a capture asked for its proof", () => {
  const MCP = "mcp__kontext__ctx_capture";

  it("reads kontext's MCP capture and the draft it became", () => {
    const capture = captureOf({
      tool: MCP,
      input: { kind: "learning", title: "Totals round per line" },
      output:
        "Captured as inbox:2026-10-27-totals-round-per-line in the local inbox. Before committing, ctx_prepare_commit promotes it.",
    });
    assert.deepStrictEqual(capture, {
      kind: "learning",
      verify: false,
      private: false,
      id: "2026-10-27-totals-round-per-line",
      promoted: false,
    });
    assert.isTrue(wantsProof(capture!));
    const written = captureOf({
      tool: "mcp__plugin_kontext__ctx_capture",
      input: { kind: "decision", promote: true },
      output: "Written to .ai/decisions/x.md (id 2026-10-27-x). It is in the working tree.",
    });
    assert.deepStrictEqual(written, {
      kind: "decision",
      verify: false,
      private: false,
      id: "2026-10-27-x",
      promoted: true,
    });
  });

  it("reads `kontext capture` in a shell step", () => {
    assert.deepStrictEqual(
      captureOf({
        tool: "Bash",
        command: 'kontext capture --kind learning -t "Totals round per line" -p src/pricing',
        output: "captured inbox:2026-10-27-totals\n",
      }),
      { kind: "learning", verify: false, private: false, id: "2026-10-27-totals", promoted: false },
    );
    assert.isTrue(
      captureOf({ tool: "Bash", command: "kontext capture -k decision --verify 'cargo test' -t X" })
        ?.verify,
    );
    assert.isNull(captureOf({ tool: "Bash", command: "kontext brief" }));
    assert.isNull(captureOf({ tool: "mcp__kontext__ctx_search", input: { kind: "learning" } }));
  });

  it("asks only a team learning or decision without a check", () => {
    const base = { verify: false, private: false, id: null, promoted: false };
    assert.isTrue(wantsProof({ ...base, kind: "decision" }));
    assert.isFalse(wantsProof({ ...base, kind: "convention" }));
    assert.isFalse(wantsProof({ ...base, kind: "learning", verify: true }));
    assert.isFalse(wantsProof({ ...base, kind: "learning", private: true }));
  });

  it("names the test, when it ran and how to add it, never adding it itself", () => {
    const capture = {
      kind: "learning",
      verify: false,
      private: false,
      id: "2026-10-27-totals",
      promoted: false,
    };
    const run = { command: "cd server && cargo test money", at: 0 };
    assert.strictEqual(
      proofNudge(capture, run, 3 * 60_000 + 5_000),
      'Peer: this entry has no check. You ran `cd server && cargo test money` 3 minutes ago and it passed. If it proves the entry, add it: ctx_inbox verify (id 2026-10-27-totals, verify "cd server && cargo test money"). If it does not, ignore this.',
    );
    const unnamed = proofNudge({ ...capture, id: null }, run, 10_000);
    assert.include(unnamed, "less than a minute ago");
    assert.include(unnamed, "(id the draft you just captured, verify");
    assert.include(
      proofNudge({ ...capture, promoted: true }, run, 60_000),
      '1 minute ago and it passed. If it proves the entry, add it: add it to the entry 2026-10-27-totals as verify: "cd server && cargo test money" in its frontmatter.',
    );
    const long = proofNudge(capture, { command: `pytest ${"x".repeat(3000)}`, at: 0 }, 0);
    assert.isAtMost(long.length, 1200);
  });

  it("reads the text of a tool's response as hooks send it", () => {
    assert.strictEqual(responseText("plain"), "plain");
    assert.strictEqual(
      responseText([
        { type: "text", text: "Captured as inbox:a" },
        { type: "text", text: "b" },
      ]),
      "Captured as inbox:a\nb",
    );
    assert.strictEqual(
      responseText({ stdout: "captured inbox:a", stderr: "" }),
      "captured inbox:a",
    );
    assert.strictEqual(responseText({ content: [{ text: "x" }] }), "x");
    assert.strictEqual(responseText(undefined), "");
    assert.lengthOf(responseText("y".repeat(5000)), 2000);
  });
});

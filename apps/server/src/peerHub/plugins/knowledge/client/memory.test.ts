// @effect-diagnostics nodeBuiltinImport:off - a checkout with a settings file, written by the test.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import {
  isHarnessMemoryPath,
  memoryPolicyOf,
  memoryRefusal,
  memoryStartLine,
  pinsHarnessMemory,
} from "./memory.ts";

describe("a harness memory path", () => {
  it("is Claude Code's auto memory directory, under ~/.claude or any .claude config dir", () => {
    assert.isTrue(
      isHarnessMemoryPath("/Users/ana/.claude/projects/-Users-ana-app/memory/MEMORY.md"),
    );
    assert.isTrue(
      isHarnessMemoryPath("/Users/ana/.claude/projects/-Users-ana-app/memory/feedback_tests.md"),
    );
    assert.isTrue(isHarnessMemoryPath("/home/bob/work/.claude/projects/x/memory/a.md"));
    // The config dir Peer runs Claude with, whatever it is called.
    assert.isTrue(
      isHarnessMemoryPath("/tmp/claude-home/projects/-app/memory/notes.md", ["/tmp/claude-home"]),
    );
    assert.isTrue(
      isHarnessMemoryPath("/tmp/claude-home/projects/-app/memory/notes.md", [
        undefined,
        "/tmp/claude-home/",
      ]),
    );
  });

  it("is not another project's folder that happens to be called memory, nor the memory dir's parent", () => {
    assert.isFalse(isHarnessMemoryPath("/Users/ana/projects/foo/memory/notes.md"));
    assert.isFalse(isHarnessMemoryPath("/Users/ana/.claude/projects/-app/MEMORY.md"));
    assert.isFalse(isHarnessMemoryPath("/Users/ana/.claude/projects/-app/memory"));
    assert.isFalse(isHarnessMemoryPath("/Users/ana/.claude/CLAUDE.md"));
    assert.isFalse(
      isHarnessMemoryPath("/tmp/other/projects/-app/memory/a.md", ["/tmp/claude-home"]),
    );
    assert.isFalse(isHarnessMemoryPath("/Users/ana/app/src/memory/cache.ts", [""]));
  });
});

describe("the memory policy and its texts", () => {
  it("reads off for a project that says nothing, or says it in words this app does not know", () => {
    const base = {
      id: "app",
      name: "App",
      role: "member" as const,
      members: [],
      repositories: [],
      tools: [],
      knowledge: { kontext: false, company: false },
      capacity: { personal: "any" as const, personalHarnesses: [] },
    };
    assert.equal(memoryPolicyOf(undefined), "off");
    assert.equal(memoryPolicyOf(base), "off");
    assert.equal(memoryPolicyOf({ ...base, agents: { memory: "off" } }), "off");
    assert.equal(memoryPolicyOf({ ...base, agents: { memory: "shared" } }), "off");
    assert.equal(memoryPolicyOf({ ...base, agents: { memory: "personal" } }), "personal");
  });

  it("names the three homes in one line each", () => {
    const refusal = memoryRefusal("peer", "your person");
    assert.equal(refusal.decision, "deny");
    assert.notInclude(refusal.reason, "\n");
    assert.include(refusal.reason, "`peer capture`");
    assert.include(refusal.reason, "ctx_capture");
    assert.include(refusal.reason, "`peer status`");
    assert.include(refusal.reason, "tell your person");
    const line = memoryStartLine("peer", "your person");
    assert.notInclude(line, "\n");
    assert.include(line, "Keep nothing about this project in your harness memory");
    assert.include(line, "`peer capture --kind");
    assert.isBelow(line.length, 400);
  });
});

describe("a repository's own pin", () => {
  it("is autoMemoryEnabled: false in its committed .claude/settings.json, and nothing else", async () => {
    const checkout = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-memory-pin-"));
    try {
      assert.isFalse(await pinsHarnessMemory(checkout));
      await NodeFSP.mkdir(NodePath.join(checkout, ".claude"));
      const file = NodePath.join(checkout, ".claude", "settings.json");
      await NodeFSP.writeFile(file, "{ not json");
      assert.isFalse(await pinsHarnessMemory(checkout));
      await NodeFSP.writeFile(file, JSON.stringify({ autoMemoryEnabled: true }));
      assert.isFalse(await pinsHarnessMemory(checkout));
      await NodeFSP.writeFile(file, JSON.stringify({ autoMemoryEnabled: "false" }));
      assert.isFalse(await pinsHarnessMemory(checkout));
      await NodeFSP.writeFile(file, JSON.stringify({ autoMemoryEnabled: false, hooks: {} }));
      assert.isTrue(await pinsHarnessMemory(checkout));
    } finally {
      await NodeFSP.rm(checkout, { recursive: true, force: true });
    }
  });
});

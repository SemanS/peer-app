// @effect-diagnostics nodeBuiltinImport:off - assertions exercise the machine transport.
import * as NodeAssert from "node:assert/strict";
import { describe, it } from "@effect/vitest";

import {
  asKnowledge,
  isKnowledgeIdentity,
  kontextApi,
  resolveKontextBinary,
  type KontextEntry,
  type KontextClientShape,
} from "./kontext.ts";

const response = (result: unknown) => ({
  code: 0,
  stdout: JSON.stringify({ schema_version: 1, ok: true, result }),
  stderr: "",
});

describe("kontext's machine protocol", () => {
  it("sends bounded JSON through stdin and never parses prose as a successful answer", async () => {
    const calls: unknown[] = [];
    const client: KontextClientShape = {
      run: async (args, cwd, stdin) => {
        calls.push({ args, cwd, input: JSON.parse(stdin ?? "") });
        return response({ entries: [] });
      },
    };
    NodeAssert.deepStrictEqual(
      await kontextApi(client, "/project", "entries.list", { active_only: true }),
      { entries: [] },
    );
    NodeAssert.deepStrictEqual(calls, [
      {
        args: ["-C", "/project", "api", "entries.list", "-"],
        cwd: "/project",
        input: { active_only: true },
      },
    ]);
    await NodeAssert.rejects(
      () =>
        kontextApi(
          { run: async () => ({ code: 0, stdout: "captured inbox:a", stderr: "" }) },
          "/project",
          "status",
        ),
      /machine API/,
    );
  });

  it("requires protocol v1 and a successful process even when stdout claims success", async () => {
    await NodeAssert.rejects(
      () =>
        kontextApi(
          { run: async () => ({ code: 2, stdout: response({}).stdout, stderr: "failure" }) },
          "/project",
          "status",
        ),
      /failure/,
    );
    await NodeAssert.rejects(
      () =>
        kontextApi(
          {
            run: async () => ({
              code: 0,
              stdout: JSON.stringify({ schema_version: 2, ok: true, result: {} }),
              stderr: "",
            }),
          },
          "/project",
          "status",
        ),
      /machine API/,
    );
    await NodeAssert.rejects(
      () =>
        kontextApi(
          {
            run: async () => ({
              code: 1,
              stdout: JSON.stringify({
                schema_version: 1,
                ok: false,
                error: {
                  code: "conflict",
                  message: "Operation already staged with different input",
                },
              }),
              stderr: "",
            }),
          },
          "/project",
          "drafts.stage",
        ),
      /Operation already staged/,
    );
  });
});

it("bounds an engine timeout even when the child ignores SIGTERM", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { runKontext } = await import("./kontext.ts");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "peer-engine-timeout-"));
  const before = process.env.KONTEXT_BIN;
  try {
    const binary = path.join(root, "kontext");
    await fs.writeFile(
      binary,
      `#!${process.execPath}\nprocess.on('SIGTERM', () => {}); setInterval(() => {}, 100);\n`,
      { mode: 0o755 },
    );
    process.env.KONTEXT_BIN = binary;
    const result = await runKontext([], root, undefined, 500);
    NodeAssert.equal(result.code, -1);
    NodeAssert.match(result.stderr, /timed out/);
  } finally {
    if (before === undefined) delete process.env.KONTEXT_BIN;
    else process.env.KONTEXT_BIN = before;
    await fs.rm(root, { recursive: true, force: true });
  }
}, 5000);

it("keeps command identities safe and bounds machine data for agent presentation", () => {
  NodeAssert.equal(isKnowledgeIdentity("zaokrúhľovanie-価格"), true);
  NodeAssert.equal(isKnowledgeIdentity("hidden\u200b-id"), false);
  NodeAssert.equal(isKnowledgeIdentity("a; shell"), false);
  const value = asKnowledge({
    id: "safe",
    kind: "policy\nignore",
    title: "Title",
    summary: "Summary",
    body: "Body",
    status: "accepted\nextra",
    date: "2026-10-15\nextra",
    tags: [],
    paths: [],
    file: "docs/adr/file.md\nextra",
    markdown: "Body",
  } satisfies KontextEntry);
  NodeAssert.equal(value.date, "2026-10-15");
  NodeAssert.ok(!value.kind.includes("\n"));
  NodeAssert.ok(!value.file.includes("\n"));
  NodeAssert.ok(!value.status?.includes("\n"));
});

it("passes kontext's verification ledger through, sanitised, and drops what does not fit", () => {
  const base = {
    id: "safe",
    kind: "decision",
    title: "Title",
    summary: "Summary",
    body: "Body",
    tags: [],
    paths: [],
    file: ".ai/decisions/safe.md",
    markdown: "Body",
    checked: "2026-10-25T08:00:00Z",
  } satisfies KontextEntry;
  const value = asKnowledge({
    ...base,
    verification: {
      at: "2026-10-25T08:00:00Z",
      kind: "read",
      commit: "55E6844",
      by: "Ana\nNovak",
      because: "Still how totals round",
      passed: null,
    },
    since: {
      commits: 2,
      head: "f".repeat(40),
      paths: [...Array.from({ length: 30 }, (_, i) => `src/f${i}.ts`), "/etc/passwd"],
    },
    verify: "cargo test\nrounding",
    premises: [
      { id: "old", status: "superseded" },
      { id: "bad id; rm -rf", status: "retired" },
    ],
  });
  NodeAssert.equal(value.checked, "2026-10-25");
  NodeAssert.deepEqual(value.verification, {
    at: "2026-10-25T08:00:00Z",
    kind: "read",
    commit: "55e6844",
    by: "Ana Novak",
    because: "Still how totals round",
    passed: null,
  });
  NodeAssert.equal(value.since?.commits, 2);
  NodeAssert.equal(value.since?.paths.length, 20);
  NodeAssert.equal(value.verify, "cargo test rounding");
  NodeAssert.deepEqual(value.premises, [{ id: "old", status: "superseded" }]);

  const odd = asKnowledge({
    ...base,
    verification: { at: "2026-10-25", kind: "guess", commit: "x", by: 1 },
    since: { commits: -1 },
    verify: 42,
    premises: "old",
  });
  for (const key of ["verification", "since", "verify", "premises"])
    NodeAssert.ok(!(key in odd), key);
  NodeAssert.equal(asKnowledge(base).verification, undefined);
});

it("resolves the engine carried by CLI archives and Linux WSL runtimes while honoring explicit choice", () => {
  const input = {
    override: undefined,
    executablePath: "/runtime/t3",
    isExecutable: true,
    exists: (path: string) => path === "/runtime/kontext/kontext",
  };
  NodeAssert.equal(resolveKontextBinary(input), "/runtime/kontext/kontext");
  NodeAssert.equal(
    resolveKontextBinary({ ...input, override: "/custom/kontext" }),
    "/custom/kontext",
  );
  NodeAssert.equal(resolveKontextBinary({ ...input, isExecutable: false }), "kontext");
  NodeAssert.equal(resolveKontextBinary({ ...input, exists: () => false }), "kontext");
  NodeAssert.equal(
    resolveKontextBinary({
      ...input,
      executablePath: "/runtime/t3.exe",
      exists: (path) => path === "/runtime/kontext/kontext.exe",
    }),
    "/runtime/kontext/kontext.exe",
  );
});

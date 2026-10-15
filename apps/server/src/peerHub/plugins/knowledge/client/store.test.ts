import { assert, describe, expect, it } from "@effect/vitest";

import type { KontextClientShape, KontextEntry } from "../../../kontext.ts";
import { projectGuidance, readKnowledge } from "./store.ts";

const entry = (id: string, overrides: Partial<KontextEntry> = {}): KontextEntry => ({
  id,
  kind: "decision",
  title: "Round each line before the total",
  status: "accepted",
  date: "2026-10-05",
  summary: "Totals are sums of rounded lines.",
  tags: [],
  paths: ["src/pricing/total.ts"],
  file: `docs/adr/${id}.md`,
  body: "Round per line.",
  markdown: "# Decision in the project's existing ADR style\n",
  ...overrides,
});

const machine = (answer: (input: Record<string, unknown>) => unknown) => {
  const calls: Array<{
    readonly args: ReadonlyArray<string>;
    readonly cwd: string;
    readonly input: Record<string, unknown>;
  }> = [];
  const client: KontextClientShape = {
    run: async (args, cwd, stdin) => {
      const input = JSON.parse(stdin ?? "{}") as Record<string, unknown>;
      calls.push({ args, cwd, input });
      return {
        code: 0,
        stdout: JSON.stringify({ schema_version: 1, ok: true, result: answer(input) }),
        stderr: "",
      };
    },
  };
  return { client, calls };
};

describe("the engine's configured knowledge store", () => {
  it("uses engine entries from custom ADR locations without parsing Markdown or reading local files", async () => {
    const supplied = [
      entry("0001-price-rounding"),
      entry("価格", {
        kind: "policy",
        status: null,
        date: null,
        file: "knowledge/policies/価格.md",
      }),
    ];
    const engine = machine(() => ({
      entries: supplied,
      next_offset: null,
      snapshot: "revision-1",
    }));
    const read = await readKnowledge("/engine-owned/project", engine.client);
    assert.deepStrictEqual(
      read.map((e) => e.file),
      ["docs/adr/0001-price-rounding.md", "knowledge/policies/価格.md"],
    );
    assert.strictEqual(read[0]?.body, "Round per line.");
    assert.isUndefined(read[1]?.status);
    assert.isUndefined(read[1]?.date);
    assert.deepStrictEqual(engine.calls, [
      {
        args: ["-C", "/engine-owned/project", "api", "entries.list", "-"],
        cwd: "/engine-owned/project",
        input: { active_only: true, limit: 200, offset: 0 },
      },
    ]);
  });

  it("follows the engine's pagination while requesting active knowledge", async () => {
    const engine = machine((input) =>
      input.offset === 0
        ? { entries: [entry("first")], next_offset: 200 }
        : { entries: [entry("second")], next_offset: null },
    );
    assert.deepStrictEqual(
      (await readKnowledge("/project", engine.client)).map((e) => e.id),
      ["first", "second"],
    );
    assert.deepStrictEqual(
      engine.calls.map((call) => call.input),
      [
        { active_only: true, limit: 200, offset: 0 },
        { active_only: true, limit: 200, offset: 200 },
      ],
    );
  });

  it("propagates engine failure so the caller can retain its last successful snapshot", async () => {
    const unavailable: KontextClientShape = {
      run: async () => ({ code: -1, stdout: "", stderr: "kontext is not here" }),
    };
    await expect(readKnowledge("/project", unavailable)).rejects.toMatchObject({
      code: "incompatible",
    });
  });
});

describe("the project's guidance in engine knowledge", () => {
  it("asks the engine for active tagged conventions and chooses the newest", async () => {
    const engine = machine(() => ({
      entries: [
        entry("earlier", { kind: "convention", date: "2026-10-01", body: "Earlier guidance." }),
        entry("latest", {
          kind: "convention",
          date: "2026-10-04",
          body: "Mark how the code behaves.",
        }),
      ],
    }));
    assert.deepStrictEqual(await projectGuidance("/project", engine.client), {
      id: "latest",
      text: "Mark how the code behaves.",
    });
    assert.deepStrictEqual(engine.calls[0]?.input, {
      active_only: true,
      kinds: ["convention"],
      tags: ["peer-skill"],
      limit: 400,
    });
  });

  it("returns no guidance when the engine finds no active convention", async () => {
    const engine = machine(() => ({ entries: [] }));
    assert.isNull(await projectGuidance("/project", engine.client));
  });
});

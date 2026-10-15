import { assert, describe, expect, it } from "@effect/vitest";
import { kontextIn, titleOf, directBody, type KontextClientShape } from "./kontext.ts";

const candidate = {
  text: "Prices are integer cents.",
  finders: 2,
  paths: ["src/pricing/**"],
  sources: [{ text: "Cents avoid rounding drift", task: "task-1", tagged: true }],
};
const input = {
  project: "shop",
  candidate,
  where: (task: string | undefined) => task ?? "work outside tasks",
  operationId: "peer:knowledge:stable",
  source: "peer://knowledge/shop/candidate",
  word: { context: { subject: "Prices", text: "Use integer prices." } },
};
const success = (result: unknown) => ({
  code: 0,
  stdout: JSON.stringify({ schema_version: 1, ok: true, result }),
  stderr: "",
});
const failure = (code: string) => ({
  code: 1,
  stdout: JSON.stringify({ schema_version: 1, ok: false, error: { code, message: code } }),
  stderr: "",
});
const machine = () => {
  const calls: Array<{ operation: string; input: Record<string, unknown> }> = [];
  let receipt: { fingerprint: unknown; result: unknown } | undefined;
  const client: KontextClientShape = {
    run: async (args, _cwd, stdin) => {
      const operation = args[3] ?? "";
      const body = JSON.parse(stdin ?? "{}") as Record<string, unknown>;
      calls.push({ operation, input: body });
      switch (operation) {
        case "operations.get":
          return receipt === undefined
            ? failure("not_found")
            : receipt.fingerprint !== body.fingerprint
              ? failure("operation_conflict")
              : success(receipt.result);
        case "entries.search":
          return success({ entries: [{ title: "Existing prices decision" }] });
        case "drafts.formalize":
          return success({
            entry: { ...(body.entry as object), title: "Keep prices in cents" },
            notes: [],
          });
        case "drafts.stage": {
          const result = {
            entry: body.entry,
            path: "docs/knowledge/prices.md",
            staged: true,
            replayed: false,
            related: [],
            notes: [],
          };
          receipt = { fingerprint: body.fingerprint, result };
          return success(result);
        }
        case "drafts.extract":
          return success({
            candidates: [
              {
                kind: "learning",
                title: "Cents",
                body: "Use integer cents",
                paths: ["src/pricing/**"],
              },
            ],
            notes: [],
          });
        case "entries.list":
          return success({
            entries: [
              {
                id: "old-guidance",
                kind: "convention",
                title: "Guidance",
                summary: "",
                tags: ["peer-skill"],
                paths: [],
                file: "docs/guidance.md",
                body: "Keep durable choices.",
                date: "2026-10-01",
              },
            ],
          });
        case "guidance.propose":
          return success({
            entry: {
              kind: "convention",
              title: "Mark durable findings",
              body: "Skip progress",
              tags: ["peer-skill"],
            },
            notes: [],
          });
        case "setup":
          return success({ initialized: true });
        default:
          throw new Error(`unexpected operation ${operation}`);
      }
    },
  };
  return { client, calls };
};

describe("Peer's kontext knowledge client", () => {
  it("formalizes and stages structured paths, then replays before another model call after a Hub failure", async () => {
    const test = machine();
    const client = kontextIn(test.client, "/checkout");
    const kept = await client.keep(input);
    assert.deepStrictEqual(kept.keptAs, {
      path: "docs/knowledge/prices.md",
      title: "Keep prices in cents",
      kind: "learning",
    });
    assert.strictEqual(kept.related, "Existing prices decision");
    const staged = test.calls.find(({ operation }) => operation === "drafts.stage")?.input;
    assert.deepStrictEqual((staged!.entry as { paths: string[] }).paths, ["src/pricing/**"]);
    assert.strictEqual(staged?.source, input.source);
    const replayed = await client.keep(input);
    assert.deepStrictEqual(replayed.keptAs, kept.keptAs);
    assert.strictEqual(
      test.calls.filter(({ operation }) => operation === "drafts.formalize").length,
      1,
    );
    assert.strictEqual(
      test.calls.filter(({ operation }) => operation === "drafts.stage").length,
      1,
    );
    await expect(
      client.keep({ ...input, candidate: { ...candidate, text: "Edited after staging" } }),
    ).rejects.toThrow("operation_conflict");
  });

  it("resumes an interrupted stage with the original identity and no model call", async () => {
    const calls: string[] = [];
    const client: KontextClientShape = {
      run: async (args, _cwd, stdin) => {
        const operation = args[3] ?? "";
        calls.push(operation);
        if (operation === "operations.get") return failure("operation_incomplete");
        const body = JSON.parse(stdin ?? "{}");
        assert.deepStrictEqual(Object.keys(body).toSorted(), ["fingerprint", "operation_id"]);
        return success({
          entry: { title: "Already prepared", kind: "decision" },
          path: "docs/adr/prepared.md",
          notes: [],
        });
      },
    };
    assert.strictEqual(
      (await kontextIn(client, "/checkout").keep(input)).keptAs.title,
      "Already prepared",
    );
    assert.deepStrictEqual(calls, ["operations.get", "drafts.stage"]);
  });

  it("keeps an already worded finding directly and carries extracted paths through harvest", async () => {
    const test = machine();
    const client = kontextIn(test.client, "/checkout");
    await client.keep({
      ...input,
      candidate: {
        ...candidate,
        detail: "Use cents because fractional floats drift.",
        kind: "convention",
      },
    });
    assert.isFalse(test.calls.some(({ operation }) => operation === "drafts.formalize"));
    const entries = await client.harvest({
      project: "shop",
      subject: "Prices",
      text: "Prices are cents.",
    });
    assert.deepStrictEqual(entries[0]?.paths, ["src/pricing/**"]);
    assert.isFalse(test.calls.some(({ operation }) => operation === "drafts.capture"));
  });

  it("proposes guidance from labels and supersedes the previous tagged convention", async () => {
    const test = machine();
    const client = kontextIn(test.client, "/checkout");
    await client.guidance({
      project: "shop",
      kept: ["Cents"],
      dismissed: ["Progress"],
      missed: ["Tax rule"],
    });
    const guidance = test.calls.find(({ operation }) => operation === "guidance.propose")?.input;
    assert.strictEqual(guidance?.current, "Keep durable choices.");
    assert.strictEqual(guidance?.profile_tag, "peer-skill");
    const staged = test.calls.find(({ operation }) => operation === "drafts.stage")?.input;
    assert.deepStrictEqual((staged!.entry as { supersedes: string[] }).supersedes, [
      "old-guidance",
    ]);
    await client.guidance({
      project: "shop",
      kept: ["Cents"],
      dismissed: ["Progress"],
      missed: ["Tax rule"],
    });
    assert.strictEqual(
      test.calls.filter(({ operation }) => operation === "guidance.propose").length,
      1,
    );
    assert.strictEqual(
      test.calls.filter(({ operation }) => operation === "drafts.stage").length,
      1,
    );
  });

  it("retains the person's selected point and attribution when no model is used", () => {
    assert.strictEqual(
      titleOf("Prices are integer cents. Avoid floats."),
      "Prices are integer cents",
    );
    assert.include(directBody(candidate), "2 coding agents found it on their own");
    assert.notInclude(directBody(candidate), "task-1");
  });
});

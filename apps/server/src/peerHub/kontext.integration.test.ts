// @effect-diagnostics nodeBuiltinImport:off - exercises the standalone engine through Peer's process transport.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import { stageKontextResource } from "../../../../scripts/lib/kontext-resource.ts";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

import {
  engineStatus,
  KontextApiError,
  kontextApi,
  resolveKontextBinary,
  runKontext,
  type KontextEntry,
} from "./kontext.ts";
import { kontextIn } from "./plugins/knowledge/client/kontext.ts";
import {
  challengedIn,
  confirmEntry,
  entriesDrift,
  reviewRefusal,
} from "./plugins/knowledge/client/drift.ts";

const directories: string[] = [];
const client = { run: runKontext };
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => NodeFSP.rm(directory, { recursive: true, force: true })),
  );
});
const git = (root: string, ...args: string[]) =>
  new Promise<string>((resolve, reject) => {
    NodeChildProcess.execFile(
      "git",
      ["-C", root, ...args],
      {
        env: {
          ...process.env,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
          GIT_AUTHOR_NAME: "Integration test",
          GIT_AUTHOR_EMAIL: "test@example.invalid",
          GIT_COMMITTER_NAME: "Integration test",
          GIT_COMMITTER_EMAIL: "test@example.invalid",
          KONTEXT_SKIP: "1",
        },
      },
      (error, output) => (error === null ? resolve(output.trimEnd()) : reject(error)),
    );
  });
const fixture = async (fields = false) => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-kontext-api-"));
  directories.push(root);
  await git(root, "init", "-q", "-b", "main");
  await NodeFSP.mkdir(NodePath.join(root, ".ai"), { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(root, ".ai/kontext.toml"),
    "[init]\nllm='unavailable-test-model'\n" +
      (fields
        ? "[store.kinds.decision]\npath='docs/adr'\nstyle='fields'\nnumbering='sequential'\n"
        : ""),
  );
  await git(root, "add", ".ai/kontext.toml");
  await git(root, "commit", "-qm", "Configured knowledge fixture");
  return root;
};
interface Staged {
  readonly entry: KontextEntry;
  readonly path: string;
  readonly replayed: boolean;
  readonly staged: boolean;
}

describe.skipIf(!process.env.KONTEXT_BIN)("Peer with the real standalone kontext engine", () => {
  it("lists entries whose governed code drifted, and drops one once it is confirmed", async () => {
    const root = await fixture();
    const status = await engineStatus(client, root);
    // The pinned engine before 0.4.0 has no drift: Peer then says nothing of it.
    if (!status.capabilities.includes("entries.drift")) {
      expect(await entriesDrift(client, root, {})).toBeNull();
      return;
    }
    expect(status.capabilities).toContain("drafts.confirm");
    await NodeFSP.mkdir(NodePath.join(root, "src/pricing"), { recursive: true });
    await NodeFSP.mkdir(NodePath.join(root, "src/export"), { recursive: true });
    await NodeFSP.writeFile(NodePath.join(root, "src/pricing/total.ts"), "export {};\n");
    await NodeFSP.writeFile(NodePath.join(root, "src/export/cron.ts"), "export {};\n");
    const ids: string[] = [];
    for (const [title, path] of [
      ["Totals round each line", "src/pricing/**"],
      ["Exports run on cron", "src/export/**"],
    ] as const) {
      const staged = await kontextApi<Staged>(client, root, "drafts.stage", {
        operation_id: `seed:${title}`,
        entry: { kind: "decision", title, body: `${title}.`, paths: [path], status: "accepted" },
      });
      ids.push(staged.entry.id);
    }
    await git(root, "add", "src");
    await git(root, "commit", "-qm", "Two decisions");
    const [rounding, cron] = ids as [string, string];
    const base = await git(root, "rev-parse", "HEAD");
    await NodeFSP.writeFile(NodePath.join(root, "src/pricing/total.ts"), "export const a = 1;\n");
    await git(root, "commit", "-qam", "Round the total once");
    const head = await git(root, "rev-parse", "HEAD");
    await NodeFSP.writeFile(NodePath.join(root, "src/export/cron.ts"), "export const b = 1;\n");

    // A committed range: the commit, with its subject.
    const committed = await entriesDrift(client, root, { base, head });
    expect(committed).toEqual({
      base,
      head,
      entries: [
        expect.objectContaining({
          id: rounding,
          kind: "decision",
          title: "Totals round each line",
          changed: ["src/pricing/total.ts"],
          commits: [{ sha: head, subject: "Round the total once" }],
        }),
      ],
    });
    // The working tree, with what is not committed yet: what peer review reads.
    const working = await entriesDrift(client, root, { base });
    expect(working?.head).toBe("working");
    expect(working?.entries.map((entry) => entry.id).toSorted()).toEqual(
      [cron, rounding].toSorted(),
    );
    expect(
      reviewRefusal(working!, challengedIn([`[against ${cron}] runs on a queue now`]))?.reason,
    ).toContain(`- ${rounding} (decision`);

    // Confirmed: kontext stages the entry with today's check, and drift no longer lists it.
    const confirmed = await confirmEntry(client, root, rounding);
    expect(confirmed.id).toBe(rounding);
    expect(confirmed.checked).toMatch(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/);
    // A confirmation stages the entry and, since kontext 0.6.0, its ledger line with it.
    expect((await git(root, "diff", "--cached", "--name-only")).split("\n")).toContain(
      confirmed.path,
    );
    const read = await kontextApi<{ entry: KontextEntry }>(client, root, "entries.get", {
      id: rounding,
    });
    expect(read.entry.checked).toBe(confirmed.checked);
    const after = await entriesDrift(client, root, { base });
    expect(after?.entries.map((entry) => entry.id)).toEqual([cron]);
    expect(
      reviewRefusal(after!, challengedIn([`- [against ${cron}] runs on a queue now`])),
    ).toBeNull();
  });

  it("stages and replays guidance from decisions, then supersedes it with revised guidance", async () => {
    const root = await fixture();
    const model = NodePath.join(root, "guidance-model.json");
    const command = [
      process.execPath,
      "-e",
      'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write(require("node:fs").readFileSync(process.argv[1], "utf8")));',
      model,
    ];
    await NodeFSP.mkdir(NodePath.join(root, ".git/kontext"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(root, ".git/kontext/config.toml"),
      `[init]\nllm='fixture-model'\n[adapters.fixture-model]\ndriver='command'\n[adapters.fixture-model.ops.llm]\ncommand=${JSON.stringify(command)}\nstdin='{{prompt}}'\nformat='text'\n`,
    );
    const body = "Keep durable choices.\n\nSkip progress reports.";
    await NodeFSP.writeFile(model, JSON.stringify({ title: "Keep durable findings", body }));
    const knowledge = kontextIn(client, root);
    const labels = {
      project: "shop",
      kept: ["Use integer cents"],
      dismissed: ["Progress"],
      missed: [],
    };
    const first = await knowledge.guidance(labels);
    expect(first.title).toBe("Keep durable findings");
    expect(await knowledge.guidance(labels)).toEqual(first);
    const before = await kontextApi<{ entries: KontextEntry[] }>(client, root, "entries.list", {
      tags: ["peer-skill"],
      active_only: true,
    });
    expect(before.entries).toHaveLength(1);
    expect(before.entries[0]?.body.trim()).toBe(body);
    expect(before.entries[0]?.extra?.external_id).toBeUndefined();
    await git(root, "commit", "-qm", "Keep guidance");

    await NodeFSP.writeFile(
      model,
      JSON.stringify({
        title: "Keep tested durable findings",
        body: `${body}\n\nInclude evidence.`,
      }),
    );
    const revised = await knowledge.guidance({
      ...labels,
      kept: [...labels.kept, "Include evidence"],
    });
    expect(revised.title).toBe("Keep tested durable findings");
    const after = await kontextApi<{
      entries: Array<{ title: string; supersedes: string[] }>;
    }>(client, root, "entries.list", { tags: ["peer-skill"], active_only: true });
    expect(after.entries).toHaveLength(1);
    expect(after.entries[0]?.title).toBe(revised.title);
    expect(after.entries[0]?.supersedes).toEqual([before.entries[0]?.id]);
  });

  it("stages once across client restarts and keeps original fingerprints, metadata and unrelated index content", async () => {
    const root = await fixture();
    const status = await engineStatus(client, root);
    expect(status.capabilities).toContain("operations.get");
    await NodeFSP.writeFile(NodePath.join(root, "user.txt"), "User staged content");
    await git(root, "add", "user.txt");
    await NodeFSP.writeFile(NodePath.join(root, "user.txt"), "User unstaged content");
    const input = {
      operation_id: "peer:integration:stable-finding",
      fingerprint: "original-selected-finding-hash",
      source: "client-private://task/42",
      entry: {
        id: "external-finding-42",
        kind: "decision",
        title: "Preserve complete machine results",
        body: "Žltý kôň používa spoločné znalosti. 🚀 ".repeat(4000),
        status: "proposed",
        paths: ["src/future.ts"],
        tags: ["client-defined"],
        extra: { evidence_hash: "sha256:abcd" },
      },
    };
    const first = await kontextApi<Staged>(client, root, "drafts.stage", input);
    const repeated = await kontextApi<Staged>(client, root, "operations.get", {
      operation_id: input.operation_id,
      fingerprint: input.fingerprint,
    });
    expect(repeated.replayed).toBe(true);
    expect(repeated.path).toBe(first.path);
    expect(repeated.entry.status).toBe("proposed");
    expect(repeated.entry.paths).toEqual(["src/future.ts"]);
    expect(repeated.entry.extra?.external_id).toBe("external-finding-42");
    expect(repeated.entry.extra?.evidence_hash).toBe("sha256:abcd");
    expect(repeated.entry.extra?.source).toBeUndefined();
    await expect(
      kontextApi(client, root, "operations.get", {
        operation_id: input.operation_id,
        fingerprint: "edited-selected-finding-hash",
      }),
    ).rejects.toMatchObject({ code: "operation_conflict" });
    const read = await kontextApi<{ entry: KontextEntry }>(client, root, "entries.get", {
      id: first.entry.id,
    });
    expect(read.entry.body.length).toBeGreaterThan(6000);
    expect(read.entry.body).toBe(`${input.entry.body.trim()}\n`);
    expect(read.entry.body).not.toContain("�");
    expect(await git(root, "show", ":user.txt")).toBe("User staged content");
    expect(await NodeFSP.readFile(NodePath.join(root, "user.txt"), "utf8")).toBe(
      "User unstaged content",
    );
    const listed = await kontextApi<{ entries: KontextEntry[] }>(client, root, "entries.list");
    expect(listed.entries.filter((entry) => entry.id === first.entry.id)).toHaveLength(1);
  });

  it("reports missing model structurally and preserves a selected finding without writing knowledge", async () => {
    const root = await fixture();
    await expect(
      kontextApi(client, root, "drafts.extract", {
        text: "The team selected explicit review before publishing knowledge.",
      }),
      // kontext 0.10.0 says model_unavailable and lists the older llm_unavailable among the aliases.
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof KontextApiError && error.is("llm_unavailable"),
    );
    const formalized = await kontextApi<{ entry: KontextEntry; notes: string[] }>(
      client,
      root,
      "drafts.formalize",
      {
        entry: {
          kind: "decision",
          title: "Selected finding",
          body: "Preserve the selected fact even when no model is configured.",
          paths: ["future/module.ts"],
          tags: ["selected"],
        },
      },
    );
    expect(formalized.entry.title).toBe("Selected finding");
    expect(formalized.entry.paths).toEqual(["future/module.ts"]);
    expect(formalized.entry.tags).toEqual(["selected"]);
    expect(formalized.notes.length).toBeGreaterThan(0);
    expect(await git(root, "diff", "--cached", "--name-only")).toBe("");
    expect(await kontextApi(client, root, "inbox.list")).toEqual(
      expect.objectContaining({ entries: [] }),
    );
  });

  it("roundtrips custom ADR metadata and imports only exact reviewed bytes", async () => {
    const root = await fixture(true);
    const staged = await kontextApi<Staged>(client, root, "drafts.stage", {
      operation_id: "custom-adr",
      entry: {
        id: "finding-with-external-identity",
        kind: "decision",
        title: "Use the configured knowledge store",
        status: "accepted",
        body: "A reviewed ADR uses the configured path and format.",
        extra: { evidence_hash: "sha256:reviewed", external_refs: ["issue://42"] },
      },
    });
    expect(staged.path).toMatch(/^docs\/adr\/0001-/);
    expect(staged.entry.extra?.external_id).toBe("finding-with-external-identity");
    await git(root, "commit", "-qm", "Review custom ADR");
    const revision = await git(root, "rev-parse", "HEAD");
    await git(root, "update-ref", "refs/remotes/origin/main", revision);
    const markdown = await NodeFSP.readFile(NodePath.join(root, staged.path), "utf8");
    await NodeFSP.writeFile(NodePath.join(root, staged.path), `${markdown}\nUnreviewed edit\n`);
    const exported = await kontextApi<{
      entries: Array<{ entry: KontextEntry; markdown: string; revision: string }>;
    }>(client, root, "entries.export", {
      revision,
      review_ref: "refs/remotes/origin/main",
    });
    expect(exported.entries).toHaveLength(1);
    expect(exported.entries[0]?.markdown).toBe(markdown);
    expect(exported.entries[0]?.revision).toBe(revision);
    expect(exported.entries[0]?.entry.extra?.evidence_hash).toBe("sha256:reviewed");
    expect(exported.entries[0]?.markdown).not.toContain("Unreviewed edit");
  });
  it.effect(
    "executes the compatible engine shipped inside a CLI archive or Linux WSL runtime",
    () =>
      Effect.gen(function* () {
        const host = yield* HostProcess.Platform;
        const arch = yield* HostProcess.Architecture;
        yield* Effect.promise(async () => {
          const root = await fixture();
          const original = process.env.KONTEXT_BIN;
          const resources = NodePath.join(root, "archive-runtime");
          const packaged = await stageKontextResource({
            binaryPath: original,
            resourcesDirectory: resources,
            platform: host === "darwin" ? "mac" : host === "win32" ? "win" : "linux",
            arch,
            hostPlatform: host,
            hostArch: arch,
            required: true,
          });
          const selected = resolveKontextBinary({
            override: undefined,
            executablePath: NodePath.join(resources, host === "win32" ? "t3.exe" : "t3"),
            isExecutable: true,
            exists: NodeFS.existsSync,
          });
          expect(selected).toBe(packaged);
          try {
            process.env.KONTEXT_BIN = selected;
            expect((await engineStatus(client, root)).api_version).toBe(1);
          } finally {
            if (original === undefined) delete process.env.KONTEXT_BIN;
            else process.env.KONTEXT_BIN = original;
          }
        });
      }),
  );
});

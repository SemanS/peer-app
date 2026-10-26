// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - isolated on-disk benchmark reports measurements to the test runner.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { LocalAuthority } from "./LocalAuthority.ts";
import { contextArchive } from "../index/contextView.ts";

const then = "2026-08-27T12:00:00.000Z";
const now = "2026-10-26T12:00:00.000Z";

describe("durable context scale and 60-day return", () => {
  const scenarios = [100, 500, 1000].map((count) => ({ count, history: 3, samples: 10 }));
  if (process.env.PEER_CONTEXT_HEAVY_BENCHMARK === "1")
    scenarios.push({ count: 1000, history: 60, samples: 3 });
  it.each(scenarios)(
    "retains $count inputs with $history revisions and a bounded first page",
    async ({ count, history, samples }) => {
      const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-context-scale-"));
      try {
        const file = NodePath.join(dir, "state.json");
        const contexts = Object.fromEntries(
          Array.from({ length: count }, (_, index) => {
            const scope = `task:${String(index).padStart(4, "0")}`;
            return [
              JSON.stringify(["app", scope]),
              {
                workspace: "_local",
                project: "app",
                scope,
                version: history,
                updatedAt: now,
                bytes: 2200,
                gist: `Task ${index} current result`,
                text: `## State\nTask ${index} current result\n${"Evidence source reference. ".repeat(80)}`,
              },
            ];
          }),
        );
        const versions = Object.fromEntries(
          Object.entries(contexts).map(([key, context]) => [
            key,
            Array.from({ length: history }, (_, index) => index + 1).map((version) => ({
              version,
              at: version === 1 ? then : now,
              added: [],
              dropped: [],
              text: context.text,
            })),
          ]),
        );
        const reads = Object.values(contexts).map((context) => ({
          project: "app",
          scope: context.scope,
          session: "reader",
          environment: "here",
          version: 1,
          at: then,
        }));
        await NodeFSP.writeFile(
          file,
          JSON.stringify({
            version: 2,
            contexts,
            versions,
            reads,
            manifests: {
              [JSON.stringify(["app", "reader"])]: {
                status: "complete",
                pendingScopes: [],
                requiredScopes: reads.map((read) => read.scope),
              },
            },
            legacyEvidenceLost: false,
            overlaps: [],
            findings: [],
            events: [],
            operations: [],
          }),
        );
        const started = performance.now();
        const local = new LocalAuthority(file, "here", () => now);
        const returned = await local.staleReads("app", "reader");
        const restartMs = performance.now() - started;
        expect(returned.reads).toHaveLength(count);
        expect(returned.stale).toHaveLength(count);
        expect(returned.fresh).toBe(false);
        expect(await local.readContextVersion("app", "task:0000", 1)).not.toBeNull();
        await local.report([
          {
            id: "reader",
            project: "app",
            runtimeGeneration: "return",
            label: "return",
            status: "working",
            files: [],
            claims: [],
          },
        ]);
        const writeSamples: number[] = [];
        const writeBytes: number[] = [];
        const initialPointer = JSON.parse(await NodeFSP.readFile(file, "utf8"));
        const snapshotPath = NodePath.join(
          `${file}.store`,
          `${initialPointer.snapshot}.snapshot.json`,
        );
        const snapshotBefore = await NodeFSP.stat(snapshotPath);
        let previousCommittedBytes = initialPointer.bytes as number;
        const restartSamples: number[] = [];
        for (let sample = 0; sample < samples; sample += 1) {
          const writing = performance.now();
          await local.contextRead("app", "task:0000", "reader", history, `returned-read-${sample}`);
          writeSamples.push(performance.now() - writing);
          const pointer = JSON.parse(await NodeFSP.readFile(file, "utf8"));
          expect(pointer.snapshot).toBe(initialPointer.snapshot);
          expect((await NodeFSP.stat(snapshotPath)).mtimeMs).toBe(snapshotBefore.mtimeMs);
          writeBytes.push(pointer.bytes - previousCommittedBytes + (await NodeFSP.stat(file)).size);
          previousCommittedBytes = pointer.bytes;
          const reopening = performance.now();
          await new LocalAuthority(file, "here", () => now).staleReads("app", "reader");
          restartSamples.push(performance.now() - reopening);
        }
        const percentile = (samples: number[], fraction: number) =>
          samples.toSorted((a, b) => a - b)[
            Math.min(samples.length - 1, Math.ceil(samples.length * fraction) - 1)
          ];
        const restarted = new LocalAuthority(file, "here", () => now);
        expect((await restarted.staleReads("app", "reader")).stale).toHaveLength(count - 1);
        const discovery = {
          identity: {
            backend: "local" as const,
            authority: "local:here",
            environment: "here",
            workspace: "_local",
            project: "app",
            scope: "project-aggregate",
          },
          contexts: Object.values(contexts),
          tasks: [],
          generatedAt: now,
          availability: "available" as const,
          history: true,
          limit: 20,
        };
        const reading = performance.now();
        let page = contextArchive(discovery);
        const firstBytes = Buffer.byteLength(JSON.stringify(page));
        expect(page.entries).toHaveLength(20);
        expect(page.coverage.total).toBe(count);
        expect(firstBytes).toBeLessThan(12000);
        const found = new Set(page.entries.map((entry) => entry.scope));
        while (page.coverage.nextCursor !== null) {
          page = contextArchive({ ...discovery, cursor: page.coverage.nextCursor });
          for (const entry of page.entries) found.add(entry.scope);
        }
        expect(found.size).toBe(count);
        const measurements = {
          count,
          samples,
          revisionsPerContext: history,
          initialRestartMs: restartMs,
          restartP50Ms: percentile(restartSamples, 0.5),
          restartP95Ms: percentile(restartSamples, 0.95),
          writeP50Ms: percentile(writeSamples, 0.5),
          writeP95Ms: percentile(writeSamples, 0.95),
          discoveryAllPagesMs: performance.now() - reading,
          firstBytes,
          stateBytes: (await NodeFSP.stat(file)).size,
          snapshotBytes: snapshotBefore.size,
          journalBytes: previousCommittedBytes,
          receiptWriteBytesP95: percentile(writeBytes, 0.95),
          historyRewrittenByReceipt: false,
          totalStorageBytes:
            (await NodeFSP.stat(file)).size +
            (
              await Promise.all(
                (await NodeFSP.readdir(`${file}.store`)).map(
                  async (name) => (await NodeFSP.stat(NodePath.join(`${file}.store`, name))).size,
                ),
              )
            ).reduce((sum, size) => sum + size, 0),
        };
        console.info("peer-context-scale", JSON.stringify(measurements));
      } finally {
        await NodeFSP.rm(dir, { recursive: true, force: true });
      }
    },
  );
});

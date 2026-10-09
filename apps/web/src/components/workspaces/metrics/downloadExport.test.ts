import { expect, it } from "vite-plus/test";
import type { PeerMetricsDays } from "@t3tools/contracts";
import { downloadFiles, exportFiles } from "./downloadExport";
const days: PeerMetricsDays = {
  workspace: "acme",
  project: "../pay",
  scope: "environment",
  from: "2026-10-01",
  to: "2026-10-09",
  computedAt: "2026-10-09T12:00:00Z",
  rows: [],
  team: { state: "off", reason: "off" },
};
it("makes safe project/range names and sequences both CSV downloads", async () => {
  const files = exportFiles(days, "env", [], false);
  expect(files.map((f) => f.name)).toEqual([
    "metrics-.._pay-2026-10-01_2026-10-09.csv",
    "metrics-.._pay-2026-10-01_2026-10-09-tasks.csv",
  ]);
  const received: string[] = [];
  let release!: () => void;
  const first = new Promise<void>((r) => {
    release = r;
  });
  const result = downloadFiles(files, async (f) => {
    received.push(f.name);
    if (received.length === 1) await first;
  });
  expect(received).toHaveLength(1);
  release();
  await result;
  expect(received).toEqual(files.map((f) => f.name));
  expect(exportFiles(days, "env", [], true)).toHaveLength(1);
  expect(() => exportFiles({ ...days, from: "2024-01-01" }, "env", [], false)).toThrow();
  expect(() => exportFiles({ ...days, from: "2026-02-30" }, "env", [], false)).toThrow();
});

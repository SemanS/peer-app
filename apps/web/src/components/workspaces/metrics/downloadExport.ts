import {
  metricsDayCount,
  PeerMetricsDaysInput,
  type PeerMetricsDays,
  type PeerTask,
} from "@t3tools/contracts";
import { metricsExport } from "@t3tools/client-runtime/peer/metrics";
import * as Schema from "effect/Schema";
const validRange = Schema.is(PeerMetricsDaysInput);
export function exportFiles(
  days: PeerMetricsDays,
  environment: string,
  tasks: ReadonlyArray<PeerTask>,
  json: boolean,
) {
  if (!validRange(days) || metricsDayCount(days.from, days.to) > 366)
    throw Error("Choose at most 366 valid UTC days.");
  const data = metricsExport(days, environment, tasks),
    base = `metrics-${days.project}-${days.from}_${days.to}`.replaceAll(/[^A-Za-z0-9_.-]/g, "_");
  return json
    ? [{ name: `${base}.json`, text: data.json, type: "application/json" }]
    : [
        { name: `${base}.csv`, text: data.csv, type: "text/csv;charset=utf-8" },
        { name: `${base}-tasks.csv`, text: data.tasksCsv, type: "text/csv;charset=utf-8" },
      ];
}
export const downloadFiles = async (
  files: ReturnType<typeof exportFiles>,
  save: (file: ReturnType<typeof exportFiles>[number]) => void | Promise<void>,
) => {
  for (const file of files) await save(file);
};
export function saveDownload({ name, text, type }: ReturnType<typeof exportFiles>[number]) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// @effect-diagnostics nodeBuiltinImport:off globalDate:off preferSchemaOverJson:off - the single local JSON-lines sink, including streaming a one-time legacy scrub.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import {
  project,
  metricsOf,
  type MetricRecord,
  type MetricEvent,
  type EventFields,
} from "./metricsCatalog.ts";
const HEADER = '{"event":"log.format","v":2}\n';
export const debugPathOf = (path: string) =>
  path.endsWith(".jsonl") ? `${path.slice(0, -6)}.debug.jsonl` : `${path}.debug`;
export function createMetricsLog({
  path,
  now = Date.now,
  forced = /^(1|true|on)$/i.test(process.env.PEER_COORDINATION_DEBUG ?? ""),
  rotateBytes = 20 * 1024 * 1024,
}: {
  path: string;
  now?: () => number;
  forced?: boolean;
  rotateBytes?: number;
}) {
  const debug = debugPathOf(path),
    listeners = new Set<(r: MetricRecord) => void>();
  let until: number | null = null,
    queue: Promise<void> = Promise.resolve();
  const debugState = () => ({
    on: forced || (until !== null && until > now()),
    forced,
    path: debug,
    ...(!forced && until !== null && until > now() ? { until } : {}),
  });
  const enqueue = (write: () => Promise<void>) => {
    queue = queue.then(write).catch(() => undefined);
  };
  const scrub = async (file: string) => {
    await NodeFSP.rm(`${file}.scrub.tmp`, { force: true });
    const existing = await NodeFSP.open(file, "r").catch(() => null);
    if (!existing) return;
    const first = Buffer.alloc(HEADER.length);
    await existing.read(first, 0, first.length, 0);
    await existing.close();
    if (first.toString() === HEADER) return;
    const tmp = `${file}.scrub.tmp`;
    await NodeFSP.writeFile(tmp, HEADER, { mode: 0o600 });
    const lines = NodeReadline.createInterface({
      input: NodeFS.createReadStream(file),
      crlfDelay: Infinity,
    });
    try {
      for await (const line of lines) {
        let raw: unknown;
        try {
          raw = JSON.parse(line);
        } catch {
          continue;
        }
        if (
          typeof raw !== "object" ||
          raw === null ||
          !("event" in raw) ||
          typeof raw.event !== "string"
        )
          continue;
        const r = raw as Record<string, unknown>;
        await NodeFSP.appendFile(
          tmp,
          JSON.stringify({
            ...(typeof r.t === "string" && /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(r.t)
              ? { t: r.t }
              : {}),
            event: r.event,
            ...project(raw.event, metricsOf(raw.event, r)),
          }) + "\n",
        );
      }
    } finally {
      lines.close();
    }
    await NodeFSP.rename(tmp, file);
  };
  enqueue(async () => {
    await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true, mode: 0o700 });
    await scrub(path);
    await scrub(`${path}.1`);
  });
  const append = async (file: string, line: string, header: boolean) => {
    await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true, mode: 0o700 });
    const size = await NodeFSP.stat(file).then(
      (s) => s.size,
      () => 0,
    );
    if (size > rotateBytes) await NodeFSP.rename(file, `${file}.1`).catch(() => undefined);
    if (header && (size === 0 || size > rotateBytes))
      await NodeFSP.writeFile(file, HEADER, { mode: 0o600 });
    await NodeFSP.appendFile(file, line, { mode: 0o600 });
  };
  return {
    path,
    record<E extends MetricEvent>(
      event: E,
      fields: EventFields<E> = {} as EventFields<E>,
      detail: Readonly<Record<string, unknown>> = {},
    ) {
      const r = Object.freeze({
        t: new Date(now()).toISOString(),
        event,
        ...project(event, fields),
      });
      const line = JSON.stringify(r) + "\n";
      for (const listener of listeners)
        try {
          listener(r);
        } catch {
          /* telemetry cannot stop coordination or other subscribers */
        }
      const debugLine = debugState().on
        ? JSON.stringify({ ...r, ...detail, t: r.t, event }) + "\n"
        : null;
      enqueue(async () => {
        await append(path, line, true);
        if (debugLine && debugState().on) await append(debug, debugLine, false);
      });
    },
    idle: () => queue,
    subscribe(listener: (r: MetricRecord) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    debugState,
    setDebugUntil(end: number | null, { keep = false }: { keep?: boolean } = {}) {
      const wasOn = debugState().on;
      until = end;
      if (end !== null && !keep)
        enqueue(async () => {
          await NodeFSP.mkdir(NodePath.dirname(debug), { recursive: true, mode: 0o700 });
          await NodeFSP.writeFile(debug, "", { mode: 0o600 });
        });
      return wasOn;
    },
    deleteDebug() {
      enqueue(async () => {
        await NodeFSP.rm(debug, { force: true });
        await NodeFSP.rm(`${debug}.1`, { force: true });
      });
    },
  };
}
export type MetricsLog = ReturnType<typeof createMetricsLog>;

// @effect-diagnostics nodeBuiltinImport:off globalDate:off preferSchemaOverJson:off - a JSON-lines log file for experiments, stamped with wall-clock time.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * The coordination log: every event of the broker as one JSON line, appended in order and set
 * aside past 20 MiB, so a run can be read back exactly.
 *
 * @module peerHub/core/broker/log
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { CoordinationBroker } from "./Broker.ts";

const LOG_ROTATE_BYTES = 20 * 1024 * 1024;

export function log(this: CoordinationBroker, event: string, fields: Record<string, unknown>) {
  const line = `${JSON.stringify({ t: new Date().toISOString(), event, ...fields })}\n`;
  this.logQueue = this.logQueue
    .then(async () => {
      await NodeFSP.mkdir(NodePath.dirname(this.host.logPath), { recursive: true });
      const size = await NodeFSP.stat(this.host.logPath).then(
        (stat) => stat.size,
        () => 0,
      );
      if (size > LOG_ROTATE_BYTES) {
        await NodeFSP.rename(this.host.logPath, `${this.host.logPath}.1`).catch(() => undefined);
      }
      await NodeFSP.appendFile(this.host.logPath, line);
    })
    .catch(() => undefined);
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

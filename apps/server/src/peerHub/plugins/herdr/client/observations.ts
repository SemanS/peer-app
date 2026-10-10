// @effect-diagnostics nodeBuiltinImport:off - Peer reads the files an agent changed from git in its checkout.
/**
 * What Peer observes of herdr's agents after the fact: the files they changed, when a turn
 * finished, and how much of that a coordination report can carry.
 *
 * @module peerHub/plugins/herdr/client/observations
 */
import * as NodeChildProcess from "node:child_process";

import type { PeerWorkStatus } from "@t3tools/contracts";

import type { HerdrAgent } from "./herdr.ts";

/** Paths from Git's NUL-delimited status; rename/copy records carry an extra source path. */
export function herdrStatusPaths(status: string): ReadonlyArray<string> {
  const entries = status.split("\0");
  const paths = new Set<string>();
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    if (entry.length < 4 || entry[2] !== " ") continue;
    paths.add(entry.slice(3));
    if (entry.slice(0, 2).includes("R") || entry.slice(0, 2).includes("C")) {
      const source = entries[++index];
      if (source) paths.add(source);
    }
  }
  return [...paths].toSorted();
}

/** Live enforcement sessions take precedence over observations within the hub's report limit. */
export function boundHerdrObservations<T>(
  primary: ReadonlyArray<T>,
  observations: ReadonlyArray<T>,
) {
  const available = Math.max(0, 50 - primary.length);
  return {
    sessions: [...primary, ...observations.slice(0, available)],
    skipped: Math.max(0, observations.length - available),
  };
}

/** Observes uncommitted paths in this worktree after work; it cannot attribute every change to its agent. */
export function readHerdrChangedPaths(cwd: string): Promise<ReadonlyArray<string> | null> {
  return new Promise((resolve) => {
    NodeChildProcess.execFile(
      "git",
      ["-C", cwd, "status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { timeout: 3000, maxBuffer: 1024 * 1024, encoding: "utf8", windowsHide: true },
      (error, stdout) => resolve(error === null ? herdrStatusPaths(stdout) : null),
    );
  });
}

/** completion_seq catches a whole turn between polls; old servers need an observed working → idle edge. */
export class HerdrCompletionTracker {
  private readonly observed = new Map<
    string,
    { status: PeerWorkStatus; seq: number | undefined }
  >();

  completed(agent: HerdrAgent): boolean {
    const key = [
      agent.terminalId,
      agent.agent,
      agent.session?.id,
      agent.session?.path,
      agent.cwd,
    ].join("\0");
    const before = this.observed.get(key);
    this.observed.set(key, { status: agent.status, seq: agent.completionSeq });
    if (this.observed.size > 500) this.observed.delete(this.observed.keys().next().value!);
    if (agent.status !== "idle" && agent.status !== "done") return false;
    return agent.completionSeq !== undefined
      ? agent.completionSeq !== before?.seq
      : before?.status === "working";
  }
}

import {
  WS_METHODS,
  type PeerHandoffPackage,
  type PeerHandoffOutcome,
  type PeerHandoffStatus,
  type PeerHandoffPlace,
  type PeerTask,
  type PeerWorkThread,
} from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
export function createPeerHandoffAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    peerHandoffRead: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "peer:handoff:read",
      tag: WS_METHODS.peerHandoffRead,
      staleTimeMs: Infinity,
    }),
    peerHandoffHandOff: createEnvironmentRpcCommand(runtime, {
      label: "peer:handoff:handOff",
      tag: WS_METHODS.peerHandoffHandOff,
    }),
    peerHandoffWithdraw: createEnvironmentRpcCommand(runtime, {
      label: "peer:handoff:withdraw",
      tag: WS_METHODS.peerHandoffWithdraw,
    }),
    peerHandoffSetTarget: createEnvironmentRpcCommand(runtime, {
      label: "peer:handoff:setTarget",
      tag: WS_METHODS.peerHandoffSetTarget,
    }),
  };
}
export function canHandOff(
  task: Pick<PeerTask, "id" | "status">,
  threads: ReadonlyArray<Pick<PeerWorkThread, "task" | "email">>,
  me: string | null,
) {
  return task.status === "done" || !me || !threads.some((t) => t.task === task.id && t.email === me)
    ? null
    : task.status === "review"
      ? "Update handoff"
      : "Hand off for review";
}
export const contextMovedOn = (p: PeerHandoffPackage, current: number | null) =>
  !p.context || p.context.version === current
    ? null
    : current === null
      ? "The shared context no longer exists."
      : `The context moved on to v${current}. Read peer context ${p.key ?? p.task}.`;
export const isEarlierHandoff = (task: Pick<PeerTask, "status">) => task.status !== "review";
export const outcomeText = (o: PeerHandoffOutcome) =>
  [
    o.notices.includes("Own handoff package withdrawn; task status unchanged.")
      ? "Handoff package withdrawn."
      : o.stored
        ? `Handoff #${o.number} ${o.changed ? "stored" : "already current"}.`
        : "Handoff package not stored.",
    ...o.notices,
    ...o.targets.map((t) => `${t.url}: ${t.reason}.`),
  ].map((l) => l.replaceAll(/[\n\r]/g, " "));
export const summaryOf = (s: PeerHandoffStatus | undefined, p: PeerHandoffPlace) =>
  s?.summaries.filter(
    (v) => v.workspace === p.workspace && v.project === p.projectId && v.task === p.taskId,
  ) ?? [];
/** Every author's number participates: another author's first package must invalidate the read. */
export const handoffRevision = (
  summaries: ReadonlyArray<{ author: string; number: number }>,
  local = 0,
) =>
  `${summaries
    .map((s) => `${s.author}:${s.number}`)
    .sort()
    .join("|")};${local}`;
export function packageRows(
  p: PeerHandoffPackage,
  nameOf: (email: string) => string = () => "a teammate",
) {
  return [
    p.context?.gist ?? "",
    ...(p.context?.sections.flatMap((s) => [
      s.name + (s.shortened ? " (shortened)" : ""),
      ...s.lines,
    ]) ?? []),
    ...(p.context?.projectLines ?? []),
    ...p.inputs.map(
      (i) =>
        `${i.key ?? i.scope}${i.title ? ` · ${i.title}` : ""}: read v${i.readVersion}; ${i.currentVersion === null ? "no longer exists" : `current v${i.currentVersion}${i.currentVersion !== i.readVersion ? " (changed since read)" : ""}`}`,
    ),
    ...p.overlaps.map(
      (o) =>
        `${o.state} with ${o.partner ? nameOf(o.partner) : "a teammate"}: ${o.files.join(", ")}${o.agreement ? ` · ${o.agreement}` : ""}`,
    ),
  ].filter(Boolean);
}

export function keyedLines(lines: ReadonlyArray<string>) {
  const seen = new Map<string, number>();
  return lines.map((text) => {
    const n = seen.get(text) ?? 0;
    seen.set(text, n + 1);
    return { id: `${text}:${n}`, text };
  });
}

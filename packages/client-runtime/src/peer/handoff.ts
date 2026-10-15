import {
  WS_METHODS,
  type PeerHandoffPackage,
  type PeerHandoffOutcome,
  type PeerHandoffStatus,
  type PeerHandoffPlace,
  type PeerTask,
  type PeerWorkContext,
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
/**
 * The task context changed after a handoff was built: the version the handoff was built from, the
 * one there is now and the context's scope, which Compare and Open task context go to. Screens say
 * it their own way (the web banner, the phone's `contextMovedLine`).
 */
export interface ContextMovedOn {
  readonly read: number;
  /** Null once the context no longer exists. */
  readonly latest: number | null;
  /** `task:<id>`. */
  readonly context: string;
}
/** `current` is the version of the task's context there is now, null when there is none. */
export const contextMovedOn = (
  p: PeerHandoffPackage,
  current: number | null,
): ContextMovedOn | null =>
  !p.context || p.context.version === current
    ? null
    : { read: p.context.version, latest: current, context: `task:${p.task}` };
/** The moved-on fact as one sentence, for a screen without a banner (the phone). */
export function contextMovedLine(p: PeerHandoffPackage, current: number | null): string | null {
  const moved = contextMovedOn(p, current);
  if (moved === null) return null;
  const lead = `The task context changed after this handoff: it was built from v${moved.read}`;
  return moved.latest === null
    ? `${lead} and no longer exists.`
    : `${lead}, the latest is v${moved.latest}.`;
}
/**
 * Who wrote the latest version, as the banner says it after "the latest is v4,": "written by Ana’s
 * agent", "restored from v2 by you", nothing when the Hub does not say. `me` is the viewer's email.
 */
export function contextWritten(
  latest: Pick<PeerWorkContext, "updatedBy" | "updatedSession" | "restoredFrom"> | undefined,
  nameOf: (email: string) => string,
  me: string | null,
): string {
  if (latest?.updatedBy === undefined) return "";
  const mine = latest.updatedBy === me;
  return latest.updatedSession === undefined && latest.restoredFrom !== undefined
    ? `restored from v${latest.restoredFrom} by ${mine ? "you" : nameOf(latest.updatedBy)}`
    : `written by ${mine ? "your" : `${nameOf(latest.updatedBy)}’s`} agent`;
}
export const isEarlierHandoff = (task: Pick<PeerTask, "status">) => task.status !== "review";
/**
 * Said beside the publishing choice: a package already written stays where it is when the choice
 * changes, so it is Withdraw, not the new choice, that takes it away.
 */
export const TARGET_SWITCH_NOTE =
  "Switching leaves earlier copies where they are, in the description or as a comment; Withdraw removes both.";
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

/** How many lines the Hub keeps in a section of a handoff (`MAX_LINES` in its handoff composer). */
const HANDOFF_LINES_PER_SECTION = 8;

const LEADING_BULLET = /^[-*•](?:\s+|$)/u;

/**
 * A handoff line as a person reads it. The Hub keeps the bullet an agent wrote ("- ", "* " or
 * "• ") and the page draws its own, so one leading bullet goes; the rest is the agent's inline
 * markdown.
 */
export const handoffLineText = (line: string) => line.trim().replace(LEADING_BULLET, "").trim();

/** A section's lines to show: bullet-free, none empty, each keyed apart from its repeats. */
export function handoffLines(lines: ReadonlyArray<string>) {
  return keyedLines(lines).flatMap(({ id, text }) => {
    const shown = handoffLineText(text);
    return shown === "" ? [] : [{ id, text: shown }];
  });
}

/** What a shortened section says about the rest; `whose` names the colleague whose chat holds it. */
export const shortenedNote = (whose: string | null = null) =>
  `Peer keeps ${HANDOFF_LINES_PER_SECTION} lines per section; the rest is in ${
    whose === null ? "the chat" : `${whose}’s chat, on their computer`
  }.`;

type HandoffInput = PeerHandoffPackage["inputs"][number];

/** What an agent read, as the page names it: "KRK-310 task context", "Project context". */
export const inputLabel = (input: Pick<HandoffInput, "scope" | "key" | "title">) =>
  input.scope === "project"
    ? "Project context"
    : `${input.key ?? input.title ?? input.scope} task context`;

/** Whether what an agent read is still the latest, changed since (and can be compared) or gone. */
export const inputState = (input: Pick<HandoffInput, "readVersion" | "currentVersion">) =>
  input.currentVersion === null
    ? "gone"
    : input.currentVersion === input.readVersion
      ? "current"
      : "changed";

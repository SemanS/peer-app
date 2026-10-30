import {
  WS_METHODS,
  type PeerAcceptanceVia,
  type PeerHandoffDelivery,
  type PeerHandoffDeliveryState,
  type PeerHandoffPackage,
  type PeerReviewSignal,
  type PeerTestReport,
  type PeerHandoffOutcome,
  type PeerHandoffStatus,
  type PeerHandoffPlace,
  type PeerHubStatus,
  type PeerTask,
  type PeerWorkContext,
  type PeerWorkThread,
} from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
import type { DependentsGroup } from "./readiness.ts";
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
/**
 * The version of the task's shared context as this computer knows it: null when there is none now,
 * undefined when it cannot tell. Shared contexts reach a computer through agent coordination, so
 * with that off every context looks absent, and saying one "no longer exists" would be a guess.
 */
export const currentContextVersion = (
  coordination: Pick<PeerHubStatus["coordination"], "enabled" | "contexts">,
  place: PeerHandoffPlace,
): number | null | undefined =>
  coordination.enabled
    ? (coordination.contexts.find(
        (c) =>
          c.workspace === place.workspace &&
          c.project === place.projectId &&
          c.scope === `task:${place.taskId}`,
      )?.version ?? null)
    : undefined;
/** `current` is what `currentContextVersion` says; nothing moved on that this computer cannot see. */
export const contextMovedOn = (
  p: PeerHandoffPackage,
  current: number | null | undefined,
): ContextMovedOn | null =>
  !p.context || current === undefined || p.context.version === current
    ? null
    : { read: p.context.version, latest: current, context: `task:${p.task}` };
/** The moved-on fact as one sentence, for a screen without a banner (the phone). */
export function contextMovedLine(
  p: PeerHandoffPackage,
  current: number | null | undefined,
): string | null {
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

/**
 * A review policy's signals in words, for the settings section and the review page's Needs
 * attention: what in the Hub's facts asks for a person.
 */
export const REVIEW_SIGNAL_WORDS: Readonly<Record<PeerReviewSignal, string>> = {
  "no-report": "The task has no test report",
  failed: "The newest test report has a failed item",
  unowned: "An unverified item has neither an owner nor a task",
  "not-delivered": "The change is not shared: delivery absent, none or local",
  "open-overlap": "The session has an open overlap",
  "owner-call": "An owner's call is pending or declined",
};

/** What the decision line offers: Mark done, Reopen with a note, Withdraw acceptance. */
export type DecisionAction = "done" | "reopen" | "withdraw";

/**
 * The review page's first line: the decision the policy asks of the person ("Accept 1.1? 2
 * signals: not-delivered, unowned"), or that none is asked ("Accepted by policy v3 · waiting to
 * land", "Accepted by Ana"), with the actions that sit on it. Whether the person may take them is
 * the page's to decide (`mayAccept`).
 */
export interface DecisionLine {
  readonly kind: "ask" | "accepted-by-policy" | "accepted" | "done";
  readonly text: string;
  readonly signals: ReadonlyArray<PeerReviewSignal>;
  readonly actions: ReadonlyArray<DecisionAction>;
}

/** A current acceptance as the decision line reads it: the package's, the status's or the task's. */
export interface DecisionAcceptance {
  readonly by: string;
  readonly via?: PeerAcceptanceVia | undefined;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The decision line of a package. `acceptance` is the task's current acceptance (the package's
 * own by default; pass null when it was withdrawn or given before reopening); `status` the task's
 * (review by default).
 */
export function decisionLine(
  pkg: Pick<PeerHandoffPackage, "task" | "key" | "policy" | "acceptance">,
  acceptance: DecisionAcceptance | null | undefined = pkg.acceptance,
  options: {
    readonly status?: "open" | "review" | "done";
    readonly nameOf?: (email: string) => string;
  } = {},
): DecisionLine {
  const status = options.status ?? "review";
  const nameOf = options.nameOf ?? ((email: string) => email);
  const signals = pkg.policy?.signals ?? [];
  if (acceptance !== null && acceptance !== undefined) {
    if (acceptance.via === "policy") {
      const version = pkg.policy === undefined ? "" : ` v${pkg.policy.version}`;
      return {
        kind: "accepted-by-policy",
        text: `Accepted by policy${version}${status === "review" ? " · waiting to land" : ""}`,
        signals,
        actions: ["withdraw"],
      };
    }
    return {
      kind: "accepted",
      text: `Accepted by ${nameOf(acceptance.by)}`,
      signals,
      actions: ["withdraw"],
    };
  }
  if (status === "done") return { kind: "done", text: "Done", signals, actions: [] };
  const name = pkg.key ?? pkg.task;
  const said =
    signals.length > 0
      ? ` ${plural(signals.length, "signal", "signals")}: ${signals.join(", ")}`
      : pkg.policy === undefined
        ? ""
        : " No signals";
  return { kind: "ask", text: `Accept ${name}?${said}`, signals, actions: ["done", "reopen"] };
}

/** Counts of a report's items by where their claim comes from. */
export interface VerifiedCounts {
  /** Passed items Peer saw the session run. */
  readonly seen: number;
  /** Passed items only their author reports. */
  readonly authorReported: number;
  readonly failed: number;
  /** Unverified items a dependent task covers. */
  readonly leftToTasks: number;
  /** Unverified items a person answers for. */
  readonly owned: number;
  /** Unverified items with neither owner nor task. */
  readonly needsOwner: number;
}

/**
 * The Verified chip: "6 author-reported · 1 left to a task · 1 needs an owner", counted by
 * provenance from the newest report's items. `attention` when nothing was reported, an item
 * failed or one needs an owner.
 */
export function verifiedChip(report: Pick<PeerTestReport, "items"> | undefined): {
  readonly text: string;
  readonly counts: VerifiedCounts | undefined;
  readonly attention: boolean;
} {
  if (report === undefined) return { text: "No test report", counts: undefined, attention: true };
  const counts: VerifiedCounts = {
    seen: 0,
    authorReported: 0,
    failed: 0,
    leftToTasks: 0,
    owned: 0,
    needsOwner: 0,
  };
  const add = (key: keyof VerifiedCounts) => {
    (counts as { -readonly [K in keyof VerifiedCounts]: number })[key] += 1;
  };
  for (const item of report.items) {
    if (item.kind === "fail") add("failed");
    else if (item.kind === "pass") add(item.seen === undefined ? "authorReported" : "seen");
    else if (item.task !== undefined) add("leftToTasks");
    else if (item.owner !== undefined) add("owned");
    else add("needsOwner");
  }
  const parts = [
    counts.seen > 0 ? `${counts.seen} seen run by Peer` : "",
    counts.authorReported > 0 ? `${counts.authorReported} author-reported` : "",
    counts.failed > 0 ? `${counts.failed} failed` : "",
    counts.leftToTasks > 0
      ? `${counts.leftToTasks} left to ${counts.leftToTasks === 1 ? "a task" : "tasks"}`
      : "",
    counts.owned > 0 ? `${counts.owned} with an owner` : "",
    counts.needsOwner > 0
      ? `${counts.needsOwner} ${counts.needsOwner === 1 ? "needs" : "need"} an owner`
      : "",
  ].filter((part) => part !== "");
  return {
    text: parts.length === 0 ? "No items" : parts.join(" · "),
    counts,
    attention: counts.failed > 0 || counts.needsOwner > 0,
  };
}

/** How the Delivered chip names a computer: its label from the environment id the fact carries. */
export interface DeliveryNames {
  readonly computer: (environment: string) => string;
}

/** "PR #12" for a GitHub pull request url, the url otherwise. */
export const pullRequestName = (url: string) => {
  const number = /\/pull\/(\d+)(?:[/?#]|$)/u.exec(url)?.[1];
  return number === undefined ? url : `PR #${number}`;
};

const short = (id: string) => id.slice(0, 8);

/**
 * The Delivered chip: the state and where ("shared · feature/x, PR #12", "none · 2 files
 * untracked, Slavo's Mac"), and on which computer Peer saw it (`observed`, "as Peer saw it on
 * Slavo's Mac"). A package without the fact says "not observed".
 */
export function deliveredChip(
  delivery: PeerHandoffDelivery | undefined,
  names: DeliveryNames,
): {
  readonly state: PeerHandoffDeliveryState | "not-observed";
  readonly text: string;
  readonly observed: string | null;
  readonly attention: boolean;
} {
  if (delivery === undefined)
    return { state: "not-observed", text: "not observed", observed: null, attention: true };
  const computer = names.computer(delivery.environment);
  const { evidence } = delivery;
  const pulls = (evidence.pullRequests ?? []).map(pullRequestName);
  const changes = (evidence.changes ?? []).map(short);
  const where = (...parts: ReadonlyArray<string | undefined>) =>
    parts.filter((part): part is string => part !== undefined && part !== "").join(", ");
  let detail: string;
  switch (delivery.state) {
    case "none": {
      const untracked = evidence.untracked?.length ?? 0;
      const uncommitted = evidence.uncommitted?.length ?? 0;
      detail = where(
        untracked > 0 ? `${plural(untracked, "file", "files")} untracked` : undefined,
        uncommitted > 0
          ? untracked > 0
            ? `${uncommitted} uncommitted`
            : `${plural(uncommitted, "file", "files")} uncommitted`
          : undefined,
        untracked + uncommitted === 0 ? "uncommitted changes" : undefined,
        computer,
      );
      break;
    }
    case "local":
      detail = where(evidence.branch, ...changes, "not pushed", computer);
      break;
    case "shared":
      detail = where(evidence.branch, ...(evidence.bookmarks ?? []), ...changes, ...pulls);
      break;
    case "landed":
      detail = where(
        ...pulls,
        pulls.length === 0 && evidence.commit !== undefined ? short(evidence.commit) : undefined,
      );
      break;
  }
  return {
    state: delivery.state,
    text: detail === "" ? delivery.state : `${delivery.state} · ${detail}`,
    observed: `as Peer saw it on ${computer}`,
    attention: delivery.state === "none" || delivery.state === "local",
  };
}

/**
 * The Provides chip: the session's plan `provides` lines, else the brief's outcome, and who waits
 * for the task with what else each waits for (`dependentsReadiness`).
 */
export function providesChip(
  planLines: ReadonlyArray<string>,
  briefOutcome: string | null | undefined,
  readiness: ReadonlyArray<Pick<DependentsGroup, "line">>,
): {
  readonly source: "plan" | "brief" | "none";
  readonly lines: ReadonlyArray<string>;
  readonly waiting: ReadonlyArray<string>;
} {
  const plan = planLines.map((line) => line.trim()).filter((line) => line !== "");
  const outcome = briefOutcome?.trim() ?? "";
  return {
    source: plan.length > 0 ? "plan" : outcome !== "" ? "brief" : "none",
    lines: plan.length > 0 ? plan : outcome !== "" ? [outcome] : [],
    waiting: readiness.map((group) => group.line),
  };
}

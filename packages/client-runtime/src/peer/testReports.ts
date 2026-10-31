/**
 * The test-reports plugin's client logic, for web and the phone alike: a task's reports as the Hub
 * keeps them (the newest per author), the words of a result and of an item's mark, who may give an
 * unverified item an owner, and the one-line facts the task row and the Team page show. The Hub
 * decides every change; nothing here judges whether a report is true. An item is "seen run by
 * Peer" only when the session's own hook saw that exact command, and is never called verified.
 *
 * @module peer/testReports
 */
import {
  WS_METHODS,
  type EnvironmentId,
  type PeerHandoffPackage,
  type PeerHubStatus,
  type PeerProject,
  type PeerTestReport,
  type PeerTestReportItem,
  type PeerTestReportSummary,
  type PeerTestsFileInput,
  type PeerTestsInherited,
  type PeerTestsPlace,
  type PeerTestsSetOwnerResult,
  type PeerWorkspaceState,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import { request } from "../rpc/client.ts";
import { createEnvironmentQueryAtomFamily, createEnvironmentRpcCommand } from "../state/runtime.ts";
import { projectOwnership, taskOwnerView } from "./ownershipRules.ts";

/**
 * The plugin's atoms, spread into the server atoms: a task's reports, read through the environment
 * while its page is open and again whenever `revision` (`testReportsRevision`, never sent) moves,
 * and what a person does with them: file or replace their own, remove it, and give an unverified
 * item an owner.
 */
export function createPeerTestReportsAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  const list = createEnvironmentQueryAtomFamily(runtime, {
    label: "peer:testReports:list",
    staleTimeMs: 0,
    idleTtlMs: 0,
    execute: (input: PeerTestsPlace & { readonly revision: string }) =>
      request(WS_METHODS.peerTestsList, {
        workspace: input.workspace,
        project: input.project,
        task: input.task,
      }),
  });
  const inherited = createEnvironmentQueryAtomFamily(runtime, {
    label: "peer:testReports:inherited",
    staleTimeMs: 0,
    idleTtlMs: 0,
    execute: (input: PeerTestsPlace & { readonly revision: string }) =>
      request(WS_METHODS.peerTestsInherited, {
        workspace: input.workspace,
        project: input.project,
        task: input.task,
      }),
  });
  return {
    peerTestsInherited: (target: {
      readonly environmentId: EnvironmentId;
      readonly input: PeerTestsPlace;
      readonly revision: string;
    }) =>
      inherited({
        environmentId: target.environmentId,
        input: { ...target.input, revision: target.revision },
      }),
    peerTestsList: (target: {
      readonly environmentId: EnvironmentId;
      readonly input: PeerTestsPlace;
      readonly revision: string;
    }) =>
      list({
        environmentId: target.environmentId,
        input: { ...target.input, revision: target.revision },
      }),
    peerTestsFile: createEnvironmentRpcCommand(runtime, {
      label: "peer:testReports:file",
      tag: WS_METHODS.peerTestsFile,
    }),
    peerTestsRemove: createEnvironmentRpcCommand(runtime, {
      label: "peer:testReports:remove",
      tag: WS_METHODS.peerTestsRemove,
    }),
    peerTestsSetOwner: createEnvironmentRpcCommand(runtime, {
      label: "peer:testReports:setOwner",
      tag: WS_METHODS.peerTestsSetOwner,
    }),
  };
}

type Summaries = Pick<PeerHubStatus, "testReports">;

const time = (at: string) => {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : 0;
};

/** Newest first; the same moment falls back to the author, so every client orders alike. */
const newestFirst = <T extends { readonly at: string; readonly author: string }>(a: T, b: T) =>
  time(b.at) - time(a.at) || a.author.localeCompare(b.author);

/** The summaries of a task's reports in the status, newest first. */
export function taskSummaries(
  status: Summaries,
  place: PeerTestsPlace,
): ReadonlyArray<PeerTestReportSummary> {
  return (status.testReports?.summaries ?? [])
    .filter(
      (s) =>
        s.workspace === place.workspace && s.project === place.project && s.task === place.task,
    )
    .sort(newestFirst);
}

/** The task's newest report, as the status counts it; undefined while it has none. */
export const newestSummary = (status: Summaries, place: PeerTestsPlace) =>
  taskSummaries(status, place)[0];

/**
 * The summaries of a task's governing reports: the newest of each role, as the Hub reads signals. An
 * author's later pass leaves a review session's failure standing.
 */
export function governingSummaries(status: Summaries, place: PeerTestsPlace) {
  const seen = new Set<string>();
  return taskSummaries(status, place).filter((summary) => {
    if (seen.has(summary.role)) return false;
    seen.add(summary.role);
    return true;
  });
}

/**
 * The cache key of a task's reports: every author's number and how many items wait for an owner,
 * so a new report and an owner given to an item each read the reports again.
 */
export const testReportsRevision = (status: Summaries, place: PeerTestsPlace) =>
  taskSummaries(status, place)
    .map((s) => `${s.author}:${s.number}:${s.unowned}:${(s.asks ?? []).length}`)
    .sort()
    .join("|");

/** The cache key of what a task inherits: any report of its project moved. */
export const projectReportsRevision = (
  status: Summaries,
  place: Pick<PeerTestsPlace, "workspace" | "project">,
) =>
  (status.testReports?.summaries ?? [])
    .filter((s) => s.workspace === place.workspace && s.project === place.project)
    .map((s) => `${s.task}:${s.author}:${s.number}`)
    .sort()
    .join("|");

/** One item a dependency left to a task, as web and the phone list it. */
export interface InheritedRow {
  readonly key: string;
  readonly kind: "failed" | "unverified";
  readonly text: string;
  /** "From 1.1 · report 2 · Ana". */
  readonly source: string;
}

/** What a task inherited, with the source task and report. */
export function inheritedRows(
  inherited: PeerTestsInherited,
  nameOf: (email: string) => string,
): ReadonlyArray<InheritedRow> {
  return inherited.items.map((item) => ({
    key: `${item.task}:${item.author}:${item.number}:${item.index}`,
    kind: item.failed ? "failed" : "unverified",
    text: item.text,
    source: `From ${item.key ?? item.title} · report ${item.number} · ${nameOf(item.author)}`,
  }));
}

/** A task's reports as its page lists them: newest first. */
export const orderedReports = (reports: ReadonlyArray<PeerTestReport>) =>
  [...reports].sort(newestFirst);

/** The counts a summary carries, from a whole report. */
export function reportCounts(report: Pick<PeerTestReport, "items">) {
  const of = (kind: PeerTestReportItem["kind"]) =>
    report.items.filter((item) => item.kind === kind).length;
  return {
    passed: of("pass"),
    failed: of("fail"),
    unverified: of("unverified"),
    unowned: report.items.filter((item) => item.kind === "unverified" && !item.owner).length,
  };
}

const items = (n: number) => (n === 1 ? "1 item needs" : `${n} items need`);

/** A task row's mark: "Tests: mixed · 1 item needs an owner", "Tests: pass". */
export const reportBadge = (report: Pick<PeerTestReportSummary, "result" | "unowned">) =>
  `Tests: ${report.result}${report.unowned === 0 ? "" : ` · ${items(report.unowned)} an owner`}`;

/**
 * The Team page's fact on a task's row: the newest result and the unverified items nobody answers
 * for, which wait on a person.
 */
export function teamFact(report: Pick<PeerTestReportSummary, "result" | "unowned">): {
  readonly text: string;
  readonly needsOwner: boolean;
} {
  const n = report.unowned;
  return {
    text:
      n === 0
        ? `Tests: ${report.result}`
        : `Tests: ${report.result} · ${n === 1 ? "1 unverified item needs" : `${n} unverified items need`} an owner`,
    needsOwner: n > 0,
  };
}

/** A time of day as a mark says it: "14:02", in the reader's own time. */
export const clockLabel = (at: string) => {
  const date = DateTime.make(at);
  return Option.isNone(date)
    ? ""
    : DateTime.formatLocal(date.value, {
        locale: "en-GB",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
};

/**
 * Where an item's claim comes from: "seen run by Peer, passed, 14:02" when Peer saw the session run
 * that command (a claim it saw fail says "failed", whatever the item says), "author-reported"
 * otherwise. An unverified item makes no claim, so it has no mark; its owner is what it shows.
 */
export function itemMark(
  item: Pick<PeerTestReportItem, "kind" | "seen">,
  clock: (at: string) => string = clockLabel,
): string | null {
  if (item.kind === "unverified") return null;
  if (item.seen === undefined) return "author-reported";
  const at = clock(item.seen.at);
  return `seen run by Peer, ${item.seen.failed ? "failed" : "passed"}${at === "" ? "" : `, ${at}`}`;
}

/** The check failed: its author says so, or Peer saw its command fail, whatever the item's kind. */
export const itemFailed = (item: Pick<PeerTestReportItem, "kind" | "seen">) =>
  item.kind === "fail" || item.seen?.failed === true;

/** The mark contradicts the item: a pass Peer saw fail, or a failure Peer saw pass. */
export const markDisagrees = (item: Pick<PeerTestReportItem, "kind" | "seen">) =>
  item.kind !== "unverified" &&
  item.seen !== undefined &&
  item.seen.failed !== (item.kind === "fail");

/**
 * Whether a person may give a report's unverified items an owner, as the Hub decides it: the
 * task's effective owner, the project's leads and the workspace's admins. Without the ownership
 * view (that plugin off, or not read yet) only leads and admins may.
 */
export function canAssignOwners(
  status: Pick<PeerHubStatus, "ownership" | "email">,
  workspace: Pick<PeerWorkspaceState, "slug" | "role">,
  project: Pick<PeerProject, "id" | "role" | "members">,
  task: { readonly id: string; readonly area?: string | undefined },
): boolean {
  if (project.role === "lead" || workspace.role !== "member") return true;
  return taskOwnerView(projectOwnership(status, workspace, project), task)?.mine === true;
}

/** The person's own report among a task's, by address. */
export const ownReport = (reports: ReadonlyArray<PeerTestReport>, me: string | null) =>
  me === null ? undefined : reports.find((r) => r.author.toLowerCase() === me.toLowerCase());

/** A filing form's items: one per non-empty line; an unverified line may end in `@person`. */
export interface ReportDraft {
  readonly result: PeerTestsFileInput["result"];
  readonly summary: string;
  readonly passed: string;
  readonly failed: string;
  readonly unverified: string;
}

const OWNER_AT_END = /\s+@(\S+)$/u;

const lines = (text: string) =>
  text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");

/** What a form says, as the Hub takes it; the Hub completes a short owner with the domain. */
export function draftItems(draft: ReportDraft): PeerTestsFileInput["items"] {
  return [
    ...lines(draft.passed).map((text) => ({ kind: "pass" as const, text })),
    ...lines(draft.failed).map((text) => ({ kind: "fail" as const, text })),
    ...lines(draft.unverified).flatMap((line) => {
      const owner = OWNER_AT_END.exec(line)?.[1];
      const text = owner === undefined ? line : line.replace(OWNER_AT_END, "").trim();
      if (text === "") return [];
      return [{ kind: "unverified" as const, text, ...(owner === undefined ? {} : { owner }) }];
    }),
  ];
}

/** A form that starts from the person's report, so Replace changes only what they change. */
export function draftOf(report: PeerTestReport | undefined): ReportDraft {
  const of = (kind: PeerTestReportItem["kind"]) =>
    (report?.items ?? [])
      .filter((item) => item.kind === kind)
      .map((item) =>
        kind === "unverified" && item.owner !== undefined
          ? `${item.text} @${item.owner}`
          : item.text,
      )
      .join("\n");
  return {
    result: report?.result ?? "pass",
    summary: report?.summary ?? "",
    passed: of("pass"),
    failed: of("fail"),
    unverified: of("unverified"),
  };
}

/** What a stale owner's save says: the report it was made from was replaced. */
export function staleOwnerLine(result: PeerTestsSetOwnerResult): string | null {
  return result.kind === "stale"
    ? `Not saved: report ${result.number} replaced the one you assigned from. Its items are shown now; assign again if it still needs it.`
    : null;
}

/**
 * The newest report as a handoff package carries it, in one line for the reviewer's card: "Tests:
 * mixed, 1 passed, 0 failed, 1 unverified · 'iPhone layout' needs an owner". Null for a package
 * without one, which says so in its own words.
 */
export function handoffReportLine(report: PeerHandoffPackage["report"]): string | null {
  if (report === undefined) return null;
  const counts = `${report.passed} passed, ${report.failed} failed, ${report.unverified} unverified`;
  const unowned =
    report.unowned.length === 0
      ? ""
      : ` · ${report.unowned.map((text) => `'${text}'`).join(", ")} ${report.unowned.length === 1 ? "needs" : "need"} an owner`;
  return `Tests: ${report.result}, ${counts}${unowned}`;
}

/**
 * Test reports on the phone, read-only: each report on the selected task with its result, author,
 * the author's role, when it was filed, and its items with their marks and owners. The words of a
 * result, a mark and a row's fact come from the shared test-reports helpers, so the phone says
 * "seen run by Peer, passed, 14:02" and "author-reported" exactly as web does. Filing a report and
 * giving an item an owner happen on a computer.
 */
import {
  clockLabel,
  itemMark,
  markDisagrees,
  orderedReports,
  reportBadge,
  reportCounts,
} from "@t3tools/client-runtime/peer/test-reports";
import type { PeerTestReport, PeerTestReportItem, PeerTestReportSummary } from "@t3tools/contracts";

type Member = { readonly email: string; readonly name: string };

/** One item as the section lists it. */
export interface ReportItemView {
  readonly key: string;
  readonly kind: PeerTestReportItem["kind"];
  /** "Passed", "Failed", "Unverified". */
  readonly kindLabel: string;
  readonly text: string;
  /** "seen run by Peer, passed, 14:02", "author-reported"; null for an unverified item. */
  readonly mark: string | null;
  /** Peer saw the command end the other way than the item says. */
  readonly disagrees: boolean;
  /** An unverified item's owner line: "Owner: Slavo", "Needs an owner"; null for a claim. */
  readonly owner: string | null;
  readonly needsOwner: boolean;
}

/** One report as the section shows it. */
export interface ReportView {
  readonly key: string;
  /** "Tests: mixed · 1 item needs an owner". */
  readonly heading: string;
  readonly result: PeerTestReport["result"];
  /** "Report 2 · Ana · review session · 14:02". */
  readonly byline: string;
  readonly summary: string;
  /** "1 passed · 0 failed · 1 unverified". */
  readonly counts: string;
  readonly shortened: boolean;
  readonly items: ReadonlyArray<ReportItemView>;
}

const KIND_LABEL: Readonly<Record<PeerTestReportItem["kind"], string>> = {
  pass: "Passed",
  fail: "Failed",
  unverified: "Unverified",
};

/** A member's name by address, "You" for the reader, else the address itself. */
export function personLabel(email: string, members: ReadonlyArray<Member>, me: string | null) {
  const lower = email.toLowerCase();
  if (me !== null && me.toLowerCase() === lower) return "You";
  return members.find((member) => member.email.toLowerCase() === lower)?.name ?? email;
}

/** The author's role at filing as people say it; a newer Hub's role by its name. */
export const authorRoleLabel = (role: string) =>
  role === "review" ? "review session" : role === "author" ? "author" : role;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** When a report was filed: "14:02" today, "Oct 27, 14:02" on another day, in the reader's time. */
export function filedAt(at: string, now: number): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return "";
  const today = new Date(now);
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const clock = clockLabel(at);
  return sameDay ? clock : `${MONTHS[date.getMonth()]} ${date.getDate()}, ${clock}`;
}

const countsLine = (counts: {
  readonly passed: number;
  readonly failed: number;
  readonly unverified: number;
}) => `${counts.passed} passed · ${counts.failed} failed · ${counts.unverified} unverified`;

/** A task's reports as the section shows them, newest first. */
export function reportViews(
  reports: ReadonlyArray<PeerTestReport>,
  context: {
    readonly members: ReadonlyArray<Member>;
    readonly me: string | null;
    readonly now: number;
  },
): ReadonlyArray<ReportView> {
  return orderedReports(reports).map((report) => {
    const counts = reportCounts(report);
    const when = filedAt(report.at, context.now);
    return {
      key: `${report.author}:${report.number}`,
      heading: reportBadge({ result: report.result, unowned: counts.unowned }),
      result: report.result,
      byline: [
        `Report ${report.number}`,
        personLabel(report.author, context.members, context.me),
        authorRoleLabel(report.role),
        when === "" ? null : when,
      ]
        .filter((part) => part !== null)
        .join(" · "),
      summary: report.summary,
      counts: countsLine(counts),
      shortened: report.shortened === true,
      items: report.items.map((item, index) => ({
        key: `${index}`,
        kind: item.kind,
        kindLabel: KIND_LABEL[item.kind],
        text: item.text,
        mark: itemMark(item),
        disagrees: markDisagrees(item),
        owner:
          item.kind !== "unverified"
            ? null
            : item.owner === undefined || item.owner === ""
              ? "Needs an owner"
              : `Owner: ${personLabel(item.owner, context.members, context.me)}`,
        needsOwner: item.kind === "unverified" && (item.owner === undefined || item.owner === ""),
      })),
    };
  });
}

/**
 * What the section says from the status alone, while the reports load or when they cannot be
 * read: one line per author, "Tests: mixed · 1 item needs an owner · Ana".
 */
export function summaryLines(
  summaries: ReadonlyArray<PeerTestReportSummary>,
  members: ReadonlyArray<Member>,
  me: string | null,
): ReadonlyArray<{ readonly key: string; readonly text: string }> {
  return summaries.map((summary) => ({
    key: `${summary.author}:${summary.number}`,
    text: `${reportBadge(summary)} · ${personLabel(summary.author, members, me)}`,
  }));
}

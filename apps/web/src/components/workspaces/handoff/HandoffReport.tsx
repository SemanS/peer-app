import {
  contextEvidence,
  contextSummary,
  currentContextSections,
  pendingFindingCount,
} from "@t3tools/client-runtime/peer/contextView";
import type { PeerContextView } from "@t3tools/contracts";
import {
  handoffLines,
  inputLabel,
  inputState,
  shortenedNote,
} from "@t3tools/client-runtime/peer/handoff";
import { handoffReportLine } from "@t3tools/client-runtime/peer/test-reports";
import { handoffAcceptanceLine } from "@t3tools/client-runtime/peer/acceptance";
import type { PeerHandoffPackage } from "@t3tools/contracts";
import {
  ChevronRightIcon,
  CircleAlertIcon,
  CircleArrowRightIcon,
  CircleCheckIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldQuestionIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../../lib/utils";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import ChatMarkdown from "../../ChatMarkdown";
import { InlineMarkdown } from "../../InlineMarkdown";
import { Badge } from "../../ui/badge";
import { Button, InlineButton } from "../../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../../ui/collapsible";
import { TONE_SURFACE } from "../signals";
import { contextComparison } from "../contextCompare.logic";
import { handoffPresentation } from "./handoffPresentation";

const SECTION_TITLE = {
  State: "Reported status",
  Provides: "What changed",
  Decisions: "Decisions",
  Blockers: "Needs attention",
  Next: "Next step",
} as const;

function ReportLines({
  lines,
  limit,
}: {
  readonly lines: ReadonlyArray<string>;
  readonly limit?: number;
}) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-4 text-sm leading-relaxed text-foreground">
      {handoffLines(lines)
        .slice(0, limit)
        .map(({ id, text }) => (
          <li key={id}>
            <div className={cn(limit !== undefined && "line-clamp-3 [overflow-wrap:anywhere]")}>
              <InlineMarkdown text={text} />
            </div>
          </li>
        ))}
    </ul>
  );
}

function ReportSection({
  section,
  mine,
  author,
  onOpenChat,
}: {
  readonly section: NonNullable<PeerHandoffPackage["context"]>["sections"][number];
  readonly mine: boolean;
  readonly author: string;
  readonly onOpenChat: (() => void) | undefined;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h4 className="text-sm font-semibold text-foreground">{SECTION_TITLE[section.name]}</h4>
      <ReportLines lines={section.lines} />
      {section.shortened ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {shortenedNote(mine ? null : author)}{" "}
          {mine && onOpenChat !== undefined ? (
            <InlineButton onClick={onOpenChat}>Open chat</InlineButton>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

/**
 * The task's newest test report as the Hub put it in the package, apart from the author's own
 * account above: its result and counts, and the unverified items nobody answers for yet.
 */
function TestReportLine({
  report,
  nameOf,
}: {
  readonly report: PeerHandoffPackage["report"];
  readonly nameOf: (email: string) => string;
}) {
  const line = handoffReportLine(report);
  return (
    <section aria-label="Test report" className="flex flex-col gap-1">
      <p className="text-sm font-medium text-foreground">Test report</p>
      {report === undefined || line === null ? (
        <p className="text-sm text-muted-foreground">No test report was filed.</p>
      ) : (
        <>
          <p
            className={cn(
              "text-sm leading-relaxed [overflow-wrap:anywhere]",
              report.unowned.length > 0 ? "text-warning-foreground" : "text-foreground",
            )}
          >
            {line}
          </p>
          <p className="text-xs text-muted-foreground">
            Report {report.number} by {nameOf(report.author)}
            {report.role === "review" ? " · review session" : ""},{" "}
            {formatRelativeTimeLabel(report.at)}. The task’s page shows each item and whether Peer
            saw it run.
          </p>
        </>
      )}
    </section>
  );
}

/** The acceptance the Hub joined to the package, when a lead gave one; nothing otherwise. */
function AcceptanceLine({
  acceptance,
  nameOf,
}: {
  readonly acceptance: PeerHandoffPackage["acceptance"];
  readonly nameOf: (email: string) => string;
}) {
  const line = handoffAcceptanceLine(acceptance, nameOf);
  if (line === null) return null;
  return (
    <p aria-label="Acceptance" className="text-sm text-success-foreground">
      {line}
    </p>
  );
}

export function HandoffReport({
  pkg,
  mine,
  busy,
  nameOf,
  contextWarning,
  onCompare,
  onOpenPull,
  onOpenChat,
  onWithdraw,
}: {
  readonly pkg: PeerHandoffPackage;
  readonly mine: boolean;
  readonly busy: boolean;
  readonly nameOf: (email: string) => string;
  readonly contextWarning: ReactNode;
  readonly onCompare: (scope: string, version: number) => void;
  readonly onOpenPull: (url: string) => void;
  readonly onOpenChat: (() => void) | undefined;
  readonly onWithdraw: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const {
    sections,
    result,
    blockers,
    blockersShortened,
    next,
    openOverlaps,
    changedInputs,
    pulls,
  } = handoffPresentation(pkg);
  const author = nameOf(pkg.author);
  const resultLines = handoffLines(result?.lines ?? []);
  const needsAttention = blockers !== undefined || openOverlaps.length > 0;
  const sectionProps = { mine, author, onOpenChat };

  return (
    <article
      aria-label={`Handoff #${pkg.number}`}
      className="min-w-0 overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex flex-col gap-5 p-4 sm:p-6">
        <header className="flex min-w-0 flex-col gap-1.5">
          <h3 className="text-lg leading-snug font-semibold break-words text-foreground">
            {pkg.title}
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Handoff #{pkg.number} from{" "}
            {pkg.source === "agent"
              ? mine
                ? "your agent"
                : `${author}’s agent`
              : mine
                ? "you"
                : author}
            , {formatRelativeTimeLabel(pkg.composedAt)}
          </p>
        </header>

        <section aria-label="What changed" className="flex flex-col gap-3">
          {pkg.context?.gist ? (
            <p className="line-clamp-3 max-w-prose text-base leading-relaxed text-foreground [overflow-wrap:anywhere]">
              <InlineMarkdown text={pkg.context.gist} />
            </p>
          ) : null}
          {result === undefined ? (
            pkg.context?.gist ? null : (
              <p className="text-sm text-muted-foreground">No result summary was included.</p>
            )
          ) : (
            <>
              <ReportLines lines={result.lines} limit={3} />
              {resultLines.length > 3 || result.shortened ? (
                <p className="text-xs text-muted-foreground">More in the full report below.</p>
              ) : null}
            </>
          )}
        </section>

        <div className="flex flex-col gap-1 border-t border-border/60 pt-4">
          <p className="text-sm font-medium text-foreground">Verification</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            This handoff records {pkg.source === "agent" ? "the agent’s" : "the author’s"} report.
            Tests and pull request status are not independently verified here.
          </p>
        </div>
        <TestReportLine report={pkg.report} nameOf={nameOf} />
        <AcceptanceLine acceptance={pkg.acceptance} nameOf={nameOf} />

        {contextWarning}
        {changedInputs.length === 0 ? null : (
          <section
            aria-label="Changed inputs"
            className={cn("flex flex-col gap-2 rounded-lg border p-4", TONE_SURFACE.needs)}
          >
            <h4 className="text-sm font-semibold text-warning-foreground">
              Shared inputs changed after the agent read them
            </h4>
            <ul className="flex flex-col gap-3">
              {changedInputs.map((input) => (
                <li key={input.scope} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 basis-48 text-sm break-words text-foreground">
                    {inputLabel(input)}: read v{input.readVersion}
                    {input.currentVersion === null
                      ? ", no longer exists"
                      : `, now v${input.currentVersion}`}
                  </span>
                  {contextComparison(input.readVersion, input.currentVersion ?? undefined) ===
                  null ? null : (
                    <Button
                      size="xs"
                      variant="warning-outline"
                      onClick={() => onCompare(input.scope, input.readVersion)}
                    >
                      Compare
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {needsAttention ? (
          <section
            aria-label="Needs attention"
            className={cn("flex flex-col gap-3 rounded-lg border p-4", TONE_SURFACE.needs)}
          >
            <h4 className="flex items-center gap-2 text-sm font-semibold text-warning-foreground">
              <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />
              Needs attention
            </h4>
            {blockers === undefined ? null : <ReportLines lines={blockers.lines} />}
            {openOverlaps.map((overlap) => (
              <p
                key={`${overlap.partner}:${overlap.at}:${overlap.files.join(",")}`}
                className="text-sm leading-relaxed text-foreground"
              >
                Unresolved overlap with{" "}
                {overlap.partner === null ? "a teammate" : nameOf(overlap.partner)}.
                {overlap.agreement ? (
                  <>
                    {" "}
                    <InlineMarkdown text={overlap.agreement} />
                  </>
                ) : (
                  " The agents have not recorded an agreement."
                )}
              </p>
            ))}
          </section>
        ) : null}

        {blockersShortened ? (
          <p role="status" className="text-sm text-warning-foreground">
            The blocker list was shortened. Check the original chat before reviewing.
          </p>
        ) : null}

        {next === undefined ? (
          <section className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold text-foreground">Next step</h4>
            <p className="text-sm leading-relaxed text-foreground">
              {pulls.length > 0
                ? "Review the pull request and its checks before marking this task done."
                : "Review the report below. Open the chat if you need more information."}
            </p>
          </section>
        ) : (
          <ReportSection section={next} {...sectionProps} />
        )}

        {pulls.length === 0 ? (
          mine && onOpenChat !== undefined ? (
            <div>
              <Button size="sm" onClick={onOpenChat}>
                Open original chat
              </Button>
            </div>
          ) : null
        ) : (
          <div className="flex flex-wrap gap-2">
            {pulls.map((url, index) => (
              <Button
                key={url}
                size="sm"
                variant={index === 0 ? "default" : "outline"}
                onClick={() => onOpenPull(url)}
              >
                Open PR #{url.split("/").at(-1)}
              </Button>
            ))}
          </div>
        )}
      </div>

      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-3 py-2 sm:px-5">
          <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
            <ChevronRightIcon
              aria-hidden
              className={cn(
                "transition-transform motion-reduce:transition-none",
                detailsOpen && "rotate-90",
              )}
            />
            Full report and coordination
          </CollapsibleTrigger>
          {mine ? (
            <Button size="xs" variant="ghost-muted" disabled={busy} onClick={onWithdraw}>
              Withdraw
            </Button>
          ) : null}
        </div>
        <CollapsiblePanel>
          <div className="flex min-w-0 flex-col gap-6 border-t border-border/60 p-4 sm:p-6">
            <section className="flex min-w-0 flex-col gap-2">
              <h4 className="text-sm font-semibold text-foreground">Source</h4>
              <p className="text-sm break-words text-muted-foreground">
                {mine ? "You" : author} ({pkg.author}),{" "}
                {pkg.source === "agent" ? "agent report" : "author report"}
              </p>
              <p className="text-xs text-muted-foreground">
                <time dateTime={pkg.composedAt}>{pkg.composedAt}</time>
                {pkg.context === null ? null : `, task context v${pkg.context.version}`}
              </p>
            </section>
            {pkg.context?.gist ? (
              <section className="flex min-w-0 flex-col gap-2">
                <h4 className="text-sm font-semibold text-foreground">Summary</h4>
                <p className="text-sm leading-relaxed text-foreground">
                  <InlineMarkdown text={pkg.context.gist} />
                </p>
              </section>
            ) : null}
            {sections.map((section) => (
              <ReportSection key={section.name} section={section} {...sectionProps} />
            ))}
            {(pkg.context?.projectLines.length ?? 0) === 0 ? null : (
              <section className="flex flex-col gap-2">
                <h4 className="text-sm font-semibold text-foreground">For the project</h4>
                <ReportLines lines={pkg.context!.projectLines} />
              </section>
            )}
            {pkg.overlaps.length === 0 ? null : (
              <section className="flex flex-col gap-3">
                <h4 className="text-sm font-semibold text-foreground">Coordination agreements</h4>
                {pkg.overlaps.map((overlap) => (
                  <div
                    key={`${overlap.partner}:${overlap.at}:${overlap.files.join(",")}`}
                    className="flex min-w-0 flex-col gap-1 text-sm leading-relaxed"
                  >
                    <p className="font-medium text-foreground">
                      {overlap.state === "settled" ? "Agreement recorded" : "Unresolved overlap"}{" "}
                      with {overlap.partner === null ? "a teammate" : nameOf(overlap.partner)}
                    </p>
                    {overlap.agreement ? (
                      <p className="text-foreground">
                        <InlineMarkdown text={overlap.agreement} />
                      </p>
                    ) : null}
                    <p className="font-mono text-xs break-all text-muted-foreground">
                      {overlap.files.join(", ")}
                    </p>
                  </div>
                ))}
              </section>
            )}
            {pkg.inputs.length === 0 ? null : (
              <section className="flex flex-col gap-3">
                <h4 className="text-sm font-semibold text-foreground">What the agent read</h4>
                <dl className="flex flex-col gap-3">
                  {pkg.inputs.map((input) => (
                    <div
                      key={input.scope}
                      className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm"
                    >
                      <dt className="min-w-0 break-words text-foreground">{inputLabel(input)}</dt>
                      <dd className="text-muted-foreground">
                        Read v{input.readVersion}
                        {inputState(input) === "current"
                          ? ", current"
                          : input.currentVersion === null
                            ? ", no longer exists"
                            : `, now v${input.currentVersion}`}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            {onOpenChat === undefined || !mine || pulls.length === 0 ? null : (
              <div>
                <Button variant="outline" size="sm" onClick={onOpenChat}>
                  Open original chat
                </Button>
              </div>
            )}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </article>
  );
}

function ClaimDetail({ detail }: { readonly detail: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger render={<Button variant="ghost" size="xs" />}>
        <ChevronRightIcon
          aria-hidden
          className={cn("transition-transform motion-reduce:transition-none", open && "rotate-90")}
        />
        {open ? "Hide details" : "Show details"}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="min-w-0 text-sm">
          <ChatMarkdown text={detail} cwd={undefined} />
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

const EVIDENCE_ICON = {
  neutral: ShieldQuestionIcon,
  success: ShieldCheckIcon,
  warning: ShieldAlertIcon,
} as const;

const SUMMARY_ICON = {
  progress: { Icon: CircleCheckIcon, className: "text-success-foreground" },
  attention: { Icon: CircleAlertIcon, className: "text-warning-foreground" },
  next: { Icon: CircleArrowRightIcon, className: "text-muted-foreground" },
} as const;

function SummaryItem({
  kind,
  title,
  lines,
  children,
}: {
  readonly kind: keyof typeof SUMMARY_ICON;
  readonly title: string;
  readonly lines: readonly string[];
  readonly children?: ReactNode;
}) {
  const { Icon, className } = SUMMARY_ICON[kind];
  if (lines.length === 0) return null;
  return (
    <section aria-label={title} className="flex min-w-0 gap-3">
      <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", className)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h4 className="text-base font-medium text-foreground">{title}</h4>
        {lines.length === 1 ? (
          <p className="text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">
            <InlineMarkdown text={lines[0]!} />
          </p>
        ) : (
          <ReportLines lines={lines} />
        )}
        {children}
      </div>
    </section>
  );
}

function SourceLinks({
  sources,
  onOpenSource,
}: {
  readonly sources: ReturnType<typeof currentContextSections>[number]["groups"][number]["sources"];
  readonly onOpenSource: (scope: string, revision?: string) => void;
}) {
  return sources.map((source, index) => (
    <span key={source.id}>
      {index === 0 ? "" : ", "}
      <InlineButton onClick={() => onOpenSource(source.scope, source.revision ?? undefined)}>
        {source.title}
      </InlineButton>
    </span>
  ));
}

const NO_DETAILS: readonly WorkDetail[] = [];

/** A view of the work beyond its status: the full context, its conversations, its activity. */
export interface WorkDetail {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
}

/**
 * Tabs under the work status; none is open until someone picks one, and picking the open one
 * closes it again.
 */
export function WorkDetailTabs({
  details,
  open,
  onOpen,
}: {
  readonly details: readonly WorkDetail[];
  readonly open: string | null;
  readonly onOpen: (id: string | null) => void;
}) {
  const current = details.find((detail) => detail.id === open);
  if (details.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div
        role="tablist"
        aria-label="Work details"
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${details.length}, minmax(0, 1fr))` }}
      >
        {details.map((detail) => (
          <Button
            key={detail.id}
            role="tab"
            id={`work-detail-${detail.id}`}
            aria-selected={detail.id === open}
            aria-controls={detail.id === open ? `work-detail-panel-${detail.id}` : undefined}
            size="sm"
            variant={detail.id === open ? "secondary" : "ghost"}
            onClick={() => onOpen(detail.id === open ? null : detail.id)}
          >
            <span className="truncate">{detail.label}</span>
          </Button>
        ))}
      </div>
      {current === undefined ? null : (
        <div
          role="tabpanel"
          id={`work-detail-panel-${current.id}`}
          aria-labelledby={`work-detail-${current.id}`}
          className="min-w-0"
        >
          {current.content}
        </div>
      )}
    </div>
  );
}

export function CurrentContextReport({
  view,
  title,
  onPageInputs,
  onPageFindings,
  onOpenSource,
  details = NO_DETAILS,
  keeper,
}: {
  readonly view: PeerContextView;
  /** What the card is about, such as "STR-5 · GPU inference node". */
  readonly title?: string | undefined;
  readonly onPageInputs: (cursor?: string) => void;
  readonly onPageFindings: (cursor?: string) => void;
  readonly onOpenSource: (scope: string, revision?: string) => void;
  /** Tabs under the status; a "full" one takes the place of each claim's own details. */
  readonly details?: readonly WorkDetail[];
  /** Who keeps the context now, for the details ("No active keeper"). */
  readonly keeper?: string | undefined;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [readsOpen, setReadsOpen] = useState(false);
  const [findingsOpen, setFindingsOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState<string | null>(null);
  const fullContext = details.some((detail) => detail.id === "full");
  const summary = contextSummary(view);
  const sections = currentContextSections(view);
  const groups = sections.flatMap((section) => section.groups);
  const sources = [
    ...new Map(
      groups.flatMap((group) => group.sources).map((source) => [source.id, source]),
    ).values(),
  ];
  const claimDetails = (key: (typeof sections)[number]["key"]) => {
    const values = sections
      .filter((section) => section.key === key)
      .flatMap((section) => section.groups.flatMap((group) => group.values))
      .filter((value) => value.detail !== undefined);
    if (values.length === 0) return null;
    return fullContext ? (
      <p className="text-xs">
        <InlineButton onClick={() => setDetailOpen("full")}>See the full context</InlineButton>
      </p>
    ) : (
      values.map((value) => <ClaimDetail key={value.text} detail={value.detail!} />)
    );
  };
  const evidence = contextEvidence(view);
  const EvidenceIcon = EVIDENCE_ICON[evidence.tone];
  const findings = pendingFindingCount(view);
  const hasReads = view.inputs.coverage.total > 0 || view.inputs.coverage.nextCursor !== null;
  return (
    <article
      aria-label={title ?? "Current status"}
      className="flex min-w-0 flex-col gap-5 rounded-xl border border-border bg-card p-4 sm:p-6"
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
          <h3 className="text-lg leading-snug font-semibold break-words text-foreground">
            {title ?? "Current status"}
          </h3>
          {summary.goal === undefined ? null : (
            <p className="text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              Goal: <InlineMarkdown text={summary.goal} />
            </p>
          )}
        </div>
        <Badge
          variant={
            summary.badge.tone === "warning"
              ? "warning"
              : summary.badge.tone === "success"
                ? "success"
                : "secondary"
          }
        >
          {summary.badge.label}
        </Badge>
      </header>

      <div className="flex flex-col gap-2">
        <div aria-hidden className="grid grid-cols-3 gap-1.5">
          {(["started", "reported", "verified"] as const).map((step, index) => (
            <span
              key={step}
              className={cn("h-1.5 rounded-full", summary.steps[index] ? "bg-success" : "bg-muted")}
            />
          ))}
        </div>
        <p className="flex flex-wrap justify-between gap-x-4 text-sm text-muted-foreground">
          <span>{summary.done}</span>
          {summary.pending === null ? null : <span>{summary.pending}</span>}
        </p>
      </div>

      {summary.progress.length + summary.attention.length + summary.next.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has been reported yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <SummaryItem kind="progress" title="Progress" lines={summary.progress}>
            {claimDetails("outcome")}
          </SummaryItem>
          <SummaryItem kind="attention" title="Needs attention" lines={summary.attention}>
            {claimDetails("attention")}
          </SummaryItem>
          <SummaryItem kind="next" title="Next" lines={summary.next}>
            {claimDetails("next")}
          </SummaryItem>
        </div>
      )}

      <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
        <CollapsibleTrigger
          render={<Button variant="ghost" size="sm" className="-ml-2 self-start" />}
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "transition-transform motion-reduce:transition-none",
              moreOpen && "rotate-90",
            )}
          />
          {findings === null || findings === 0
            ? "Details"
            : `Details · ${findings} pending findings`}
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="flex min-w-0 flex-col gap-4 pt-3">
            {sources.length === 0 ? null : (
              <p className="text-xs text-muted-foreground">
                Written in <SourceLinks sources={sources} onOpenSource={onOpenSource} />
              </p>
            )}

            {findings === null || findings === 0 ? null : (
              <section aria-label="Pending team findings" className="flex min-w-0 flex-col gap-1.5">
                <Collapsible open={findingsOpen} onOpenChange={setFindingsOpen}>
                  <CollapsibleTrigger
                    render={<Button variant="ghost" size="xs" className="-ml-2" />}
                  >
                    <ChevronRightIcon
                      aria-hidden
                      className={cn(
                        "transition-transform motion-reduce:transition-none",
                        findingsOpen && "rotate-90",
                      )}
                    />
                    Pending findings · {findings}
                  </CollapsibleTrigger>
                  <CollapsiblePanel>
                    <div className="flex flex-col gap-2 pt-2">
                      {view.pendingFindings.items.map((finding) => (
                        <p key={finding.id} className="text-sm text-foreground">
                          {finding.text}
                          <span className="block text-xs text-muted-foreground">
                            {finding.email} · {formatRelativeTimeLabel(finding.at)}
                          </span>
                        </p>
                      ))}
                      {view.pendingFindings.coverage.nextCursor === null ? null : (
                        <div className="flex gap-2">
                          <Button size="xs" variant="outline" onClick={() => onPageFindings()}>
                            First findings
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() =>
                              onPageFindings(view.pendingFindings.coverage.nextCursor!)
                            }
                          >
                            More findings
                          </Button>
                        </div>
                      )}
                    </div>
                  </CollapsiblePanel>
                </Collapsible>
              </section>
            )}

            {/* What the agent read, kept apart from whether its result was verified. */}
            <section aria-label="Recorded context reads" className="flex min-w-0 flex-col gap-1">
              <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
                <EvidenceIcon
                  aria-hidden
                  className={cn(
                    "size-4 shrink-0",
                    evidence.tone === "warning"
                      ? "text-warning-foreground"
                      : "text-muted-foreground",
                  )}
                />
                <span className="text-muted-foreground">Recorded context reads:</span>
                <span className="font-medium text-foreground">{evidence.label}</span>
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">{evidence.detail}</p>
              {!hasReads ? null : (
                <Collapsible open={readsOpen} onOpenChange={setReadsOpen}>
                  <CollapsibleTrigger
                    render={<Button variant="ghost" size="xs" className="-ml-2 self-start" />}
                  >
                    <ChevronRightIcon
                      aria-hidden
                      className={cn(
                        "transition-transform motion-reduce:transition-none",
                        readsOpen && "rotate-90",
                      )}
                    />
                    Recorded sources
                  </CollapsibleTrigger>
                  <CollapsiblePanel>
                    <div className="flex flex-col gap-2 pt-1">
                      {view.inputs.required.map((input) => (
                        <p key={input.scope} className="text-xs text-muted-foreground">
                          <InlineButton
                            onClick={() => onOpenSource(input.scope, String(input.revision))}
                          >
                            {input.scope}
                          </InlineButton>
                          : read v{input.revision},{" "}
                          {input.currentRevision === null
                            ? "current version unavailable"
                            : input.currentRevision === input.revision
                              ? view.inputs.state === "complete"
                                ? "version still matches"
                                : "same version listed; history needs confirmation"
                              : `now v${input.currentRevision}`}
                        </p>
                      ))}
                      <p className="text-xs text-muted-foreground">
                        Opening a source here does not count as a read by the agent.
                      </p>
                      <div className="flex gap-2">
                        <Button size="xs" variant="outline" onClick={() => onPageInputs()}>
                          First inputs
                        </Button>
                        {view.inputs.coverage.nextCursor === null ? null : (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => onPageInputs(view.inputs.coverage.nextCursor!)}
                          >
                            More inputs
                          </Button>
                        )}
                      </div>
                    </div>
                  </CollapsiblePanel>
                </Collapsible>
              )}
            </section>

            <p className="text-xs leading-relaxed text-muted-foreground">
              Reported by the agents, not verified
              {keeper === undefined ? null : ` · ${keeper}`}
              {view.coverage.omittedCount === 0
                ? null
                : ` · ${view.coverage.omittedCount} more contexts in the project archive`}
              {" · "}
              Loaded {formatRelativeTimeLabel(view.generatedAt)} ·{" "}
              {view.identity.backend === "local" ? "Local" : "Hub"}
            </p>
          </div>
        </CollapsiblePanel>
      </Collapsible>

      {details.length === 0 ? null : (
        <div className="border-t border-border/60 pt-4">
          <WorkDetailTabs details={details} open={detailOpen} onOpen={setDetailOpen} />
        </div>
      )}
    </article>
  );
}

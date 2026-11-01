import {
  handoffLines,
  inputLabel,
  inputState,
  shortenedNote,
} from "@t3tools/client-runtime/peer/handoff";
import { handoffReportLine } from "@t3tools/client-runtime/peer/test-reports";
import type { PeerHandoffPackage } from "@t3tools/contracts";
import {
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useContext, useEffect, useState, type ReactNode } from "react";

import { cn } from "../../../lib/utils";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { InlineMarkdown } from "../../InlineMarkdown";
import { Button, InlineButton } from "../../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../../ui/collapsible";
import { TONE_SURFACE } from "../signals";
import { contextComparison } from "../contextCompare.logic";
import { ReviewDecisionContext } from "../review/ReviewDecision";
import {
  reviewPresentation,
  type ReviewFacts,
  type ReviewPresentation,
} from "./handoffPresentation";

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

function NoteSection({
  section,
  mine,
  author,
  onOpenChat,
}: {
  readonly section: ReviewPresentation["notes"][number];
  readonly mine: boolean;
  readonly author: string;
  readonly onOpenChat: (() => void) | undefined;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h4 className="text-sm font-semibold text-foreground">{section.title}</h4>
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
 * account: its result and counts, then each item with where its claim comes from when the page
 * read the report itself.
 */
function TestReportLine({
  report,
  items,
  nameOf,
}: {
  readonly report: PeerHandoffPackage["report"];
  readonly items: ReviewPresentation["evidence"];
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
            {formatRelativeTimeLabel(report.at)}.
            {items === null ? " The task’s page shows each item and whether Peer saw it run." : ""}
          </p>
        </>
      )}
      {items === null || items.length === 0 ? null : (
        <ul className="flex flex-col gap-1.5 pt-1">
          {items.map((item) => (
            <li key={item.key} className="flex min-w-0 flex-col text-sm leading-relaxed">
              <span className="text-foreground [overflow-wrap:anywhere]">
                {ITEM_KIND[item.kind]} {item.text}
              </span>
              <span
                className={cn(
                  "text-xs",
                  item.attention ? "text-warning-foreground" : "text-muted-foreground",
                )}
              >
                {item.mark}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const ITEM_KIND = { pass: "Passed:", fail: "Failed:", unverified: "Unverified:" } as const;

const ACTION_LABEL = { done: "Mark task done", withdraw: "Withdraw acceptance…" } as const;

/**
 * The page's first line: the decision the policy asks of the person, or that none is asked, with
 * the actions that sit on it. Mark done and Reopen come from the review page; on a page that has
 * none (the task's context), the line only says where the task stands.
 */
function DecisionRow({
  decision,
  since,
  onWithdrawAcceptance,
}: {
  readonly decision: NonNullable<ReviewPresentation["decision"]>;
  /** How long it has been with the agent. */
  readonly since: string | undefined;
  readonly onWithdrawAcceptance: (() => void) | undefined;
}) {
  const page = useContext(ReviewDecisionContext);
  const actions = decision.actions.filter((action) =>
    action === "withdraw" ? onWithdrawAcceptance !== undefined : page !== null,
  );
  const claim = page?.claim;
  const offersPageActions = actions.some((action) => action !== "withdraw");
  useEffect(
    () => (claim !== undefined && offersPageActions ? claim() : undefined),
    [claim, offersPageActions],
  );
  return (
    <section
      aria-label="Decision"
      className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2"
    >
      <p
        className={cn(
          "min-w-0 flex-1 basis-60 text-base font-semibold [overflow-wrap:anywhere]",
          decision.kind === "ask"
            ? decision.signals.length > 0
              ? "text-warning-foreground"
              : "text-foreground"
            : decision.kind === "with-agent"
              ? "text-info-foreground"
              : decision.kind === "human-decision" || decision.kind === "coordination"
                ? "text-warning-foreground"
                : "text-success-foreground",
        )}
      >
        {decision.text}
        {since === undefined ? null : (
          <span className="font-normal text-muted-foreground"> · {since}</span>
        )}
      </p>
      {actions.length === 0 ? null : (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) =>
            action === "reopen" ? (
              <Button
                key={action}
                size="sm"
                variant="outline"
                disabled={page!.busy}
                onClick={page!.reopen}
              >
                {page!.reopenLabel}
              </Button>
            ) : action === "done" ? (
              <Button
                key={action}
                size="sm"
                disabled={page!.busy || page!.done}
                onClick={page!.markDone}
              >
                {page!.done ? "Done" : ACTION_LABEL.done}
              </Button>
            ) : (
              <Button key={action} size="sm" variant="outline" onClick={onWithdrawAcceptance}>
                {ACTION_LABEL.withdraw}
              </Button>
            ),
          )}
        </div>
      )}
    </section>
  );
}

/** One of the three facts under the decision: its name, what it says, and where it comes from. */
function FactChip({
  label,
  attention,
  children,
}: {
  readonly label: string;
  readonly attention: boolean;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-border p-3"
    >
      <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {attention ? (
          <CircleAlertIcon aria-hidden className="size-3.5 shrink-0 text-warning-foreground" />
        ) : (
          <CircleCheckIcon aria-hidden className="size-3.5 shrink-0 text-success-foreground" />
        )}
        {label}
      </h4>
      {children}
    </section>
  );
}

export function HandoffReport({
  pkg,
  facts,
  mine,
  busy,
  contextWarning,
  nextAction,
  onCompare,
  onOpenPull,
  onOpenChat,
  onWithdraw,
  onWithdrawAcceptance,
}: {
  readonly pkg: PeerHandoffPackage;
  /** The way to continue a run that stopped with agent actions open. */
  readonly nextAction?: ReactNode;
  /** What the page knows besides the package, and how it names people and computers. */
  readonly facts: ReviewFacts;
  readonly mine: boolean;
  readonly busy: boolean;
  readonly contextWarning: ReactNode;
  readonly onCompare: (scope: string, version: number) => void;
  readonly onOpenPull: (url: string) => void;
  readonly onOpenChat: (() => void) | undefined;
  readonly onWithdraw: () => void;
  /** Opens the acceptance's withdrawal, where this person may withdraw it. */
  readonly onWithdrawAcceptance?: (() => void) | undefined;
}) {
  const nameOf = facts.nameOf;
  const view = reviewPresentation(pkg, facts);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(view.notesOpen);
  const author = nameOf(pkg.author);
  const sectionProps = { mine, author, onOpenChat };
  const evidence = pkg.delivery?.evidence;
  const paths = [...(evidence?.untracked ?? []), ...(evidence?.uncommitted ?? [])];

  return (
    <article
      aria-label={`Handoff #${pkg.number}`}
      className="min-w-0 overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex flex-col gap-5 p-4 sm:p-6">
        {view.decision === null ? null : (
          <DecisionRow
            decision={view.decision}
            since={
              view.decision.kind === "with-agent"
                ? formatRelativeTimeLabel(pkg.composedAt)
                : undefined
            }
            onWithdrawAcceptance={onWithdrawAcceptance}
          />
        )}
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

        <div className="grid min-w-0 gap-2 sm:grid-cols-3">
          <FactChip label="Verified" attention={view.verified.attention}>
            <p className="text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">
              {view.verified.text}
            </p>
          </FactChip>
          <FactChip label="Delivered" attention={view.delivered.attention}>
            <p className="text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">
              {view.delivered.text}
            </p>
            {view.delivered.observed === null ? null : (
              <p className="text-xs text-muted-foreground">
                {view.delivered.observed}
                {pkg.delivery === undefined
                  ? ""
                  : `, ${formatRelativeTimeLabel(pkg.delivery.observedAt)}`}
              </p>
            )}
          </FactChip>
          <FactChip label="Provides" attention={false}>
            {view.provides.lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">No contract or outcome stated.</p>
            ) : (
              <ReportLines lines={view.provides.lines} limit={3} />
            )}
            {view.provides.waiting.map((line) => (
              <p key={line} className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {line}
              </p>
            ))}
          </FactChip>
        </div>

        <section aria-label="What changed" className="flex flex-col gap-3">
          <h4 className="text-sm font-semibold text-foreground">What changed</h4>
          {pkg.context?.gist ? (
            <p className="line-clamp-3 max-w-prose text-base leading-relaxed text-foreground [overflow-wrap:anywhere]">
              <InlineMarkdown text={pkg.context.gist} />
            </p>
          ) : null}
          {paths.length === 0 ? null : (
            <p className="font-mono text-xs break-all text-muted-foreground">{paths.join(", ")}</p>
          )}
          {(evidence?.changes?.length ?? 0) === 0 ? null : (
            <p className="text-xs text-muted-foreground">
              Changes{" "}
              <span className="font-mono break-all">
                {evidence!.changes!.map((id) => id.slice(0, 8)).join(", ")}
              </span>
            </p>
          )}
          {view.pulls.length === 0 ? (
            mine && onOpenChat !== undefined ? (
              <div>
                <Button size="sm" variant="outline" onClick={onOpenChat}>
                  Open original chat
                </Button>
              </div>
            ) : pkg.context?.gist || paths.length > 0 ? null : (
              <p className="text-sm text-muted-foreground">No pull request was named.</p>
            )
          ) : (
            <div className="flex flex-wrap gap-2">
              {view.pulls.map((url) => (
                <Button key={url} size="sm" variant="outline" onClick={() => onOpenPull(url)}>
                  Open PR #{url.split("/").at(-1)}
                </Button>
              ))}
            </div>
          )}
        </section>

        <section aria-label="Evidence" className="flex flex-col gap-2">
          <TestReportLine report={pkg.report} items={view.evidence} nameOf={nameOf} />
        </section>

        {contextWarning}
        {view.groups.map((group) => (
          <section
            key={group.class}
            aria-label={group.label}
            className={cn(
              "flex flex-col gap-3 rounded-lg border p-4",
              group.class === "agent_action" ? TONE_SURFACE.working : TONE_SURFACE.needs,
            )}
          >
            <h4
              className={cn(
                "flex items-center gap-2 text-sm font-semibold",
                group.class === "agent_action" ? "text-info-foreground" : "text-warning-foreground",
              )}
            >
              <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />
              {group.label}
            </h4>
            {group.steps.length === 0 ? null : (
              <ul className="flex flex-col gap-2 text-sm leading-relaxed text-foreground">
                {group.steps.map((step) => (
                  <li key={step.key} className="flex flex-col gap-0.5">
                    <span className="[overflow-wrap:anywhere]">
                      {step.text}
                      {step.who === null ? null : (
                        <span className="text-muted-foreground"> · {step.who}</span>
                      )}
                    </span>
                    {step.next === null ? null : (
                      <span className="text-xs text-muted-foreground">{step.next}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {group.class !== "coordination" ? null : (
              <>
                {view.openOverlaps.map((overlap) => (
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
                {view.changedInputs.length === 0 ? null : (
                  <ul aria-label="Changed inputs" className="flex flex-col gap-3">
                    {view.changedInputs.map((input) => (
                      <li key={input.scope} className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 basis-48 text-sm break-words text-foreground">
                          Changed after the agent read it: {inputLabel(input)}, read v
                          {input.readVersion}
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
                )}
              </>
            )}
          </section>
        ))}
        {view.agentStopped && nextAction !== undefined && nextAction !== null ? (
          <section aria-label="Continue the agent" className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 basis-48 text-sm text-foreground">
              The agent stopped with this still open.
            </p>
            {nextAction}
          </section>
        ) : null}
        {view.covered.length === 0 ? null : (
          <p className="text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            Someone answers for:{" "}
            {view.covered
              .map((step) => (step.who === null ? step.text : `${step.text} (${step.who})`))
              .join("; ")}
          </p>
        )}
        {view.raisedAtHandoff.length === 0 ? null : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Raised at handoff, since cleared:{" "}
            {view.raisedAtHandoff.map(({ words }) => words).join("; ")}.
          </p>
        )}
        {view.atHandoff && view.signals.length > 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            As recorded at handoff: {view.signals.map(({ words }) => words).join("; ")}.
          </p>
        ) : null}

        {view.notes.length === 0 && (pkg.context?.projectLines.length ?? 0) === 0 ? null : (
          <Collapsible open={notesOpen} onOpenChange={setNotesOpen}>
            <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
              <ChevronRightIcon
                aria-hidden
                className={cn(
                  "transition-transform motion-reduce:transition-none",
                  notesOpen && "rotate-90",
                )}
              />
              {pkg.source === "agent" ? "The agent’s notes" : "The author’s notes"}
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="flex min-w-0 flex-col gap-5 pt-3">
                {view.notes.map((section) => (
                  <NoteSection key={section.name} section={section} {...sectionProps} />
                ))}
                {view.blockersShortened ? (
                  <p role="status" className="text-sm text-warning-foreground">
                    The blocker list was shortened. Check the original chat before reviewing.
                  </p>
                ) : null}
                {(pkg.context?.projectLines.length ?? 0) === 0 ? null : (
                  <section className="flex flex-col gap-2">
                    <h4 className="text-sm font-semibold text-foreground">For the project</h4>
                    <ReportLines lines={pkg.context!.projectLines} />
                  </section>
                )}
              </div>
            </CollapsiblePanel>
          </Collapsible>
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
            Source and coordination
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
            {onOpenChat === undefined || !mine || view.pulls.length === 0 ? null : (
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

/** A view of the work beyond its status: the full context, its conversations, its activity. */
export interface WorkDetail {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
}

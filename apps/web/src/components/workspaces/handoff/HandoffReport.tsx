import {
  currentContextSections,
  CONTEXT_INPUT_LABELS,
} from "@t3tools/client-runtime/peer/contextView";
import type { PeerContextView } from "@t3tools/contracts";
import {
  handoffLines,
  inputLabel,
  inputState,
  shortenedNote,
} from "@t3tools/client-runtime/peer/handoff";
import type { PeerHandoffPackage } from "@t3tools/contracts";
import { ChevronRightIcon, TriangleAlertIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../../lib/utils";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { InlineMarkdown } from "../../InlineMarkdown";
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
  const { sections, result, blockers, next, openOverlaps, changedInputs, pulls } =
    handoffPresentation(pkg);
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
            {blockers?.shortened ? (
              <p className="text-sm text-warning-foreground">
                The blocker list was shortened. Check the original chat before reviewing.
              </p>
            ) : null}
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

export function CurrentContextReport({
  view,
  onPageInputs,
  onPageFindings,
  onOpenSource,
}: {
  readonly view: PeerContextView;
  readonly onPageInputs: (cursor?: string) => void;
  readonly onPageFindings: (cursor?: string) => void;
  readonly onOpenSource: (scope: string, revision?: string) => void;
}) {
  return (
    <section aria-label="Current context" className="flex min-w-0 flex-col gap-4">
      {currentContextSections(view).map((section) => (
        <section key={section.key} className="flex min-w-0 flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">{section.title}</h3>
          {section.values.map((value) => (
            <div
              key={`${value.sourceRefs.join(":")}:${value.text}`}
              className="flex min-w-0 flex-col gap-1"
            >
              <ReportLines lines={[value.text]} />
              <p className="text-xs text-muted-foreground">
                Source:{" "}
                {value.sourceRefs.map((id) => {
                  const source = view.sources.find((source) => source.id === id);
                  return source === undefined ? null : (
                    <InlineButton
                      key={id}
                      onClick={() => onOpenSource(source.scope, source.revision ?? undefined)}
                    >
                      {source.scope}
                      {source.revision === null ? "" : ` @ ${source.revision}`}
                    </InlineButton>
                  );
                })}
              </p>
            </div>
          ))}
        </section>
      ))}
      <p role="status" className="text-xs text-muted-foreground">
        {CONTEXT_INPUT_LABELS[view.inputs.state]}. Reported by the work’s authors; tests and code
        are not independently verified here.
      </p>
      <section aria-label="Required input evidence" className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">Required input evidence</h3>
        <p className="text-xs text-muted-foreground">
          {view.inputs.required.length} shown · {view.inputs.coverage.total} recorded ·{" "}
          {view.inputs.coverage.omittedCount} more. Opening a source does not record a read for the
          agent.
        </p>
        {view.inputs.required.map((input) => (
          <p key={input.scope} className="text-xs text-muted-foreground">
            <InlineButton onClick={() => onOpenSource(input.scope, String(input.revision))}>
              {input.scope}
            </InlineButton>
            : required v{input.revision},{" "}
            {input.currentRevision === null
              ? "source unavailable"
              : `current v${input.currentRevision}`}
          </p>
        ))}
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
      </section>
      <section aria-label="Pending team findings" className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">Pending team findings</h3>
        {view.pendingFindings.availability === "unavailable" ? (
          <p role="status" className="text-xs text-muted-foreground">
            Finding coverage is unavailable.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {view.pendingFindings.ids.length} shown · {view.pendingFindings.coverage.omittedCount}{" "}
              more await a keeper’s decision.
            </p>
            {view.pendingFindings.items.map((finding) => (
              <p key={finding.id} className="text-sm text-foreground">
                {finding.text}
                <span className="block text-xs text-muted-foreground">
                  {finding.email} · {finding.at} · {finding.id}
                </span>
              </p>
            ))}
            <div className="flex gap-2">
              <Button size="xs" variant="outline" onClick={() => onPageFindings()}>
                First findings
              </Button>
              {view.pendingFindings.coverage.nextCursor === null ? null : (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => onPageFindings(view.pendingFindings.coverage.nextCursor!)}
                >
                  More findings
                </Button>
              )}
            </div>
          </>
        )}
      </section>
      {view.sources.some((source) =>
        ["unavailable", "disabled", "forbidden"].includes(source.availability),
      ) ? (
        <p className="text-sm text-warning-foreground">
          Some context sources are unavailable, disabled or access was denied. This view does not
          establish that nothing changed.
        </p>
      ) : null}
      {view.coverage.omittedCount === 0 ? null : (
        <p className="text-xs text-muted-foreground">
          {view.coverage.omittedCount} more contexts are available through the project archive.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Assembled {formatRelativeTimeLabel(view.generatedAt)} ·{" "}
        {view.identity.backend === "local" ? "Local" : "Hub"} · {view.identity.environment}
      </p>
    </section>
  );
}

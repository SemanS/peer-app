import { ChevronRightIcon } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "../../../lib/utils";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import {
  flowIntro,
  flowTitle,
  isFlowEntry,
  trailHealth,
  trailHealthLine,
  trailStages,
  type TrailStage,
} from "./flows.logic";
import { entryHealth, entryTitle, plainSummary, type EntryValidity } from "./knowledge.logic";
import { EntryRow, HEALTH, SavedEntryDetail, type SavedKnowledgeProps } from "./SavedKnowledge";

type Entry = SavedKnowledgeProps["entries"][number];

/**
 * The project's knowledge read as flows: each a curated trail through the saved entries along one
 * process, in the order a reader meets them, with every step's health. A step opens its entry as
 * the Knowledge tab does; a step whose entry left the saved knowledge says so and opens nothing.
 */
export function KnowledgeFlows(props: SavedKnowledgeProps) {
  const flows = props.entries
    .filter(isFlowEntry)
    .sort((a, b) => flowTitle(a.title).localeCompare(flowTitle(b.title)));
  const byId = new Map(props.entries.map((entry) => [entry.id, entry]));
  const validityOf = (entry: string): EntryValidity =>
    props.validity?.get(entry) ?? (props.challenged.has(entry) ? "challenged" : "current");
  const healthOf = (id: string) => {
    const entry = byId.get(id);
    return entry === undefined ? null : entryHealth(entry, validityOf(id));
  };
  if (flows.length === 0)
    return (
      <section aria-label="Flows" className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-foreground">No flows yet</h2>
        <p className="text-sm text-muted-foreground">
          A flow reads the saved knowledge as one process, from where it starts to where it ends: an
          architecture entry named <code className="font-mono">flow-…</code> whose trail lists the
          entries a reader meets along the way. An agent writes them with kontext&apos;s{" "}
          <code className="font-mono">kontext-flows</code> skill; you review and commit.
        </p>
      </section>
    );
  return (
    <section aria-label="Flows" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">Flows</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {flows.length === 1 ? "1 flow" : `${flows.length} flows`}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Each flow is one process read through the saved knowledge, step by step, with how far each
        step can be trusted.
      </p>
      <ul className="flex min-w-0 flex-col gap-2">
        {flows.map((flow) => (
          <FlowCard
            key={flow.id}
            flow={flow}
            byId={byId}
            healthOf={healthOf}
            validityOf={validityOf}
            saved={props}
          />
        ))}
      </ul>
    </section>
  );
}

/** One flow, folded to its title and summary; opened, its trail as a rail. */
function FlowCard({
  flow,
  byId,
  healthOf,
  validityOf,
  saved,
}: {
  readonly flow: Entry;
  readonly byId: ReadonlyMap<string, Entry>;
  readonly healthOf: (entry: string) => ReturnType<typeof entryHealth> | null;
  readonly validityOf: (entry: string) => EntryValidity;
  readonly saved: SavedKnowledgeProps;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const detail = useEnvironmentQuery(
    open
      ? serverEnvironment.peerKnowledgeEntry({
          environmentId: saved.environmentId,
          input: { workspace: saved.workspace, project: saved.project, entry: flow.id },
        })
      : null,
  );
  const trail = detail.data?.trail ?? null;
  const health = trail === null ? null : trailHealth(trail, healthOf);
  const summary = plainSummary(flow.summary ?? "");
  return (
    <li className="min-w-0 rounded-xl border border-border bg-card">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full min-w-0 items-start gap-3 rounded-xl px-3.5 py-2.5 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground", open && "rotate-90")}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground wrap-anywhere">
            {flowTitle(flow.title)}
          </span>
          {summary === "" || open ? null : (
            <span className="line-clamp-2 text-xs text-muted-foreground">{summary}</span>
          )}
          {health === null ? null : (
            <span className="text-xs text-muted-foreground tabular-nums">
              {trailHealthLine(health)}
            </span>
          )}
        </span>
      </button>
      {open ? (
        <div
          id={panelId}
          className="flex min-w-0 flex-col gap-3 border-t border-border/60 px-3.5 py-3"
        >
          {detail.error !== null ? (
            <div
              role="alert"
              className="flex flex-col items-start gap-2 text-sm text-destructive-foreground"
            >
              <p>Could not read this flow: {detail.error}</p>
              <Button size="xs" variant="outline" onClick={detail.refresh}>
                Retry
              </Button>
            </div>
          ) : !detail.isSuccess ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading the trail…
            </p>
          ) : detail.data === null ? (
            <p className="text-sm text-muted-foreground">
              This flow is no longer available in this checkout.
            </p>
          ) : (
            <>
              {flowIntro(detail.data.body) === "" ? null : (
                <p className="text-sm text-foreground">{flowIntro(detail.data.body)}</p>
              )}
              {flow.paths?.length ? (
                <p className="wrap-anywhere font-mono text-xs text-muted-foreground">
                  {flow.paths.join(", ")}
                </p>
              ) : null}
              {trail === null || trail.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This flow has no trail yet: no numbered <code className="font-mono">[[id]]</code>{" "}
                  steps under its Trail heading.
                </p>
              ) : (
                <Rail
                  stages={trailStages(trail)}
                  byId={byId}
                  healthOf={healthOf}
                  validityOf={validityOf}
                  saved={saved}
                />
              )}
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

/** The trail as a vertical rail: stage headings, then each step with its health dot. */
function Rail({
  stages,
  byId,
  healthOf,
  validityOf,
  saved,
}: {
  readonly stages: ReadonlyArray<TrailStage>;
  readonly byId: ReadonlyMap<string, Entry>;
  readonly healthOf: (entry: string) => ReturnType<typeof entryHealth> | null;
  readonly validityOf: (entry: string) => EntryValidity;
  readonly saved: SavedKnowledgeProps;
}) {
  const [opened, setOpened] = useState<number | null>(null);
  return (
    <ol aria-label="Trail" className="flex min-w-0 flex-col gap-3">
      {stages.map((stage) => (
        <li
          key={`${stage.stage ?? ""}#${stage.steps[0]?.n ?? 0}`}
          className="flex min-w-0 flex-col gap-1"
        >
          {stage.stage === null ? null : (
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {stage.stage}
            </h3>
          )}
          <ol className="flex min-w-0 flex-col border-l border-border pl-3">
            {stage.steps.map((step) => {
              const entry = byId.get(step.entry);
              const health = healthOf(step.entry);
              const validity = validityOf(step.entry);
              const Icon = health === null ? null : HEALTH[health].icon;
              const expanded = opened === step.n;
              return (
                <li key={step.n} className="flex min-w-0 flex-col gap-1 py-1.5">
                  <div className="flex min-w-0 items-start gap-2">
                    <span className="relative -ml-[1.1rem] mt-1 flex size-4 shrink-0 items-center justify-center rounded-full bg-background">
                      {Icon === null || health === null ? (
                        <span
                          aria-hidden
                          className="size-2 rounded-full border border-muted-foreground/60"
                        />
                      ) : (
                        <Icon
                          aria-label={HEALTH[health].label}
                          className={cn("size-4", HEALTH[health].tone)}
                        />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      {entry === undefined ? (
                        <span className="text-sm text-muted-foreground">
                          <span className="tabular-nums">{step.n}.</span>{" "}
                          <span className="font-mono text-xs">{step.entry}</span> is not in the
                          saved knowledge (superseded, retired, or never saved).
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={saved.busy}
                          aria-expanded={expanded}
                          onClick={() => setOpened(expanded ? null : step.n)}
                          className="min-w-0 rounded-sm text-left text-sm font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        >
                          <span className="tabular-nums">{step.n}.</span>{" "}
                          <span className="wrap-anywhere">{entryTitle(entry.title)}</span>
                        </button>
                      )}
                      {step.text === "" ? null : (
                        <span className="text-sm text-muted-foreground">{step.text}</span>
                      )}
                    </span>
                    {validity === "challenged" ? (
                      <Badge variant="error" size="sm">
                        Challenged
                      </Badge>
                    ) : null}
                  </div>
                  {expanded && entry !== undefined ? (
                    <ul className="min-w-0 pl-6">
                      <EntryRow
                        entry={entry}
                        validity={validity}
                        health={health ?? "unverified"}
                        expanded
                        busy={saved.busy}
                        onToggle={() => setOpened(null)}
                      >
                        <SavedEntryDetail key={entry.id} {...saved} entry={entry.id} />
                      </EntryRow>
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </li>
      ))}
    </ol>
  );
}

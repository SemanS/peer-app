/**
 * The cards of the Plans section: one per live plan, one for each agent on the task that declared
 * none. They draw what the client runtime's `peer/plans-view` works out. Names, items and contract
 * lines are teammate text, so they are text children only, never markup or a link.
 */
import type { PlanRelationKind } from "@t3tools/client-runtime/peer/plans";
import type {
  NoPlanCardModel,
  PlanAgent,
  PlanCardModel,
  PlanRelationLine,
  PlansSectionModel,
} from "@t3tools/client-runtime/peer/plans-view";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { cn } from "../../../lib/utils";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { TONE_SURFACE, TONE_TEXT } from "../signals";

const KIND_VARIANT = {
  "uses-their-change": "warning",
  "changes-their-use": "warning",
  "same-change": "secondary",
} as const satisfies Record<PlanRelationKind, string>;

function AgentMark({ agent }: { readonly agent: PlanAgent }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold",
        agent.mine ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      {agent.initial}
    </span>
  );
}

const SmallLabel = ({ children }: { readonly children: ReactNode }) => (
  <h3 className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
    {children}
  </h3>
);

function Column({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-4 py-3">
      <SmallLabel>{label}</SmallLabel>
      {children}
    </div>
  );
}

const None = () => <span className="text-xs text-muted-foreground">None</span>;

const Mono = ({ children }: { readonly children: ReactNode }) => (
  <span className="font-mono text-xs break-words text-foreground">{children}</span>
);

function RelationRow({
  line,
  workspace,
  project,
}: {
  readonly line: PlanRelationLine;
  readonly workspace: string;
  readonly project: string;
}) {
  return (
    <li className="flex flex-wrap items-start gap-x-3.5 gap-y-2 px-4 py-2.5">
      <Badge variant={KIND_VARIANT[line.kind]}>{line.kindLabel}</Badge>
      <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-1">
        <p className="text-sm break-words text-foreground">
          <span className="font-mono text-xs">{line.item}</span> · {line.who}
        </p>
        {line.contract === null ? null : (
          <p
            className={cn(
              "rounded-lg border px-2.5 py-1.5 font-mono text-xs break-words",
              TONE_SURFACE.knowledge,
              TONE_TEXT.knowledge,
            )}
          >
            Their contract (teammate text): {line.contract}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{line.mark}</p>
      </div>
      {line.open === null ? null : (
        <Button
          variant="outline"
          size="sm"
          render={
            <Link
              to="/task/$workspace/$project/$task"
              params={{ workspace, project, task: line.open.task }}
            />
          }
        >
          Open {line.open.label}
        </Button>
      )}
    </li>
  );
}

/** What a work meets in other work, kind first; nothing while there is nothing. */
function Relations({
  lines,
  workspace,
  project,
}: {
  readonly lines: ReadonlyArray<PlanRelationLine>;
  readonly workspace: string;
  readonly project: string;
}) {
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col border-t border-border">
      <div className="px-4 pt-2.5 pb-1">
        <SmallLabel>Where it meets other work</SmallLabel>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {lines.map((line) => (
          <RelationRow key={line.key} line={line} workspace={workspace} project={project} />
        ))}
      </ul>
    </div>
  );
}

function PlanCard({
  card,
  workspace,
  project,
}: {
  readonly card: PlanCardModel;
  readonly workspace: string;
  readonly project: string;
}) {
  return (
    <article
      aria-label={`${card.agent}: ${card.heading}`}
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
    >
      <header className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-3">
        <AgentMark agent={card} />
        <span className="text-sm font-semibold text-foreground">{card.agent}</span>
        <span className="text-sm text-muted-foreground">{card.heading}</span>
      </header>
      <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Column label="Changes">
          {card.changes.length === 0 ? (
            <None />
          ) : (
            card.changes.map((item) => (
              <span
                key={`${item.maybe}:${item.text}`}
                className="flex flex-wrap items-center gap-1.5"
              >
                <Mono>{item.text}</Mono>
                {item.maybe ? (
                  <Badge variant="outline" size="sm">
                    maybe
                  </Badge>
                ) : null}
              </span>
            ))
          )}
        </Column>
        <Column label="Uses">
          {card.uses.length === 0 ? (
            <None />
          ) : (
            card.uses.map((text) => <Mono key={text}>{text}</Mono>)
          )}
        </Column>
        <Column label="Provides">
          {card.provides.length === 0 ? (
            <None />
          ) : (
            card.provides.map((text) => <Mono key={text}>{text}</Mono>)
          )}
        </Column>
      </div>
      <Relations lines={card.relations} workspace={workspace} project={project} />
    </article>
  );
}

/** An agent that declared nothing: said in one line, with what its reported changes meet. */
function NoPlanCard({
  card,
  workspace,
  project,
}: {
  readonly card: NoPlanCardModel;
  readonly workspace: string;
  readonly project: string;
}) {
  return (
    <article
      aria-label={`${card.agent} has not declared a plan`}
      className="flex flex-col overflow-hidden rounded-xl border border-dashed border-border"
    >
      <div className="flex flex-wrap items-center gap-2.5 px-4 py-3">
        <AgentMark agent={card} />
        <span className="text-sm font-semibold text-foreground">{card.agent}</span>
        <span className="text-sm text-muted-foreground">{card.line}</span>
      </div>
      <Relations lines={card.relations} workspace={workspace} project={project} />
    </article>
  );
}

export function PlanCards({
  model,
  workspace,
  project,
}: {
  readonly model: PlansSectionModel;
  readonly workspace: string;
  readonly project: string;
}) {
  return (
    <>
      {model.cards.map((card) =>
        card.kind === "plan" ? (
          <PlanCard key={card.key} card={card} workspace={workspace} project={project} />
        ) : (
          <NoPlanCard key={card.key} card={card} workspace={workspace} project={project} />
        ),
      )}
      {model.loose.length === 0 ? null : (
        <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
          <Relations lines={model.loose} workspace={workspace} project={project} />
        </div>
      )}
    </>
  );
}

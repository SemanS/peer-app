/**
 * The parts of the AI subscriptions page (design artboard 22): the card of the person's plans with
 * the row that adds one, a project's row of where those plans may be used, and the card that says
 * why an agent cannot start on a plan. They draw what `aiSubscriptions.logic` works out and hand
 * every edit back to the page, which writes it to the draft.
 */
import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import { harnessLabel, planLabel } from "@t3tools/client-runtime/peer-settings";
import type {
  EnvironmentId,
  PeerHarness,
  PeerHubStatus,
  PeerWorkspaceState,
} from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { ProjectMark } from "../signals";
import { useOpenWorkspaceProject } from "../useOpenWorkspaceProject";
import { projectScopeKey } from "../workBoard.logic";
import {
  CLASS_LABEL,
  HARNESSES,
  PLAN_GROUPS,
  actionNote,
  alternativeLabel,
  hasPlan,
  isHarness,
  isPlanId,
  nextHarness,
  noWayOutText,
  sharedActionLabel,
  sharedChip,
  sharedUse,
  type BlockedCase,
  type ChipTone,
  type PlanId,
  type PlanRow,
  type SharedUsage,
  type UseChip,
  type UseRow,
} from "./aiSubscriptions.logic";
import { useOpenPeerSettings } from "./peerSettingsLinks";

const CLASS_VARIANT = {
  consumer: "secondary",
  commercial: "success",
  other: "outline",
} as const;

/**
 * The person's plans, one row each: the agent, the plan, the kind of terms it is under, and a way
 * to remove it. What is under the rows (the row that adds one) is the page's own; `note` stands in
 * for the rows while there are none to show.
 */
export function PlansCard({
  rows,
  canEdit,
  note,
  onRemove,
  children,
}: {
  readonly rows: ReadonlyArray<PlanRow>;
  readonly canEdit: boolean;
  readonly note: string | null;
  readonly onRemove: (row: PlanRow) => void;
  readonly children?: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {rows.map((row) => (
        <div
          key={row.index}
          className="flex min-h-12 items-center gap-3 border-b py-1.5 ps-3.5 pe-2 last:border-b-0"
        >
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {harnessLabel(row.harness)}
          </span>
          <span className="text-sm font-medium">{planLabel(row.plan)}</span>
          <span className="flex w-26 justify-center">
            <Badge variant={CLASS_VARIANT[row.kind]} size="control">
              {CLASS_LABEL[row.kind]}
            </Badge>
          </span>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`Remove ${harnessLabel(row.harness)} ${planLabel(row.plan)}`}
            disabled={!canEdit}
            onClick={() => onRemove(row)}
          >
            <XIcon aria-hidden />
          </Button>
        </div>
      ))}
      {note === null ? null : (
        <p
          role="status"
          className="border-b px-3.5 py-3 text-sm text-muted-foreground last:border-b-0"
        >
          {note}
        </p>
      )}
      {children}
    </div>
  );
}

/**
 * The row that adds a plan: an agent, a plan (grouped by the terms it is under) and Add. It starts
 * on the first agent without a plan, and Add waits while the pair chosen is in the list already.
 */
export function AddPlanRow({
  plans,
  onAdd,
}: {
  readonly plans: ReadonlyArray<{ readonly harness: string; readonly plan: string }>;
  readonly onAdd: (harness: PeerHarness, plan: PlanId) => void;
}) {
  const [harness, setHarness] = useState<PeerHarness>(() => nextHarness(plans));
  const [plan, setPlan] = useState<PlanId>("pro");
  const there = hasPlan(plans, harness, plan);
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-40 flex-1">
          <Select
            value={harness}
            onValueChange={(next) => {
              if (isHarness(next)) setHarness(next);
            }}
          >
            <SelectTrigger size="sm" aria-label="Agent">
              <SelectValue>{harnessLabel(harness)}</SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {HARNESSES.map((candidate) => (
                <SelectItem key={candidate} hideIndicator value={candidate}>
                  {harnessLabel(candidate)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <div className="min-w-48 flex-1">
          <Select
            value={plan}
            onValueChange={(next) => {
              if (isPlanId(next)) setPlan(next);
            }}
          >
            <SelectTrigger size="sm" aria-label="Plan">
              <SelectValue>{planLabel(plan)}</SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {PLAN_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectGroupLabel>{group.label}</SelectGroupLabel>
                  {group.plans.map((candidate) => (
                    <SelectItem key={candidate} hideIndicator value={candidate}>
                      {planLabel(candidate)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <Button size="sm" variant="outline" disabled={there} onClick={() => onAdd(harness, plan)}>
          Add
        </Button>
      </div>
      {there ? (
        <p role="status" className="text-xs text-muted-foreground">
          {harnessLabel(harness)} {planLabel(plan)} is in your list already.
        </p>
      ) : null}
    </div>
  );
}

/**
 * What the gateway reports of a project's shared capacity this period, for the project's row and
 * the card that offers it: the same query the project's Capacity page reads. Null while it is not
 * known, and where the project has none or the capacity plugin is off.
 */
export function useSharedUsage(input: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly projectId: string;
  readonly hasShared: boolean;
}): SharedUsage | null {
  const { environmentId, status, workspace, projectId, hasShared } = input;
  const query = useEnvironmentQuery(
    hasShared && activePlugin(status, "capacity")
      ? serverEnvironment.peerHubProjectUsage({
          environmentId,
          input: { workspace, projectId },
        })
      : null,
  );
  return query.data?.shared ?? null;
}

const CHIP_VARIANT: Readonly<Record<ChipTone, "outline" | "warning" | "info">> = {
  allowed: "outline",
  blocked: "warning",
  shared: "info",
};

function UseChipView({ chip }: { readonly chip: UseChip }) {
  return (
    <Badge variant={CHIP_VARIANT[chip.tone]} size="control">
      <span className="font-semibold">{chip.label}</span>
      <span aria-hidden className="text-muted-foreground">
        ·
      </span>
      <span className="font-normal text-muted-foreground">{chip.state}</span>
    </Badge>
  );
}

/**
 * One project of "Where you can use them": its name and what it allows of personal plans, then a
 * chip for each of the person's plans (amber where it is blocked here) and one for the shared
 * capacity the project gives them, with what is left of it.
 */
export function ProjectUseRow({
  row,
  environmentId,
  status,
  workspace,
  email,
  currency,
}: {
  readonly row: UseRow;
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly email: string | null;
  readonly currency: string;
}) {
  const usage = useSharedUsage({
    environmentId,
    status,
    workspace,
    projectId: row.project,
    hasShared: row.shared !== null,
  });
  const chips =
    row.shared === null
      ? row.chips
      : [...row.chips, sharedChip(sharedUse(row.shared, usage, email), currency)];
  return (
    <div className="grid gap-x-4 gap-y-2 border-b px-3.5 py-2.5 last:border-b-0 sm:grid-cols-[12.5rem_minmax(0,1fr)] sm:items-center">
      <div className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <ProjectMark
            name={row.name}
            colorKey={projectScopeKey({ workspace, projectId: row.project })}
            className="size-4"
          />
          <span className="truncate">{row.name}</span>
        </span>
        <span className="text-xs text-muted-foreground">{row.ruleText}</span>
      </div>
      {chips.length === 0 ? (
        <p className="text-sm text-muted-foreground">{row.emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <UseChipView key={chip.key} chip={chip} />
          ))}
        </div>
      )}
    </div>
  );
}

/** An action of the card, with under it where it leads: an agent is not started from here. */
function CardAction({
  label,
  note,
  variant,
  disabled,
  onClick,
}: {
  readonly label: string;
  readonly note: string;
  readonly variant: "default" | "warning-outline";
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <div className="flex max-w-xs flex-col items-start gap-1.5">
      <Button size="sm" variant={variant} disabled={disabled} onClick={onClick}>
        {label}
      </Button>
      <p className="text-xs">{note}</p>
    </div>
  );
}

/**
 * Why an agent cannot start on a plan, in the first project that blocks one (design artboard 22):
 * the reason in the Hub's words, and the two ways out the design gives. Neither starts an agent,
 * which needs the provider picked in a thread's model picker: the other plan opens a new thread in
 * the project, and the shared budget opens one where it is already on for this computer, else the
 * project's Capacity page, where it is turned on.
 */
export function BlockedCard({
  blocked,
  environmentId,
  status,
  workspace,
  email,
}: {
  readonly blocked: BlockedCase;
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: PeerWorkspaceState;
  readonly email: string | null;
}) {
  const { alternative, shared, projectName } = blocked;
  const usage = useSharedUsage({
    environmentId,
    status,
    workspace: workspace.slug,
    projectId: blocked.project,
    hasShared: shared !== null,
  });
  const opener = useOpenWorkspaceProject({
    environmentId,
    workspace: workspace.slug,
    projectId: blocked.project,
    name: projectName,
  });
  const open = useOpenPeerSettings();
  const sharedOnHere =
    workspace.projects.find((state) => state.project.id === blocked.project)?.sharedCapacity
      .enabled === true;
  const use = shared === null ? null : sharedUse(shared, usage, email);
  const sharedVariant = alternative === null ? "default" : "warning-outline";
  return (
    <Alert variant="warning" role="status">
      <AlertTitle>{blocked.title}</AlertTitle>
      <AlertDescription>
        <p>{blocked.reason}</p>
        {alternative === null && use === null ? (
          <p>{noWayOutText(projectName)}</p>
        ) : (
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            {alternative === null ? null : (
              <CardAction
                label={alternativeLabel(alternative)}
                note={actionNote({
                  kind: "alternative",
                  project: projectName,
                  harness: alternative.harness,
                })}
                variant="default"
                disabled={opener.opening}
                onClick={() => void opener.open()}
              />
            )}
            {use === null ? null : (
              <CardAction
                label={sharedActionLabel(projectName, use, workspace.currency)}
                note={actionNote({ kind: "shared", project: projectName, sharedOnHere })}
                variant={sharedVariant}
                disabled={opener.opening}
                onClick={() =>
                  sharedOnHere
                    ? void opener.open()
                    : void open({
                        kind: "project",
                        workspace: workspace.slug,
                        projectId: blocked.project,
                        tab: "capacity",
                      })
                }
              />
            )}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

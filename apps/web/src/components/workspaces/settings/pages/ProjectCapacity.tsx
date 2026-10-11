import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import { getAt } from "@t3tools/client-runtime/peer-settings";
import { useState } from "react";

import { useEnvironmentQuery } from "../../../../state/query";
import { serverEnvironment } from "../../../../state/server";
import { SettingsGroup } from "../../../settings/SettingsGroup";
import { CapacityRows } from "../../capacity/CapacityRows";
import { OwnersNote, PageSection, SettingsReadError } from "../CapacityCoordinationParts";
import { DraftSaveBar } from "../DraftBar";
import type { ProjectPageProps } from "../pageProps";
import { RequirePlugin } from "../PeerSettingsPage";
import { useOpenPeerSettings } from "../peerSettingsLinks";
import {
  AllocationTotal,
  AllocationsTable,
  BudgetCard,
  BudgetEditor,
  NoSharedBudget,
  PersonalPlans,
} from "../ProjectCapacityParts";
import {
  allocationEdit,
  allocationTable,
  budgetEdits,
  budgetFormFor,
  capacityFromManifest,
  consumerOnlyNames,
  defaultAllocationEdit,
  hasGateway,
  isPeriod,
  makeCustomEdit,
  modelsOf,
  periodNoun,
  personalEdit,
  personalNote,
  planOptions,
  poolName,
  projectMembers,
  readCapacity,
  readPools,
  removeSharedEdit,
  spentBy,
  usageRows,
  usedLine,
  type Edit,
  type PoolOption,
} from "../projectCapacity.logic";
import { formatMoney } from "../shared.logic";
import { SettingsUnavailableNote } from "../SettingsUnavailable";
import { useSettingsDraft } from "../useSettingsDraft";
import { useSettingsView } from "../useSettingsView";

/**
 * A project's Capacity tab (design artboard 10): its shared budget, who may spend how much of it and
 * what they used, and what personal AI plans may do in it. Admins set the budget, pool and models;
 * leads split it and set the rule for personal plans; members read. Edits go into a draft that a
 * review saves. Where the Hub has no settings, the page shows what the manifest and the gateway
 * say and nothing is editable.
 */
export function ProjectCapacity({ environmentId, status, workspace, state }: ProjectPageProps) {
  const { project } = state;
  const view = useSettingsView(workspace.slug);
  const draft = useSettingsDraft(view, { slice: ["projects", project.id, "capacity"] });
  const open = useOpenPeerSettings();
  const [editing, setEditing] = useState(false);

  // The draft's settings where they can be read, else what the manifest says.
  const document = view.hubHasSettings ? draft.document : null;
  const node = document === null ? undefined : getAt(document, ["projects", project.id]);
  const fromSettings = node !== undefined;
  const capacity = fromSettings
    ? readCapacity(draft.value)
    : capacityFromManifest(project.capacity);
  const { shared } = capacity;
  const currency = workspace.currency;

  const usage = useEnvironmentQuery(
    activePlugin(status, "capacity") && project.capacity.shared !== undefined
      ? serverEnvironment.peerHubProjectUsage({
          environmentId,
          input: { workspace: workspace.slug, projectId: project.id },
        })
      : null,
  );
  const gateway = usage.data?.shared ?? null;

  const base = ["projects", project.id, "capacity"] as const;
  // A project the document does not show cannot be edited, whatever the person's rights say.
  const canBudget = fromSettings && view.canChange([...base, "shared"]);
  const canAllocate = fromSettings && view.canChange([...base, "shared", "allocations"]);
  const canPersonal = fromSettings && view.canChange([...base, "personal"]);
  const write = (edit: Edit) => draft.set(edit.path, edit.value);

  const pools = readPools(document);
  // The pool a project names may be one its catalog does not show the person.
  const poolOptions: ReadonlyArray<PoolOption> =
    shared === undefined || pools.some((pool) => pool.id === shared.pool)
      ? pools
      : [{ id: shared.pool, name: shared.pool, models: shared.models ?? [] }, ...pools];
  const members = fromSettings ? projectMembers(node, view.people) : [];
  const saved = readCapacity(
    view.document === null ? undefined : getAt(view.document, ["projects", project.id, "capacity"]),
  ).shared;
  const table =
    fromSettings && shared !== undefined
      ? allocationTable({
          shared,
          members,
          savedCustom: new Set(
            Object.keys(saved?.allocations ?? {}).map((email) => email.toLowerCase()),
          ),
          spent: gateway === null ? undefined : spentBy(gateway.members),
        })
      : null;
  const rows = table?.rows ?? (gateway === null ? null : usageRows(gateway.members));
  // Where the budget is new, the card says so, and its rows need not all say it again.
  const changedRows = new Set(
    saved === undefined || shared === undefined
      ? []
      : (table?.rows ?? [])
          .filter((row) => draft.changed(["shared", "allocations", row.email]))
          .map((row) => row.email.toLowerCase()),
  );

  const gatewayKnown = fromSettings ? hasGateway(document) : undefined;
  const period = shared?.period ?? "month";
  const used =
    gateway !== null
      ? usedLine(gateway.spent, isPeriod(gateway.period) ? gateway.period : period, currency)
      : usage.error === null
        ? null
        : "Usage is unavailable right now.";
  const openCapacity = () =>
    void open({ kind: "workspace", workspace: workspace.slug, section: "capacity" });
  const hasClient = fromSettings
    ? typeof getAt(node, ["client"]) === "string" && getAt(node, ["client"]) !== ""
    : project.client !== undefined;

  return (
    <>
      <SettingsUnavailableNote />
      {view.error === null || fromSettings ? null : (
        <SettingsReadError project={project.name} error={view.error} onRetry={view.refresh} />
      )}

      <PageSection title="Shared budget">
        {editing ? (
          <BudgetEditor
            currency={currency}
            initial={budgetFormFor(shared, poolOptions)}
            pools={poolOptions}
            creating={shared === undefined}
            removeReason={
              capacity.personal === "none"
                ? `Personal plans are off in ${project.name}. Allow them below first.`
                : null
            }
            onDone={(budget) => {
              for (const edit of budgetEdits(shared, budget)) write(edit);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
            onRemove={() => {
              write(removeSharedEdit);
              setEditing(false);
            }}
            onOpenPools={openCapacity}
          />
        ) : shared === undefined ? (
          <NoSharedBudget
            project={project.name}
            workspace={workspace.name}
            gateway={gatewayKnown}
            removed={draft.changed(["shared"])}
            action={canBudget ? { give: () => setEditing(true), setUp: openCapacity } : undefined}
          />
        ) : (
          <>
            <BudgetCard
              amount={formatMoney(shared.amount, currency)}
              per={`per ${periodNoun(shared.period)}`}
              used={used}
              pool={poolName(shared.pool, poolOptions)}
              models={modelsOf(shared, poolOptions)}
              changed={draft.changed(["shared", "budget"]) || draft.changed(["shared", "pool"])}
              onEdit={canBudget ? () => setEditing(true) : undefined}
            />
            <p className="text-xs text-muted-foreground">
              Admins set the budget. Leads split it below.
            </p>
          </>
        )}
      </PageSection>

      {shared === undefined || rows === null ? null : (
        <PageSection title="Allocations">
          <AllocationsTable
            rows={rows}
            everyone={table?.everyone}
            currency={currency}
            period={period}
            canEdit={canAllocate}
            me={view.me}
            changed={changedRows}
            everyoneChanged={saved !== undefined && draft.changed(["shared", "defaultAllocation"])}
            onValue={(row, value) => write(allocationEdit(row.email, value))}
            onMakeCustom={(row) => write(makeCustomEdit(shared, row.email))}
            onUseDefault={(row) => write(allocationEdit(row.email, undefined))}
            onEveryone={(value) => write(defaultAllocationEdit(value))}
          />
          {table === null ? null : (
            <AllocationTotal
              summary={table.summary}
              currency={currency}
              period={period}
              project={project.name}
            />
          )}
          {fromSettings && !canAllocate ? (
            <OwnersNote owners={view.ownersOf([...base, "shared", "allocations"])} />
          ) : null}
        </PageSection>
      )}

      <PageSection title={`Personal AI plans in ${project.name}`}>
        <PersonalPlans
          project={project.name}
          options={planOptions({ project: project.name, hasShared: shared !== undefined })}
          value={capacity.personal}
          disabled={!canPersonal}
          changed={draft.changed(["personal"])}
          note={personalNote({
            rule: capacity.personal,
            hasShared: shared !== undefined,
            hasClient,
            consumerOnly: fromSettings ? consumerOnlyNames(document, members) : [],
            project: project.name,
          })}
          onChange={(rule) => write(personalEdit(rule))}
        />
        {fromSettings && !canPersonal ? (
          <OwnersNote owners={view.ownersOf([...base, "personal"])} />
        ) : null}
      </PageSection>

      {project.capacity.shared === undefined ? null : (
        <PageSection title="On this computer">
          <RequirePlugin status={status} plugin="capacity" title="Shared capacity">
            <SettingsGroup>
              <CapacityRows
                environmentId={environmentId}
                status={status}
                workspace={workspace}
                state={state}
                onThisComputerOnly
              />
            </SettingsGroup>
          </RequirePlugin>
        </PageSection>
      )}

      <DraftSaveBar draft={draft} scope={project.name} label={`${project.name} · Capacity`} />
    </>
  );
}

import type { EnvironmentId, PeerUsageDays, PeerUsageOverview } from "@t3tools/contracts";
import {
  CoinsIcon,
  CodeXmlIcon,
  CreditCardIcon,
  DatabaseIcon,
  GitBranchIcon,
  TicketIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { usePrimaryEnvironment } from "../../../state/environments";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { ProviderInstanceIcon } from "../../chat/ProviderInstanceIcon";
import { Button } from "../../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { SidebarInset } from "../../ui/sidebar";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { PeerPageHeader, PeerSectionLabel } from "../PeerPageHeader";
import { INTEGRATION_ANCHORS } from "../settings/peerSettings.logic";
import { useOpenPeerSettings } from "../settings/peerSettingsLinks";
import { usePeerHubStatus } from "../WorkspaceAccess";
import { UsageSharingSection } from "./UsageSharing";
import {
  ALL_USAGE_PROJECTS,
  DEFAULT_USAGE_DAYS,
  NOT_MEASURED,
  USAGE_STATE_TEXT,
  USAGE_WINDOWS,
  expectedUsageScope,
  sharingHasReported,
  usageAgent,
  usageAgentRows,
  usageCoverageText,
  usageEmptyText,
  usagePageState,
  usageProjectChoices,
  usageRangeText,
  usageTiles,
  usageTitle,
  usageUserRows,
  type UsageRow,
  type UsageTile,
  type UsageTileId,
} from "./workspaceUsage.logic";

const TILE_ICONS: Readonly<Record<UsageTileId, LucideIcon>> = {
  tickets: TicketIcon,
  implementations: GitBranchIcon,
  apiSpend: CreditCardIcon,
  tokenValue: CoinsIcon,
  code: CodeXmlIcon,
  tokens: DatabaseIcon,
};

function TileValue({ value }: { readonly value: UsageTile["value"] }) {
  if (value.kind === "not-measured") {
    return <p className="text-base font-medium text-muted-foreground">{NOT_MEASURED}</p>;
  }
  return (
    <p className="text-2xl font-semibold tracking-tight text-foreground tabular-nums [overflow-wrap:anywhere]">
      {value.kind === "number" ? (
        value.text
      ) : (
        <>
          {value.added} <span className="font-normal text-muted-foreground">/</span> {value.deleted}
        </>
      )}
    </p>
  );
}

function Tile({ tile, workspace }: { readonly tile: UsageTile; readonly workspace: string }) {
  const Icon = TILE_ICONS[tile.id];
  const openSettings = useOpenPeerSettings();
  return (
    <li className="flex min-w-0 flex-col gap-1.5 border-t border-border/60 py-4">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon aria-hidden className="size-4 shrink-0" />
        {tile.label}
      </p>
      <TileValue value={tile.value} />
      {tile.lines.map((line) => (
        <p key={line} className="text-xs leading-relaxed text-muted-foreground">
          {line}
        </p>
      ))}
      {tile.needsGitHub ? (
        <div>
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              void openSettings(
                { kind: "workspace", workspace, section: "integrations" },
                { hash: INTEGRATION_ANCHORS.github },
              )
            }
          >
            Set up GitHub checks
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function UsageTable({
  title,
  empty,
  rows,
  agents = false,
}: {
  readonly title: string;
  readonly empty: string;
  readonly rows: ReadonlyArray<UsageRow>;
  readonly agents?: boolean;
}) {
  const cell = "py-2 pl-3 text-right align-top whitespace-nowrap tabular-nums";
  const heading = "py-2 pl-3 text-right font-normal";
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-1">
      <PeerSectionLabel>{title}</PeerSectionLabel>
      {rows.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="w-full max-w-0 py-2 text-left font-normal">
                Name
              </th>
              <th scope="col" className={heading}>
                Runs
              </th>
              <th scope="col" className={heading}>
                Tokens
              </th>
              <th scope="col" className={heading}>
                Estimate
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60 border-t border-border/60">
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="w-full max-w-0 py-2 text-left font-normal">
                  <span className="flex min-w-0 items-center gap-2">
                    {agents ? <AgentIcon agent={row.id} /> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block text-foreground [overflow-wrap:anywhere]">
                        {row.name}
                      </span>
                      {row.note === null ? null : (
                        <span className="block text-xs text-muted-foreground">{row.note}</span>
                      )}
                    </span>
                  </span>
                </th>
                <td className={`${cell} text-foreground`}>{row.runs}</td>
                {row.tokens === null && row.usd === null ? (
                  <td colSpan={2} className={`${cell} text-xs text-muted-foreground`}>
                    {NOT_MEASURED}
                  </td>
                ) : (
                  <>
                    <Measured value={row.tokens} className={cell} />
                    <Measured value={row.usd} className={cell} />
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Measured({
  value,
  className,
}: {
  readonly value: string | null;
  readonly className: string;
}) {
  return value === null ? (
    <td className={`${className} text-xs text-muted-foreground`}>{NOT_MEASURED}</td>
  ) : (
    <td className={`${className} text-foreground`}>{value}</td>
  );
}

function AgentIcon({ agent }: { readonly agent: string }) {
  const { label, driverKind } = usageAgent(agent);
  return (
    <ProviderInstanceIcon
      driverKind={driverKind}
      displayName={label}
      indicatorBackground="var(--background)"
      className="size-5"
      iconClassName="size-4"
    />
  );
}

function UsageBody({
  overview,
  workspace,
}: {
  readonly overview: PeerUsageOverview;
  readonly workspace: string;
}) {
  return (
    <>
      <ul className="grid grid-cols-1 gap-x-8 @2xl/usage:grid-cols-3">
        {usageTiles(overview).map((tile) => (
          <Tile key={tile.id} tile={tile} workspace={workspace} />
        ))}
      </ul>
      <div className="grid grid-cols-1 gap-8 @4xl/usage:grid-cols-2">
        <UsageTable
          title="By agent"
          empty="No agent ran in these days."
          rows={usageAgentRows(overview.byAgent)}
          agents
        />
        <UsageTable
          title="By user"
          empty="No one to show in these days."
          rows={usageUserRows(overview.byUser)}
        />
      </div>
    </>
  );
}

function StateNote({ children }: { readonly children: string }) {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * A workspace's usage: what its agents' work costs and whether it reaches shipped code. Owners and
 * admins read the whole workspace, anyone else their own numbers; the Hub decides which, and every
 * number it could not source says so.
 */
export function WorkspaceUsagePage({ workspace: slug }: { readonly workspace: string }) {
  const primary = usePrimaryEnvironment();
  const environmentId =
    primary !== null && primary.connection.phase === "connected" ? primary.environmentId : null;
  const status = usePeerHubStatus(environmentId);
  const workspace = status?.workspaces.find((candidate) => candidate.slug === slug);
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <PeerPageHeader page="Usage" />
        <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
          <div className="@container/usage mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
            {environmentId === null || status === null ? (
              <StateNote>Connecting…</StateNote>
            ) : (
              <UsageContent
                environmentId={environmentId}
                slug={slug}
                signedIn={status.signedIn}
                email={status.email}
                workspace={workspace}
              />
            )}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

type WorkspaceOf = NonNullable<ReturnType<typeof usePeerHubStatus>>["workspaces"][number];

function UsageContent({
  environmentId,
  slug,
  signedIn,
  email,
  workspace,
}: {
  readonly environmentId: EnvironmentId;
  readonly slug: string;
  readonly signedIn: boolean;
  readonly email: string | null | undefined;
  readonly workspace: WorkspaceOf | undefined;
}) {
  const [days, setDays] = useState<PeerUsageDays>(DEFAULT_USAGE_DAYS);
  const [project, setProject] = useState(ALL_USAGE_PROJECTS);
  const query = useEnvironmentQuery(
    workspace === undefined
      ? null
      : serverEnvironment.peerUsageOverview({
          environmentId,
          input: {
            workspace: slug,
            days,
            ...(project === ALL_USAGE_PROJECTS ? {} : { project }),
          },
        }),
  );
  const state = usagePageState({
    signedIn,
    member: workspace !== undefined,
    answer: query.data,
    error: query.error,
  });
  if (state.kind === "signed-out" || state.kind === "unavailable") {
    return <StateNote>{USAGE_STATE_TEXT[state.kind]}</StateNote>;
  }
  if (state.kind === "older-hub") return <StateNote>{USAGE_STATE_TEXT[state.kind]}</StateNote>;

  const overview = state.kind === "ready" || state.kind === "empty" ? state.overview : null;
  const scope = overview?.scope ?? expectedUsageScope(workspace?.role);
  const projects = usageProjectChoices(
    (workspace?.projects ?? []).map((entry) => ({
      id: entry.project.id,
      name: entry.project.name,
    })),
  );
  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]">
            {usageTitle(scope, workspace?.name ?? slug)}
          </h1>
          {overview === null ? null : (
            <p className="text-xs text-muted-foreground">{usageRangeText(overview)}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {projects.length === 0 ? null : (
            <div className="w-44">
              <Select
                value={project}
                items={projects}
                onValueChange={(value) => {
                  if (value) setProject(value);
                }}
              >
                <SelectTrigger size="sm" aria-label="Project">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {projects.map((choice) => (
                    <SelectItem key={choice.value} value={choice.value}>
                      {choice.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          )}
          <ToggleGroup
            aria-label="Usage period"
            size="segmented"
            value={[String(days)]}
            onValueChange={(next) => {
              const chosen = USAGE_WINDOWS.find(({ days: value }) => String(value) === next[0]);
              if (chosen !== undefined) setDays(chosen.days);
            }}
          >
            {USAGE_WINDOWS.map((choice) => (
              <Toggle key={choice.days} value={String(choice.days)}>
                {choice.label}
              </Toggle>
            ))}
          </ToggleGroup>
        </div>
      </header>
      {state.kind === "loading" ? <StateNote>{USAGE_STATE_TEXT.loading}</StateNote> : null}
      {state.kind === "failed" ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
          <Button size="sm" variant="outline" disabled={query.isPending} onClick={query.refresh}>
            Try again
          </Button>
        </div>
      ) : null}
      {overview === null ? null : (
        <>
          <p className="text-sm text-foreground">
            {usageCoverageText(overview, formatRelativeTimeLabel)}
          </p>
          {state.kind === "empty" ? (
            <StateNote>{usageEmptyText(overview.scope)}</StateNote>
          ) : (
            <UsageBody overview={overview} workspace={slug} />
          )}
        </>
      )}
      <UsageSharingSection
        environmentId={environmentId}
        workspace={slug}
        reported={sharingHasReported(overview?.byUser ?? [], email)}
        onChanged={query.refresh}
      />
    </>
  );
}

/**
 * Settings › Overview (design artboard 3a): every integration Peer connects to, grouped by where it
 * lives — the Workspace, Me, This computer — each with its status, what is left to do, and a link to
 * its page, with a filter for what needs attention. It opens when Settings does. What it lists is
 * `overviewRows` over facts the pages already read (`useOverviewFacts`).
 */
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { useOpenPeerSettings } from "../workspaces/settings/peerSettingsLinks";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { connectionDetail } from "./connectionStatus.logic";
import { ConnectionBadge } from "./ConnectionStatus";
import {
  filterOverview,
  toFinishLabel,
  type OverviewFilter,
  type OverviewGroup,
  type OverviewRow,
} from "./overview.logic";
import type { OverviewTarget } from "./overviewRow";
import { RedactedSensitiveText } from "./RedactedSensitiveText";
import { SettingsPageContainer, useRelativeTimeTick } from "./settingsLayout";
import { useOverview } from "./useOverviewFacts";

/** Goes where a row's action says: a page of Peer's area, or a settings page. */
function useOpenOverviewTarget() {
  const navigate = useNavigate();
  const openPeer = useOpenPeerSettings();
  return (target: OverviewTarget) => {
    if (target.kind === "peer") {
      void openPeer(target.location, { hash: target.targetId });
      return;
    }
    void navigate({
      to: target.to,
      hash: target.targetId ?? "",
      hashScrollIntoView: false,
      state: { settingsTargetHighlight: true },
    });
  };
}

function RowDetail({ row }: { readonly row: OverviewRow }) {
  const detail = connectionDetail(row.connection);
  const checked =
    row.connection.checkedAt === undefined ? "" : formatRelativeTimeLabel(row.connection.checkedAt);
  return (
    <span className="min-w-48 flex-1 text-sm text-muted-foreground">
      {detail}
      {row.account === null ? null : (
        <>
          {" as "}
          <RedactedSensitiveText
            value={row.account}
            ariaLabel="Toggle account visibility"
            revealTooltip="Click to reveal account"
            hideTooltip="Click to hide account"
          />
        </>
      )}
      {detail !== undefined && checked !== "" ? " · " : null}
      {checked === "" ? null : `checked ${checked}`}
    </span>
  );
}

function OverviewRowItem({
  row,
  onOpen,
}: {
  readonly row: OverviewRow;
  readonly onOpen: (target: OverviewTarget) => void;
}) {
  const { action } = row;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5">
      <span className="w-48 min-w-0 shrink-0 truncate text-sm font-medium text-foreground">
        {row.name}
      </span>
      <ConnectionBadge state={row.connection.state} label={row.connection.label} />
      <RowDetail row={row} />
      {action === null ? null : (
        <Button
          size="xs"
          variant="outline"
          aria-label={`${action.label}: ${row.name}`}
          onClick={() => onOpen(action.target)}
        >
          {action.label}
        </Button>
      )}
    </li>
  );
}

function OverviewGroupSection({
  group,
  onOpen,
}: {
  readonly group: OverviewGroup;
  readonly onOpen: (target: OverviewTarget) => void;
}) {
  const headingId = `settings-overview-${group.id}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <h2
        id={headingId}
        className="flex items-baseline gap-2 text-sm font-semibold text-foreground"
      >
        {group.title}
        {group.who === "" ? null : (
          <span className="font-normal text-muted-foreground">{group.who}</span>
        )}
      </h2>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {group.rows.map((row) => (
          <OverviewRowItem key={row.id} row={row} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

export function SettingsOverview() {
  // "checked 2m ago" is only true for a minute.
  useRelativeTimeTick(60_000);
  const { groups, summary } = useOverview();
  const [filter, setFilter] = useState<OverviewFilter>("all");
  const open = useOpenOverviewTarget();
  const shown = filterOverview(groups, filter);
  const first = summary.first;
  const toFinish = toFinishLabel(summary);
  return (
    <SettingsPageContainer>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Everything Peer connects to, where it’s set, and what’s left to do.
          </p>
        </div>
        <ToggleGroup
          aria-label="Show"
          value={[filter]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "all" || value === "attention") setFilter(value);
          }}
        >
          <Toggle value="all">All</Toggle>
          <Toggle value="attention">
            Needs attention
            {summary.attention === 0 ? null : (
              <span className="ms-1 text-warning-foreground">{summary.attention}</span>
            )}
          </Toggle>
        </ToggleGroup>
      </header>
      {first === null ? null : (
        <Alert variant="warning" role="status" aria-label="To finish">
          <AlertTitle>{toFinish}</AlertTitle>
          <AlertDescription>{first.text}</AlertDescription>
          {first.row.action === null ? null : (
            <AlertAction>
              <Button
                size="sm"
                onClick={() => {
                  if (first.row.action !== null) open(first.row.action.target);
                }}
              >
                {first.row.action.label}
              </Button>
            </AlertAction>
          )}
        </Alert>
      )}
      {shown.map((group) => (
        <OverviewGroupSection key={group.id} group={group} onOpen={open} />
      ))}
      {filter === "attention" && shown.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          Nothing needs attention.
        </p>
      ) : null}
    </SettingsPageContainer>
  );
}

import type { ComponentProps, ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import {
  CONNECTION_STATE_LABEL,
  connectionDetail,
  type ConnectionState,
  type ConnectionStep,
} from "./connectionStatus.logic";

const VARIANT: Readonly<Record<ConnectionState, ComponentProps<typeof Badge>["variant"]>> = {
  unavailable: "outline",
  off: "secondary",
  setup: "warning",
  connected: "success",
  problem: "error",
};

/** The state as a badge with its dot; the label can say more ("Waiting", "Allowed"). */
export function ConnectionBadge(props: {
  readonly state: ConnectionState;
  readonly label?: string | undefined;
}) {
  return (
    <Badge variant={VARIANT[props.state]} size="lg">
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {props.label ?? CONNECTION_STATE_LABEL[props.state]}
    </Badge>
  );
}

/**
 * A connection's status: the badge, then the step or detail, when it was last checked, and one
 * action (Turn on, Continue setup, Fix, Manage). Lists that need only the badge use
 * `ConnectionBadge`.
 */
export function ConnectionStatus(props: {
  readonly state: ConnectionState;
  readonly label?: string | undefined;
  readonly detail?: string | undefined;
  readonly step?: ConnectionStep | undefined;
  /** An ISO time, shown as "checked 2m ago". */
  readonly checkedAt?: string | undefined;
  readonly action?: ReactNode;
}) {
  const detail = connectionDetail(props);
  const checked = props.checkedAt === undefined ? "" : formatRelativeTimeLabel(props.checkedAt);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <ConnectionBadge state={props.state} label={props.label} />
      {detail === undefined && checked === "" ? null : (
        <span className="min-w-0 text-muted-foreground text-xs">
          {detail}
          {detail !== undefined && checked !== "" ? " · " : null}
          {checked === "" ? null : `checked ${checked}`}
        </span>
      )}
      {props.action === undefined ? null : <span className="ms-auto">{props.action}</span>}
    </div>
  );
}

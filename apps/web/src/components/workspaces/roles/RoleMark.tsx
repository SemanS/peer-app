import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import { threadRole, type RolesStatusView } from "@t3tools/client-runtime/peer/roles";
import type { PeerHubStatus } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { usePrimaryEnvironmentId } from "../../../state/environments";
import { useEnvironmentQuerySelector } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { Badge } from "../../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import type { ThreadSlotProps } from "../slots.types";

const NO_STATUS = Atom.make(AsyncResult.initial<PeerHubStatus, never>(false)).pipe(
  Atom.withLabel("peer-roles:none"),
);

/**
 * The part of the status a role reads, as a string, so a thread card re-renders when a role
 * changes, not with every sync of the Hub's status.
 */
const selectRoles = (result: AsyncResult.AsyncResult<PeerHubStatus, unknown>): string => {
  const status = Option.getOrNull(AsyncResult.value(result));
  if (status === null || !activePlugin(status, "roles")) return "";
  return JSON.stringify({
    plugins: [{ id: "roles", active: true }],
    roles: status.roles,
    mcp: status.mcp,
  });
};

/** The Hub status's roles view of this computer's environment; null while there is none. */
export function useRolesView(): RolesStatusView | null {
  const environmentId = usePrimaryEnvironmentId();
  const digest = useEnvironmentQuerySelector(
    environmentId === null
      ? NO_STATUS
      : serverEnvironment.peerHubLive({ environmentId, input: {} }),
    selectRoles,
  );
  return digest === "" ? null : (JSON.parse(digest) as RolesStatusView);
}

/**
 * A thread's role on its card: "reviewing", or "reviewing · advisory" where Peer cannot stop its
 * edits, with what that means on hover. Every member of the project sees it; only its person
 * changes it, from the thread's menu.
 */
export function RoleMark({ thread }: ThreadSlotProps) {
  const view = useRolesView();
  const role = threadRole(view, thread);
  if (role === undefined) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant={role.changedFiles || role.advisory ? "warning" : "team"}
            size="sm"
            aria-label={`Role: ${role.label}`}
          />
        }
      >
        {role.label}
      </TooltipTrigger>
      <TooltipPopup>{role.detail}</TooltipPopup>
    </Tooltip>
  );
}

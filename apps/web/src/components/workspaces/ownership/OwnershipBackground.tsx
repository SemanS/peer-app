import type { EnvironmentId } from "@t3tools/contracts";

import { OwnerDialogs } from "./OwnerDialogs";
import { TeamNavigator } from "./TeamNavigator";

/**
 * What the plugin keeps mounted once at the root, inside the router: the owner dialogs a task's
 * menu opens, and the navigation to the Team page that a menu, which has no router, asks for.
 */
export function OwnershipBackground(props: {
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
}) {
  return (
    <>
      <OwnerDialogs {...props} />
      <TeamNavigator />
    </>
  );
}

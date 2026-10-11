import type { PeerProjectState } from "@t3tools/contracts";

import { Badge } from "../../ui/badge";

/** Where a repository or the company knowledge stands on this computer. */
export function CheckoutBadge({
  state,
}: {
  readonly state: PeerProjectState["repositories"][number]["state"];
}) {
  const variant =
    state === "ready"
      ? "success"
      : state === "cloning"
        ? "info"
        : state === "error"
          ? "error"
          : "outline";
  return <Badge variant={variant}>{state === "missing" ? "not checked out" : state}</Badge>;
}

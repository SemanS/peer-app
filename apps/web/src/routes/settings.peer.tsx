import { createFileRoute } from "@tanstack/react-router";

import { PeerSettingsLayout } from "../components/workspaces/settings/PeerSettingsLayout";

/**
 * Peer's settings area: the layout every `/settings/peer/…` page shares. The sidebar swaps T3's
 * settings list for `PeerSettingsNav` here, and the exact path itself is the way in (it opens the
 * first workspace, or the sign-in view).
 */
export const Route = createFileRoute("/settings/peer")({
  component: PeerSettingsLayout,
});

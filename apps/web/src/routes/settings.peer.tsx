import { createFileRoute } from "@tanstack/react-router";

import { PeerSettingsLayout } from "../components/workspaces/settings/PeerSettingsLayout";

/**
 * Peer's settings area: the layout every `/settings/peer/…` page shares. The settings navigation
 * lists these pages beside the app's own, and the exact path itself is the way in (it opens the
 * first workspace, or the sign-in view).
 */
export const Route = createFileRoute("/settings/peer")({
  component: PeerSettingsLayout,
});

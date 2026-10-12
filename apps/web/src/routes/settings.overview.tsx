import { createFileRoute } from "@tanstack/react-router";

import { SettingsOverview } from "../components/settings/SettingsOverview";

/** The landing of Settings: everything Peer connects to, and what is left to do. */
export const Route = createFileRoute("/settings/overview")({
  component: SettingsOverview,
});

import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { clearTeamRequest, openTeam, useTeamRequest } from "./teamNavigation";

/**
 * Opens the Team page when a menu asked for it (`requestTeamPage`). Mounted once at the root by
 * the plugin's background slot, where a router is at hand; it draws nothing.
 */
export function TeamNavigator() {
  const navigate = useNavigate();
  const target = useTeamRequest();
  useEffect(() => {
    if (target === null) return;
    clearTeamRequest();
    openTeam(navigate, target);
  }, [navigate, target]);
  return null;
}

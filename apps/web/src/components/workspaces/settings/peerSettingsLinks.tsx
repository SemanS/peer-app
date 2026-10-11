/**
 * Going to a page of the Peer settings area from a `PeerSettingsLocation`: as a `beforeLoad`
 * redirect, as a navigation, and as a redirect rendered in place. Each case names its route
 * literally, so the router checks every `to` against the generated route tree.
 */
import { Navigate, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import type { PeerSettingsLocation } from "./peerSettings.logic";

/** Throw it from `beforeLoad`: the address names a page this area does not have. */
export function peerSettingsRedirect(location: PeerSettingsLocation) {
  switch (location.kind) {
    case "workspace":
      return redirect({
        to: "/settings/peer/w/$workspace/$section",
        params: { workspace: location.workspace, section: location.section },
        replace: true,
      });
    case "project":
      return redirect({
        to: "/settings/peer/w/$workspace/project/$projectId/$tab",
        params: {
          workspace: location.workspace,
          projectId: location.projectId,
          tab: location.tab,
        },
        replace: true,
      });
    case "computer":
      return redirect({
        to: "/settings/peer/computer/$section",
        params: { section: location.section },
        replace: true,
      });
  }
}

/** Opens a page of the area; `replace` swaps the current history entry instead of adding one. */
export function useOpenPeerSettings() {
  const navigate = useNavigate();
  return useCallback(
    (location: PeerSettingsLocation, options: { readonly replace?: boolean } = {}) => {
      const replace = options.replace ?? false;
      switch (location.kind) {
        case "workspace":
          return navigate({
            to: "/settings/peer/w/$workspace/$section",
            params: { workspace: location.workspace, section: location.section },
            replace,
          });
        case "project":
          return navigate({
            to: "/settings/peer/w/$workspace/project/$projectId/$tab",
            params: {
              workspace: location.workspace,
              projectId: location.projectId,
              tab: location.tab,
            },
            replace,
          });
        case "computer":
          return navigate({
            to: "/settings/peer/computer/$section",
            params: { section: location.section },
            replace,
          });
      }
    },
    [navigate],
  );
}

/** Replaces the page being rendered with another of the area, as a redirect does. */
export function PeerSettingsRedirect({ to }: { readonly to: PeerSettingsLocation }) {
  switch (to.kind) {
    case "workspace":
      return (
        <Navigate
          to="/settings/peer/w/$workspace/$section"
          params={{ workspace: to.workspace, section: to.section }}
          replace
        />
      );
    case "project":
      return (
        <Navigate
          to="/settings/peer/w/$workspace/project/$projectId/$tab"
          params={{ workspace: to.workspace, projectId: to.projectId, tab: to.tab }}
          replace
        />
      );
    case "computer":
      return (
        <Navigate to="/settings/peer/computer/$section" params={{ section: to.section }} replace />
      );
  }
}

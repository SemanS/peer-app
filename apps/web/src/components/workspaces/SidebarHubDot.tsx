import { useNavigate } from "@tanstack/react-router";

import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import type { ConnectionState } from "../settings/connectionStatus.logic";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { usePeerHub } from "./projectScope";
import { hubDot } from "./sidebarHub.logic";
import { useOpenPeerSettings } from "./settings/peerSettingsLinks";

const DOT: Readonly<Record<ConnectionState, string>> = {
  connected: "bg-success",
  problem: "bg-destructive",
  setup: "bg-warning",
  off: "bg-muted-foreground/40",
  unavailable: "bg-muted-foreground/40",
};

/**
 * The Peer Hub's state at the end of the sidebar's footer: a dot in the status colors and the
 * word Hub. Its tooltip says what the Hub is doing; pressing it opens the Hub's page in Settings.
 */
export function SidebarHubDot({ onNavigate }: { readonly onNavigate: () => void }) {
  const { status } = usePeerHub();
  const navigate = useNavigate();
  const openSettings = useOpenPeerSettings();
  const dot = hubDot(status);
  const workspace = status?.workspaces[0];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="micro"
            variant="ghost-muted"
            onClick={() => {
              onNavigate();
              if (workspace === undefined) void navigate({ to: "/settings/peer" });
              else
                void openSettings({ kind: "workspace", workspace: workspace.slug, section: "hub" });
            }}
          />
        }
      >
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT[dot.state])} />
        Hub
      </TooltipTrigger>
      <TooltipPopup side="top">
        <span className="flex flex-col gap-0.5">
          <span>{dot.title}</span>
          {dot.syncedAt === null ? null : (
            <span className="text-muted-foreground">
              Synced {formatRelativeTimeLabel(dot.syncedAt)}
            </span>
          )}
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}

import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button } from "../../ui/button";
import { PeerSettingsPage } from "./PeerSettingsPage";

/**
 * What an address that names a workspace or project the person is not in shows. It stays a page
 * rather than redirecting: a workspace just joined may not be in the list for a moment.
 */
export function PeerSettingsMissing({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <PeerSettingsPage title={title}>
      <p role="status" className="text-sm text-muted-foreground">
        {children}
      </p>
      <div>
        <Button size="sm" variant="outline" onClick={() => void navigate({ to: "/settings/peer" })}>
          Open Peer settings
        </Button>
      </div>
    </PeerSettingsPage>
  );
}

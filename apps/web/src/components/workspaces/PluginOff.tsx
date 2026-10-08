import {
  inactivePluginReason,
  type InactivePluginReason,
} from "@t3tools/client-runtime/peer/plugins";
import type { EnvironmentId, PeerPluginId } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { isElectron } from "../../env";
import { usePrimaryEnvironment } from "../../state/environments";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { usePeerPluginControl } from "./usePeerPluginControl";
import { usePeerHubStatus } from "./WorkspaceAccess";

function Page({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <span className="min-w-0 truncate text-sm font-medium text-foreground">{title}</span>
        </WorkspacePageHeader>
        <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-3 px-6 py-6">
          {children}
        </div>
      </div>
    </SidebarInset>
  );
}

/** Lets the owner of the environment turn the plugin on from the page that needs it. */
function TurnOn({
  environmentId,
  plugin,
  title,
}: {
  readonly environmentId: EnvironmentId;
  readonly plugin: PeerPluginId;
  readonly title: string;
}) {
  const { owner, change } = usePeerPluginControl(environmentId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!owner) {
    return (
      <p className="text-sm text-muted-foreground">
        Ask the owner of this environment to turn it on.
      </p>
    );
  }
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void change(plugin, true)
            .then(setError)
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Turning on…" : `Turn on ${title}`}
      </Button>
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

const REASON_TEXT: Readonly<Record<InactivePluginReason, string>> = {
  off: "is turned off on this environment.",
  hub: "needs a newer Peer Hub.",
  missing: "is not available on this environment.",
};

/** What a page of a plugin shows while the plugin is not active: why, and for owners how to fix it. */
function PluginOff({
  environmentId,
  plugin,
  title,
  reason,
}: {
  readonly environmentId: EnvironmentId;
  readonly plugin: PeerPluginId;
  readonly title: string;
  readonly reason: InactivePluginReason;
}) {
  return (
    <Page title={title}>
      <p role="status" className="text-sm text-muted-foreground">
        {title} {REASON_TEXT[reason]}
      </p>
      {reason === "off" ? (
        <TurnOn environmentId={environmentId} plugin={plugin} title={title} />
      ) : null}
    </Page>
  );
}

/**
 * A page that belongs to a plugin. It shows the page while the plugin is active on the primary
 * environment, and otherwise says the plugin is off, so a link to the page never lands on a feature
 * the environment does not run.
 */
export function PeerPluginPage({
  plugin,
  title,
  children,
}: {
  readonly plugin: PeerPluginId;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const primary = usePrimaryEnvironment();
  const environmentId =
    primary !== null && primary.connection.phase === "connected" ? primary.environmentId : null;
  const status = usePeerHubStatus(environmentId);
  if (environmentId === null || status === null) {
    return (
      <Page title={title}>
        <p role="status" className="text-sm text-muted-foreground">
          Connecting…
        </p>
      </Page>
    );
  }
  const reason = inactivePluginReason(status, plugin);
  if (reason === null) return children;
  const shown = status.plugins?.find((state) => state.id === plugin)?.title ?? title;
  return <PluginOff environmentId={environmentId} plugin={plugin} title={shown} reason={reason} />;
}

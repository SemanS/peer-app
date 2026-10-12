import {
  inactivePluginReason,
  pluginLockNote,
  type InactivePluginReason,
} from "@t3tools/client-runtime/peer/plugins";
import type { EnvironmentId, PeerHubStatus, PeerPluginId } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { usePrimaryEnvironment } from "../../state/environments";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { PeerPageHeader } from "./PeerPageHeader";
import { reasonText } from "./PeerPluginsSettings.logic";
import { usePeerPluginControl } from "./usePeerPluginControl";
import { usePeerHubStatus } from "./WorkspaceAccess";

function Page({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <PeerPageHeader page={title} />
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

/** What a page of a plugin shows while the plugin is not active: why, and for owners how to fix it. */
function PluginOff({
  environmentId,
  status,
  plugin,
  title,
  reason,
  lockNote,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly plugin: PeerPluginId;
  readonly title: string;
  readonly reason: InactivePluginReason;
  readonly lockNote: string | null;
}) {
  return (
    <Page title={title}>
      <p role="status" className="text-sm text-muted-foreground">
        {lockNote ?? `${title} ${reasonText(reason, status, plugin)}`}
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
 * the environment does not run. A page that lists what it asks the environment for says for itself
 * what an environment that is not connected means (`handlesDisconnected`: that nothing was asked,
 * and that the list is not empty), where the others wait for the connection.
 */
export function PeerPluginPage({
  plugin,
  title,
  handlesDisconnected = false,
  children,
}: {
  readonly plugin: PeerPluginId;
  readonly title: string;
  readonly handlesDisconnected?: boolean;
  readonly children: ReactNode;
}) {
  const primary = usePrimaryEnvironment();
  const environmentId =
    primary !== null && primary.connection.phase === "connected" ? primary.environmentId : null;
  const status = usePeerHubStatus(environmentId);
  // Still on its first attempt, the environment may connect any moment: that is not worth a card.
  if (
    handlesDisconnected &&
    primary !== null &&
    primary.connection.phase !== "connected" &&
    primary.connection.phase !== "connecting"
  ) {
    return children;
  }
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
  const state = status.plugins?.find((state) => state.id === plugin);
  return (
    <PluginOff
      environmentId={environmentId}
      status={status}
      plugin={plugin}
      title={shown}
      reason={reason}
      lockNote={state ? pluginLockNote(state) : null}
    />
  );
}

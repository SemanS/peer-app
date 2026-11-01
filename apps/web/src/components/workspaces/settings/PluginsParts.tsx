/**
 * The parts of this computer's Plugins page: the Peer plugins with where each one's state comes
 * from. They draw what `plugins.logic` works out.
 */
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { useState } from "react";

import { ConnectionBadge } from "../../settings/ConnectionStatus";
import { Switch } from "../../ui/switch";
import { usePeerPluginControl } from "../usePeerPluginControl";
import { PageSection } from "./PageParts";
import { hubOffPlugins, pluginViews, type PluginView } from "./plugins.logic";

/** A plugin's status in the one language every connection speaks, and where it comes from. */
function PluginChip({ view }: { readonly view: PluginView }) {
  return (
    <span className="inline-flex items-center gap-2">
      <ConnectionBadge state={view.status} label={view.statusLabel} />
      {view.source === "" ? null : (
        <span className="text-xs text-muted-foreground">{view.source}</span>
      )}
    </span>
  );
}

/**
 * "Peer plugins": each plugin of this computer with its state and where that comes from (its
 * owner's choice, an operator forcing it off, the Hub turning its feature off or being too old for
 * it) and a switch for the owner. A change applies at once. Nothing is drawn for an environment
 * that lists no plugins.
 */
function PeerPlugins({
  environmentId,
  status,
  hubOff,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  /** The plugins whose Hub feature the Hub turned off. */
  readonly hubOff: ReadonlySet<string>;
}) {
  const { owner, change } = usePeerPluginControl(environmentId);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const views = pluginViews(status.plugins ?? [], {
    owner,
    pending,
    hubOff,
    signedIn: status.signedIn,
  });
  if (views.length === 0) return null;

  const toggle = (view: PluginView, enabled: boolean) => {
    setPending(view.id);
    setError(null);
    void change(view.id, enabled)
      .then((failure) => {
        if (failure !== null) setError(`Could not change ${view.title}: ${failure}`);
      })
      .finally(() => setPending(null));
  };

  return (
    <PageSection
      title="Peer plugins"
      description="A change applies at once, and turning a plugin off also undoes what it set up outside Peer."
    >
      <div className="overflow-hidden rounded-xl border bg-card">
        {views.map((view) => (
          <div
            key={view.id}
            className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b px-3.5 py-2.5 last:border-b-0"
          >
            <div className="flex min-w-48 flex-1 flex-col">
              <span className="text-sm font-medium">{view.title}</span>
              {view.note === null ? null : (
                <span className="text-xs text-muted-foreground">{view.note}</span>
              )}
              {view.error === null ? null : (
                <span className="text-xs text-destructive-foreground">{view.error}</span>
              )}
            </div>
            <PluginChip view={view} />
            <Switch
              checked={view.checked}
              disabled={view.disabled}
              aria-label={`Use ${view.title} on this environment`}
              onCheckedChange={(checked) => toggle(view, checked)}
            />
          </div>
        ))}
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      )}
      {owner ? null : (
        <p className="text-xs text-muted-foreground">
          Only this computer’s owner turns plugins on or off.
        </p>
      )}
    </PageSection>
  );
}

/** The "Peer plugins" section: the Hub lists the features it turned off. */
export function PeerPluginsSection({
  environmentId,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
}) {
  return (
    <PeerPlugins environmentId={environmentId} status={status} hubOff={hubOffPlugins(status.hub)} />
  );
}

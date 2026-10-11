import type { ReactNode } from "react";

import { formatRelativeTimeLabel } from "../../../../timestampFormat";
import { useRelativeTimeTick } from "../../../settings/settingsLayout";
import { PeerCard } from "../../PeerPageHeader";
import {
  HUB_DESCRIPTION,
  featuresFootnote,
  hubAddress,
  hubBuild,
  hubFeatureRows,
  projectsWithPathRules,
  type FeatureState,
} from "../hubStatus.logic";
import type { WorkspacePageProps } from "../pageProps";
import { PeerSettingsPage } from "../PeerSettingsPage";
import { useSettingsView } from "../useSettingsView";

const DOT: Readonly<Record<FeatureState, string>> = {
  on: "size-2 shrink-0 rounded-full bg-success",
  "off-hub": "size-2 shrink-0 rounded-full bg-warning",
  newer: "size-2 shrink-0 rounded-full bg-muted-foreground/40",
  "off-here": "size-2 shrink-0 rounded-full bg-muted-foreground/40",
};

const LABEL: Readonly<Record<FeatureState, string>> = {
  on: "text-sm text-muted-foreground",
  "off-hub": "text-sm text-warning-foreground",
  newer: "text-sm text-muted-foreground",
  "off-here": "text-sm text-muted-foreground",
};

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <PeerCard className="gap-0.5 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-sm text-foreground">{children}</span>
    </PeerCard>
  );
}

/**
 * The Hub this computer is signed in to (design artboard 23): read only, since its operator changes
 * it. Its address, build and the last sync, and each of its features: on, off for the operator's
 * choice, or waiting for a newer Hub, with what it means for the workspace. A Hub says its build
 * and its features in the answer that tells who is signed in; one that says less (an older Hub)
 * leaves the page to the plugins' states and the settings read.
 */
export function HubStatus({ status, workspace }: WorkspacePageProps) {
  useRelativeTimeTick(60_000);
  const view = useSettingsView(workspace.slug);
  const features = hubFeatureRows({
    plugins: status.plugins,
    hub: status.hub,
    flags: view.features,
    pathRuleProjects: projectsWithPathRules(view.document),
  });
  const build = hubBuild(status.hub);
  return (
    <PeerSettingsPage title="Hub" description={HUB_DESCRIPTION}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Address">
          <span className="font-mono text-xs">{hubAddress(status.hubUrl)}</span>
        </Fact>
        {build === null ? null : (
          <Fact label="Version">
            <span className="flex items-baseline gap-1.5">
              {build.version === null ? null : (
                <span className="font-semibold">{build.version}</span>
              )}
              {build.commit === null ? null : (
                <span className="font-mono text-xs text-muted-foreground">{build.commit}</span>
              )}
            </span>
          </Fact>
        )}
        <Fact label="Synced">
          {status.lastSyncAt ? formatRelativeTimeLabel(status.lastSyncAt) : "Not yet"}
        </Fact>
        {view.revision === null ? null : <Fact label="Settings">revision {view.revision}</Fact>}
      </div>
      <section aria-labelledby="hub-features" className="flex flex-col gap-2.5">
        <h2 id="hub-features" className="text-sm font-semibold text-foreground">
          Features
        </h2>
        <ul
          aria-label="Features of the Hub"
          className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
        >
          {features.map((feature) => (
            <li
              key={feature.id}
              className="grid gap-x-3 gap-y-1 px-3.5 py-2.5 sm:grid-cols-[10rem_12rem_minmax(0,1fr)] sm:items-center"
            >
              <span className="text-sm font-medium text-foreground">{feature.name}</span>
              <span className="flex items-center gap-2">
                <span aria-hidden className={DOT[feature.state]} />
                <span className={LABEL[feature.state]}>{feature.label}</span>
              </span>
              <span className="text-sm text-muted-foreground">{feature.effect}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{featuresFootnote(features)}</p>
      </section>
    </PeerSettingsPage>
  );
}

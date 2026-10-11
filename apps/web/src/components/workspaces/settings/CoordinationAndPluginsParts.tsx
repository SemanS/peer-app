/**
 * The parts of This computer's Coordination & plugins page (design artboard 13): the default policy
 * with the projects it applies to and those that set their own, and the Peer plugins with where
 * each one's state comes from. They draw what `coordinationAndPlugins.logic` works out; the
 * choices they offer go through the environment's own commands (the ones the old rows used).
 */
import type {
  EnvironmentId,
  PeerCoordinationPolicy,
  PeerHubStatus,
  PeerWorkspaceState,
} from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Badge } from "../../ui/badge";
import { Switch } from "../../ui/switch";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { ProjectMark } from "../signals";
import { usePeerPluginControl } from "../usePeerPluginControl";
import { projectScopeKey } from "../workBoard.logic";
import { reportFailure } from "../workFeedback";
import { PageSection } from "./CapacityCoordinationParts";
import {
  COORDINATION_OFF_NOTE,
  DEFAULT_POLICIES,
  defaultPolicyHint,
  hubOffPlugins,
  isDefaultPolicy,
  pathRulesNote,
  pluginViews,
  projectsWithPathRules,
  splitByDefault,
  type DefaultSplit,
  type PluginView,
  type ProjectRef,
} from "./coordinationAndPlugins.logic";
import { useSettingsView } from "./useSettingsView";
import { ValueSource } from "./ValueSource";

const Quiet = ({ children }: { readonly children: ReactNode }) => (
  <p className="text-sm text-muted-foreground">{children}</p>
);

/** A project by its mark and name; with several workspaces, the workspace too, since names repeat. */
function ProjectChip({
  project,
  withWorkspace,
}: {
  readonly project: ProjectRef;
  readonly withWorkspace: boolean;
}) {
  return (
    <span className="inline-flex min-h-6.5 max-w-full min-w-0 items-center gap-1.5 rounded-md bg-secondary px-2 text-sm">
      <ProjectMark
        name={project.name}
        colorKey={projectScopeKey({ workspace: project.workspace, projectId: project.id })}
        className="size-4"
      />
      <span className="truncate">{project.name}</span>
      {withWorkspace ? (
        <span className="truncate text-muted-foreground">{project.workspaceName}</span>
      ) : null}
    </span>
  );
}

function PanelRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 border-b px-3.5 py-3 last:border-b-0">
      <span className="w-28 shrink-0 text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/**
 * Which projects the default applies to, and which it does not because they set a policy of their
 * own, with what the default would have said struck through. A project of a workspace this
 * computer has not heard the policies of yet is listed apart ("Policy unknown"), not claimed for
 * the default.
 */
function AppliesPanel({
  split,
  withWorkspace,
}: {
  readonly split: DefaultSplit;
  readonly withWorkspace: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {split.applies.length === 0 && split.own.length === 0 ? null : (
        <PanelRow label="Applies to">
          {split.applies.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              No project: each one sets its own policy.
            </span>
          ) : (
            split.applies.map((project) => (
              <ProjectChip
                key={`${project.workspace}/${project.id}`}
                project={project}
                withWorkspace={withWorkspace}
              />
            ))
          )}
        </PanelRow>
      )}
      {split.own.map(({ project, policy, overridden }, index) => (
        <PanelRow key={`${project.workspace}/${project.id}`} label={index === 0 ? "Not in" : ""}>
          <ProjectChip project={project} withWorkspace={withWorkspace} />
          <ValueSource
            value={
              <>
                {overridden === null ? null : (
                  <>
                    <s className="text-muted-foreground line-through">{overridden}</s>
                    <span aria-hidden className="text-muted-foreground/60">
                      {" → "}
                    </span>
                  </>
                )}
                {policy}
              </>
            }
            from={{
              kind: "project",
              name: project.name,
              colorKey: projectScopeKey({ workspace: project.workspace, projectId: project.id }),
            }}
            source={`from ${project.name}`}
          />
        </PanelRow>
      ))}
      {split.unread.length === 0 ? null : (
        <PanelRow label="Policy unknown">
          {split.unread.map((project) => (
            <ProjectChip
              key={`${project.workspace}/${project.id}`}
              project={project}
              withWorkspace={withWorkspace}
            />
          ))}
        </PanelRow>
      )}
    </div>
  );
}

/**
 * "Your default policy": notify, coordinate or ask, which this computer's agents follow in every
 * project that sets none, as a segmented control with what the chosen one means, and under it the
 * projects it applies to and those that set their own. While agent coordination is off there is no
 * policy to apply, and the section says so instead of listing projects.
 */
export function DefaultPolicy({
  environmentId,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
}) {
  const set = useAtomCommand(serverEnvironment.peerHubSetCoordination, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const { coordination, workspaces } = status;
  const split = splitByDefault(workspaces, coordination.policies, coordination.policy);
  const projects = split.applies.length + split.own.length + split.unread.length;
  const change = async (policy: PeerCoordinationPolicy) => {
    setBusy(true);
    try {
      reportFailure(
        "Could not change the default policy",
        await set({ environmentId, input: { policy } }),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <PageSection title="Your default policy">
      <ToggleGroup
        aria-label="Your default policy"
        value={[coordination.policy]}
        disabled={busy}
        onValueChange={(next) => {
          const policy = next[0];
          if (isDefaultPolicy(policy)) void change(policy);
        }}
      >
        {DEFAULT_POLICIES.map((policy) => (
          <Toggle key={policy.value} value={policy.value}>
            {policy.value}
          </Toggle>
        ))}
      </ToggleGroup>
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {coordination.enabled ? defaultPolicyHint(coordination.policy) : COORDINATION_OFF_NOTE}
      </p>
      {!coordination.enabled ? null : projects === 0 ? (
        <Quiet>You’re not on a project yet.</Quiet>
      ) : (
        <AppliesPanel split={split} withWorkspace={workspaces.length > 1} />
      )}
    </PageSection>
  );
}

/**
 * What stops applying in a workspace's projects while the Hub keeps path rules off: the projects of
 * the person that have some, from the settings the Hub shows them. Nothing where none has.
 */
function WorkspacePathRules({
  workspace,
  named,
}: {
  readonly workspace: PeerWorkspaceState;
  readonly named: boolean;
}) {
  const view = useSettingsView(workspace.slug);
  const names = projectsWithPathRules(
    view.document,
    new Set(workspace.projects.map(({ project }) => project.id)),
  );
  if (names.length === 0) return null;
  return (
    <span className="text-xs text-warning-foreground">
      {named ? `In ${workspace.name}: ` : ""}
      {pathRulesNote(names)}
    </span>
  );
}

function PluginChip({ view }: { readonly view: PluginView }) {
  return (
    <Badge variant={view.tone === "warn" ? "warning" : "outline"} size="control">
      <span className="font-semibold">{view.state}</span>
      <span aria-hidden className="text-muted-foreground">
        ·
      </span>
      <span className="font-normal text-muted-foreground">{view.source}</span>
    </Badge>
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
  pathRules,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  /** The plugins whose Hub feature the Hub turned off. */
  readonly hubOff: ReadonlySet<string>;
  /** What stops applying while the Hub keeps path rules off. */
  readonly pathRules: ReactNode;
}) {
  const { owner, change } = usePeerPluginControl(environmentId);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const views = pluginViews(status.plugins ?? [], { owner, pending, hubOff });
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
              {view.consequence === "path-rules" ? pathRules : null}
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

/**
 * The plugins, told which features the Hub turned off by what it says of itself, and for an older
 * Hub by the first workspace's settings.
 */
function PeerPluginsOfHub({
  environmentId,
  status,
  workspace,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: PeerWorkspaceState;
}) {
  // The features are the Hub's, the same in every workspace of it.
  const view = useSettingsView(workspace.slug);
  return (
    <PeerPlugins
      environmentId={environmentId}
      status={status}
      hubOff={hubOffPlugins(status.hub, view.features)}
      pathRules={status.workspaces.map((candidate) => (
        <WorkspacePathRules
          key={candidate.slug}
          workspace={candidate}
          named={status.workspaces.length > 1}
        />
      ))}
    />
  );
}

/**
 * The "Peer plugins" section. A Hub lists the features it turned off; for one that does not, the
 * settings it shows say so (a workspace is needed to read them), and a plugin it does not serve
 * otherwise reads as needing a newer Hub.
 */
export function PeerPluginsSection({
  environmentId,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
}) {
  const first = status.workspaces[0];
  return first === undefined ? (
    <PeerPlugins
      environmentId={environmentId}
      status={status}
      hubOff={hubOffPlugins(status.hub, null)}
      pathRules={null}
    />
  ) : (
    <PeerPluginsOfHub environmentId={environmentId} status={status} workspace={first} />
  );
}

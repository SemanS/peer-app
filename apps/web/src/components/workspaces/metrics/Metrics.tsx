import { useState } from "react";
import type {
  EnvironmentId,
  PeerHubStatus,
  PeerMetricsConfigureInput,
  PeerTask,
} from "@t3tools/contracts";
import { formatMetric, metricsUnavailable } from "@t3tools/client-runtime/peer/metrics";
import { activePlugin } from "@t3tools/client-runtime/peer/plugins";
import { useEnvironment } from "../../../state/environments";
import { serverEnvironment } from "../../../state/server";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from "../../ui/dialog";
import { failureMessage } from "../WorkspaceAccess";
import { usePeerPluginControl } from "../usePeerPluginControl";
import type {
  PeerSlotProps,
  ProjectSlotProps,
  ProjectSettingsSlotProps,
  WorkspaceSettingsSlotProps,
} from "../slots.types";
import {
  initialMetricsView,
  metricsDayShift as dayShift,
  metricsSection,
  metricsSpend,
  metricsSettingsState,
} from "./metrics.logic";
import { exportFiles, downloadFiles, saveDownload } from "./downloadExport";
export function MetricsPanel({
  environmentId,
  status,
  workspace,
  project,
  name,
  tasks,
}: {
  environmentId: EnvironmentId;
  status: PeerHubStatus;
  workspace: string;
  project: string;
  name: string;
  tasks: ReadonlyArray<PeerTask>;
}) {
  const environmentName = useEnvironment(environmentId)?.label ?? String(environmentId);
  const [open, setOpen] = useState<boolean>(initialMetricsView.expanded),
    [scope, setScope] = useState<"environment" | "team">(initialMetricsView.scope),
    [windowDays, setWindowDays] = useState<7 | 28 | 90>(initialMetricsView.window),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const query = useEnvironmentQuery(
    open
      ? serverEnvironment.peerMetricsSummary({
          environmentId,
          input: { workspace, project, scope, window: windowDays },
        })
      : null,
  );
  const spend = useEnvironmentQuery(
    open && activePlugin(status, "capacity")
      ? serverEnvironment.peerHubProjectUsage({
          environmentId,
          input: { workspace, projectId: project },
        })
      : null,
  );
  const days = useAtomCommand(serverEnvironment.peerMetricsDays, { reportFailure: false });
  const summary = query.data,
    view = summary ? metricsSection(summary, tasks, status.coordination.enabled) : null;
  const exportDays = async (json: boolean) => {
    if (!summary) return;
    setBusy(true);
    setError(null);
    try {
      const result = await days({
        environmentId,
        input: {
          workspace,
          project,
          scope,
          from: from || dayShift(summary.dayEnding, 1 - windowDays),
          to: to || summary.dayEnding,
        },
      });
      if (result._tag !== "Success") {
        setError(metricsUnavailable(failureMessage(result) ?? "Could not read metrics."));
        return;
      }
      await downloadFiles(
        exportFiles(result.value, String(environmentId), tasks, json),
        saveDownload,
      );
    } catch (e) {
      setError(metricsUnavailable(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-2 py-2">
      <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide metrics" : "Metrics"} · {name}
      </Button>
      {open ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            This environment: {environmentName}. Windows end on a UTC day. Numbers are estimates
            with the sources shown below.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {(["environment", "team"] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant="outline"
                aria-pressed={scope === s}
                disabled={s === "team" && !view?.teamAvailable}
                title={s === "team" ? view?.teamReason : undefined}
                onClick={() => setScope(s)}
              >
                {s === "environment" ? "This environment" : "Team"}
              </Button>
            ))}
            {([7, 28, 90] as const).map((w) => (
              <Button
                key={w}
                size="sm"
                variant="ghost"
                aria-pressed={windowDays === w}
                onClick={() => setWindowDays(w)}
              >
                {w} days
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={query.refresh} disabled={query.isPending}>
              Refresh
            </Button>
          </div>
          {query.isPending && !summary ? <p role="status">Reading metrics…</p> : null}
          {query.error ? <p role="status">{metricsUnavailable(query.error)}</p> : null}
          {summary && view ? (
            <>
              <p className="text-sm">
                {summary.scope === "team"
                  ? `Team · ${summary.current.computers ?? 0} contributing computers`
                  : "This environment"}
                . {summary.team.reason} Computed {new Date(summary.computedAt).toLocaleString()}.
                {summary.current.incomplete
                  ? " Some ledger events were outside the Hub’s bounded read; outcomes are incomplete."
                  : ""}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {view.cards.map((card) => (
                  <article key={card.id} className="space-y-1 rounded border p-3">
                    <h4 className="text-sm font-medium">{card.title}</h4>
                    <p className="text-lg">{formatMetric(card.value, card.unit)}</p>
                    {card.reason ? (
                      <p className="text-xs text-muted-foreground">{card.reason}</p>
                    ) : null}
                    {card.change !== null ? (
                      <p className="text-xs">
                        Previous equal window: {formatMetric(card.previous, card.unit)}; change{" "}
                        {card.change > 0 ? "+" : ""}
                        {card.unit === "ratio"
                          ? `${(card.change * 100).toFixed(1)} percentage points`
                          : card.change.toLocaleString()}
                        .
                      </p>
                    ) : null}
                    <details>
                      <summary className="cursor-pointer text-xs">Definition and coverage</summary>
                      <p className="text-xs">{card.definition}</p>
                      <p className="text-xs">
                        Source: {card.source}. Covers {card.covers}. {card.excludes}
                      </p>
                    </details>
                  </article>
                ))}
              </div>
              <details>
                <summary className="cursor-pointer text-sm">
                  Adapter coverage and task tokens
                </summary>
                {view.adapters.map((a) => (
                  <p key={a.adapter} className="text-xs">
                    {a.label}:{" "}
                    {a.coverage === null
                      ? "not measured"
                      : `${formatMetric(a.coverage, "ratio")} (${a.decided} decided, ${a.wentOn} went on without a verdict)`}
                    .
                  </p>
                ))}
                <p className="text-xs">
                  Edit latency median: {formatMetric(view.p50, "ms-upper")}. Done directly:{" "}
                  {formatMetric(view.doneDirect)}. Tokens are not money; partial totals omit
                  unavailable or subagent usage.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th>Task</th>
                        <th>Input</th>
                        <th>Output</th>
                        <th>Cached</th>
                        <th>Turns</th>
                        <th>Partial</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.taskRows.map((t) => (
                        <tr key={t.ref}>
                          <td>
                            {t.key ? `${t.key} · ` : ""}
                            {t.title}
                          </td>
                          <td>{t.in}</td>
                          <td>{t.out}</td>
                          <td>{t.cached}</td>
                          <td>{t.turns}</td>
                          <td>{t.partial}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {view.otherTasks ? (
                    <p>{view.otherTasks} further task rows are included in the export.</p>
                  ) : null}
                </div>
              </details>
              <p className="text-xs">
                Shared-capacity spend:{" "}
                {
                  metricsSpend(
                    spend.data,
                    activePlugin(status, "capacity"),
                    Boolean(spend.error),
                    status.email,
                  ).text
                }{" "}
                {
                  metricsSpend(
                    spend.data,
                    activePlugin(status, "capacity"),
                    Boolean(spend.error),
                    status.email,
                  ).footnote
                }
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="space-y-1 text-xs">
                  From (UTC)
                  <Input
                    type="date"
                    value={from || dayShift(summary.dayEnding, 1 - windowDays)}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </label>
                <label className="space-y-1 text-xs">
                  To (UTC)
                  <Input
                    type="date"
                    value={to || summary.dayEnding}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void exportDays(false)}
                >
                  Download CSVs
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void exportDays(true)}
                >
                  Download JSON
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Exports save on this client and include definitions of coverage. Choose at most 366
                UTC days.
              </p>
            </>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
export const MetricsProjectHistory = ({ environmentId, status, project }: ProjectSlotProps) => (
  <MetricsPanel
    environmentId={environmentId}
    status={status}
    workspace={project.workspace}
    project={project.projectId}
    name={project.name}
    tasks={project.tasks}
  />
);
export const MetricsProjectSettings = ({
  environmentId,
  status,
  workspace,
  state,
}: ProjectSettingsSlotProps) => (
  <MetricsPanel
    environmentId={environmentId}
    status={status}
    workspace={workspace.slug}
    project={state.project.id}
    name={state.project.name}
    tasks={state.work.tasks}
  />
);
function MetricsControl({
  environmentId,
  input,
  label,
  confirm,
  disabled,
}: {
  environmentId: EnvironmentId;
  input: PeerMetricsConfigureInput;
  label: string;
  confirm?: string;
  disabled?: boolean;
}) {
  const command = useAtomCommand(serverEnvironment.peerMetricsConfigure, { reportFailure: false }),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false),
    [error, setError] = useState<string | null>(null);
  const act = async () => {
    setBusy(true);
    try {
      const r = await command({ environmentId, input });
      setError(r._tag === "Success" ? null : metricsUnavailable(failureMessage(r)));
      if (r._tag === "Success") setOpen(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || disabled}
        onClick={() => (confirm ? setOpen(true) : void act())}
      >
        {label}
      </Button>
      {error ? <p role="alert">{error}</p> : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{confirm}</DialogDescription>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void act()}>
              {label}
            </Button>
          </div>
        </DialogPopup>
      </Dialog>
    </>
  );
}
export function MetricsSettings({ environmentId, status }: PeerSlotProps) {
  const { owner } = usePeerPluginControl(environmentId),
    debug = status.metrics?.debug;
  const [notice, setNotice] = useState(() => {
    try {
      return localStorage.getItem(`peer.metrics.scrub.${environmentId}`) !== "seen";
    } catch {
      return true;
    }
  });
  if (!status.metrics) return null;
  return (
    <section className="space-y-2 py-3">
      <h3 className="text-sm font-medium">Coordination metrics</h3>
      <p className="text-sm">
        Local measurement is on while this plugin is active. Team sharing starts off for each person
        on each environment. Read project metrics here or under Work.
      </p>
      {notice ? (
        <p className="text-xs">
          Existing coordination logs were scrubbed once to remove text. New regular logs keep
          counts, sizes and timings.
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setNotice(false);
              try {
                localStorage.setItem(`peer.metrics.scrub.${environmentId}`, "seen");
              } catch {
                /* optional client notice */
              }
            }}
          >
            Dismiss
          </Button>
        </p>
      ) : null}
      <p className="text-sm">
        Debug detail:{" "}
        {debug?.on
          ? debug.forced
            ? "forced on by the operator"
            : `on until ${new Date(debug.until!).toLocaleString()}`
          : "off"}
        . {debug?.path}
      </p>
      <p className="text-xs">
        Debug logs can contain prompts, paths and replies. They stay on this environment, are never
        uploaded as metrics, and expire after 24 hours unless the operator forces them on.
      </p>
      {owner ? (
        <div className="flex flex-wrap gap-2">
          <MetricsControl
            environmentId={environmentId}
            input={{ debug: "on" }}
            label="Enable debug for 24 hours"
            confirm="Write detailed coordination data on this environment for 24 hours? Enabling again replaces the previous debug log."
          />
          <MetricsControl
            environmentId={environmentId}
            input={{ debug: "off" }}
            label="Stop debug"
          />
          <MetricsControl
            environmentId={environmentId}
            input={{ debug: "delete" }}
            label="Delete debug log"
            confirm="Delete the local debug log and its rotated copy? An operator-forced log may start writing again."
          />
          <MetricsControl
            environmentId={environmentId}
            input={{ eraseLocal: true }}
            label="Erase local metrics"
            confirm="Erase all saved local metrics on this environment? Team rows already shared are erased separately by turning sharing off."
          />
        </div>
      ) : (
        <p className="text-xs">
          Only this environment's owner can change sharing, debug logging or local storage.
        </p>
      )}
    </section>
  );
}
export function MetricsWorkspaceSettings({
  environmentId,
  status,
  workspace,
}: WorkspaceSettingsSlotProps) {
  const { owner } = usePeerPluginControl(environmentId),
    current = status.metrics?.workspaces.find((w) => w.workspace === workspace.slug),
    first = workspace.projects[0];
  const query = useEnvironmentQuery(
    first
      ? serverEnvironment.peerMetricsSummary({
          environmentId,
          input: {
            workspace: workspace.slug,
            project: first.project.id,
            scope: "environment",
            window: 28,
          },
        })
      : null,
  );
  const team = query.data?.team ?? current?.team,
    controls = metricsSettingsState(workspace.role, owner, team, status.metrics?.debug);
  if (!current) return null;
  return (
    <section className="space-y-2 py-2">
      <h4 className="text-sm font-medium">Team metrics</h4>
      <p className="text-xs">
        {team?.reason} Your sharing: {current.sharing ? "on" : "off"}.
        {current.eraseOwed ? " Deletion is pending; uploads are blocked until it succeeds." : ""}
      </p>
      {controls.canShare ? (
        <div className="flex flex-wrap gap-2">
          <MetricsControl
            environmentId={environmentId}
            input={{ workspace: workspace.slug, sharing: !current.sharing }}
            disabled={!current.sharing && !controls.canStartSharing}
            label={
              current.sharing
                ? "Stop sharing and erase my rows"
                : "Share this environment’s metrics"
            }
            confirm={
              current.sharing
                ? "Stop sharing and delete the metrics this computer uploaded? Local measurements stay here."
                : "Share content-free counts with this workspace from today? The workspace also needs its admin switch enabled. Earlier days remain local."
            }
          />
          {controls.admin && controls.canEnableTeam ? (
            <MetricsControl
              environmentId={environmentId}
              input={{ workspace: workspace.slug, team: team?.state !== "on" }}
              label={team?.state === "on" ? "Disable team metrics" : "Enable team metrics"}
              confirm={
                team?.state === "on"
                  ? "Disable team metrics and erase all saved workspace metrics? Everyone’s local measurements remain on their computers."
                  : "Allow members to opt in to sharing content-free metrics? Each member still chooses whether this environment shares."
              }
            />
          ) : (
            <p className="text-xs">Only a workspace owner or admin can enable team metrics.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

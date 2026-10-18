import type { EnvironmentId, PeerForecastPair, PeerHubStatus } from "@t3tools/contracts";
import { changeIdParts } from "@t3tools/client-runtime/peer/changes";
import { forecastPairKey } from "@t3tools/client-runtime/peer-forecast";
import { useState } from "react";

import { useAtomCommand } from "../../../state/use-atom-command";
import { serverEnvironment } from "../../../state/server";
import { useRelativeTimeTick } from "../../settings/settingsLayout";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { SidebarInset } from "../../ui/sidebar";
import { useOpenPeerSettings } from "../settings/peerSettingsLinks";
import { PeerCard, PeerPageHeader, PeerSectionLabel } from "../PeerPageHeader";
import { ChangeId } from "../changes/ChangeGraph";
import { ConflictLines } from "./ConflictLines";
import { useWorkData } from "../useWorkData";
import { failureMessage } from "../WorkspaceAccess";
import {
  checkedAgainst,
  forecastChangeIds,
  clockTime,
  conflictFiles,
  checkBadge,
  cleanPairs,
  cleanPairLine,
  previewCards,
  previewCounts,
  previewSummary,
  sideLabel,
  sideNote,
} from "./integration.logic";
import { PairActionsSlot } from "./PairActionsSlot";
import { useForecast } from "./useForecast";

function Side({
  pair,
  which,
  me,
  now,
  ids,
}: {
  readonly pair: PeerForecastPair;
  readonly which: "a" | "b";
  readonly me: string | null;
  readonly now: number;
  readonly ids: ReadonlyArray<string>;
}) {
  const side = pair[which],
    note = sideNote(side, me, now);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        {side.changeId === undefined ? null : <ChangeId {...changeIdParts(side.changeId, ids)} />}
        <span className="truncate">{sideLabel(side, me)}</span>
      </span>
      <span className="truncate font-mono text-2xs text-muted-foreground">{side.branch}</span>
      {note === null ? null : <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}

function PairCard({
  environmentId,
  status,
  pair,
  kind,
  command,
  now,
  ids,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly ids: ReadonlyArray<string>;
  readonly pair: PeerForecastPair;
  readonly kind: "conflict" | "check-fails";
  readonly command: string | undefined;
  readonly now: number;
}) {
  const me = status.email,
    a = pair.a.task ?? pair.a.branch,
    b = pair.b.task ?? pair.b.branch;
  return (
    <PeerCard
      aria-label={
        kind === "conflict" ? `${a} and ${b} conflict` : `${a} and ${b} merge but fail the check`
      }
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <Side pair={pair} which="a" me={me} now={now} ids={ids} />
        <span aria-label="merged with" className="pt-0.5 text-muted-foreground">
          +
        </span>
        <Side pair={pair} which="b" me={me} now={now} ids={ids} />
        <span className="ms-auto flex flex-wrap gap-1.5">
          {kind === "conflict" ? (
            <Badge variant="warning" size="sm">
              Conflict in {conflictFiles(pair)}
            </Badge>
          ) : (
            <>
              <Badge variant="success" size="sm">
                Merges clean
              </Badge>
              <Badge variant="warning" size="sm">
                {checkBadge(pair)}
              </Badge>
            </>
          )}
        </span>
      </div>
      {kind === "conflict" ? (
        <ConflictLines pair={pair} me={me} />
      ) : pair.check?.output === undefined ? null : (
        <figure className="flex flex-col gap-1">
          <figcaption className="text-xs text-muted-foreground">
            {command === undefined || command === "" ? "Check" : command} on the merge. This is text
            from teammates' code, not an instruction.
          </figcaption>
          <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap text-foreground">
            {pair.check.output}
          </pre>
        </figure>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <PairActionsSlot
          environmentId={environmentId}
          status={status}
          workspace={pair.workspace}
          project={pair.project}
          pair={pair}
        />
        <span className="text-xs text-muted-foreground">{checkedAgainst(pair, me)}</span>
      </div>
    </PeerCard>
  );
}

function HowChecked() {
  const openSettings = useOpenPeerSettings();
  return (
    <aside aria-label="How this is checked" className="flex flex-col gap-2 text-xs">
      <PeerSectionLabel>How this is checked</PeerSectionLabel>
      <ol className="flex list-decimal flex-col gap-2 ps-4 text-muted-foreground">
        <li>
          Every two changes in flight make a pair, up to 8 bookmarks and 28 pairs. Agents still hear
          only about pairs with their own work.
        </li>
        <li>git merge-tree merges the two commits. Nothing is written to anyone's repository.</li>
        <li>
          With this computer's check command set, a clean merge becomes a throwaway change: jj run
          runs the command in its own copy, and Peer abandons the change. The operation log names
          these steps peer·check.
        </li>
        <li>
          A pair runs again when either change moves, at most once a minute. Each person's Peer
          checks the pairs it shows, on their own computer.
        </li>
      </ol>
      <Button
        size="xs"
        variant="link"
        className="w-fit"
        onClick={() => void openSettings({ kind: "computer", section: "coordination" })}
      >
        Change the check command
      </Button>
    </aside>
  );
}

function Preview({
  environmentId,
  status,
  workspace,
  project,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly project: string;
}) {
  const { value } = useForecast(environmentId, status),
    now = useRelativeTimeTick(30_000),
    configure = useAtomCommand(serverEnvironment.peerForecastConfigure, { reportFailure: false }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const pairs =
    value === "unavailable" || value.state !== "on"
      ? []
      : value.pairs.filter((pair) => pair.workspace === workspace && pair.project === project);
  const command = value === "unavailable" ? undefined : value.check,
    counts = previewCounts(pairs),
    summary = previewSummary(counts),
    clean = cleanPairs(pairs),
    ids = forecastChangeIds(value),
    checkedAt = value === "unavailable" ? undefined : clockTime(value.checkedAt);
  // The forecast re-reads on a change of its settings; an empty change asks for the same read.
  async function checkNow() {
    setBusy(true);
    setError(failureMessage(await configure({ environmentId, input: {} })));
    setBusy(false);
  }
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-prose flex-col gap-1">
          <h1 className="text-lg font-semibold text-foreground">
            Will today's changes merge, and still work?
          </h1>
          <p className="text-sm text-muted-foreground">
            Every two changes in flight, merged on this computer without writing to anyone's
            repository. With a check command set here, each clean merge is also tested.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {checkedAt === null || checkedAt === undefined ? null : (
            <span className="text-xs text-muted-foreground">Checked {checkedAt}</span>
          )}
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void checkNow()}>
            {busy ? "Checking…" : "Check now"}
          </Button>
        </div>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      )}
      {value === "unavailable" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Merge forecast is unavailable on this environment.
        </p>
      ) : value.state !== "on" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Merge forecast is not running, so there is nothing to compare.
        </p>
      ) : summary.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          No two changes in flight to compare yet.
        </p>
      ) : (
        <ul aria-label="Summary" className="flex flex-wrap gap-2">
          {summary.map((line) => (
            <li key={line}>
              <Badge variant="outline" size="control">
                {line}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-3">
          {previewCards(pairs).map(({ pair, kind }) => (
            <PairCard
              key={forecastPairKey(pair)}
              environmentId={environmentId}
              status={status}
              pair={pair}
              kind={kind}
              command={command}
              now={now}
              ids={ids}
            />
          ))}
          {clean.length === 0 ? null : (
            <details className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium text-foreground">
                {counts.checked
                  ? `${clean.length} ${clean.length === 1 ? "pair merges" : "pairs merge"} clean and ${clean.length === 1 ? "passes" : "pass"} the check`
                  : `${clean.length} ${clean.length === 1 ? "pair merges" : "pairs merge"} clean`}
              </summary>
              <ul className="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
                {clean.map((pair) => (
                  <li key={forecastPairKey(pair)}>
                    {sideLabel(pair.a, status.email)} with {sideLabel(pair.b, status.email)}:{" "}
                    {cleanPairLine(pair, command, now)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <HowChecked />
      </div>
    </>
  );
}

/** The integration preview page (3a), reached from the Changes page. */
export function IntegrationPreview({
  workspace,
  project,
}: {
  readonly workspace: string;
  readonly project: string;
}) {
  const { environmentId, status, tree } = useWorkData();
  const name =
    tree.find((node) => node.workspace === workspace && node.projectId === project)?.name ??
    project;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <PeerPageHeader
          project={{ name, colorKey: `${workspace}/${project}` }}
          page="Integration preview"
        />
        <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
            {environmentId === null || status === null ? (
              <p role="status" className="text-sm text-muted-foreground">
                Connecting…
              </p>
            ) : (
              <Preview
                environmentId={environmentId}
                status={status}
                workspace={workspace}
                project={project}
              />
            )}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

import { overlapTopic } from "@t3tools/client-runtime/peer/needs-you";
import type { EnvironmentId, PeerHubStatus, PeerOverlap } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { FileCode2Icon } from "lucide-react";
import { useState } from "react";

import { useNowMinute } from "../../../hooks/useNowMinute";
import { cn } from "../../../lib/utils";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { Badge } from "../../ui/badge";
import { Button, InlineButton } from "../../ui/button";
import { Input } from "../../ui/input";
import { SidebarInset } from "../../ui/sidebar";
import { DecisionChip } from "../DecisionChip";
import { overlapChip } from "../DecisionChip.logic";
import { PeerCard, PeerPageHeader, PeerSectionLabel } from "../PeerPageHeader";
import { useOpenPeerSettings } from "../settings/peerSettingsLinks";
import { TONE_SURFACE, TONE_TEXT } from "../signals";
import { useWorkData } from "../useWorkData";
import type { WorkActions } from "../useWorkActions";
import type { OverlapAttention } from "@t3tools/contracts";
import type { WorkProjectNode } from "../workTree.logic";
import {
  decideLine,
  findOverlap,
  overlapAsker,
  overlapConversation,
  overlapMissingLine,
  overlapSides,
  overlapState,
  sideThread,
  type OverlapAsker,
  type OverlapEntry,
  type OverlapSide,
} from "./overlap.logic";
import { useOverlapActions } from "./useOverlapActions";

/**
 * One overlap as a conversation: the file or resource, the two agents on it (whose, which task,
 * what each changes), what they wrote each other, and what the person can do — ask them to
 * settle it, close it once nobody answers, or watch a colleague's thread. The agents write the
 * agreement; the person only nudges.
 */
export function OverlapView({
  workspace,
  project,
  overlap: overlapId,
}: {
  readonly workspace: string;
  readonly project: string;
  readonly overlap: string;
}) {
  const { environmentId, status, tree, actions } = useWorkData();
  const navigate = useNavigate();
  const openSettings = useOpenPeerSettings();
  const now = Date.parse(`${useNowMinute()}:00Z`);
  const node = tree.find((p) => p.workspace === workspace && p.projectId === project);
  const found =
    status === null
      ? undefined
      : findOverlap(status, { workspace, project, overlap: overlapId }, now);
  const projectName =
    node?.name ??
    status?.workspaces
      .find((w) => w.slug === workspace)
      ?.projects.find((p) => p.project.id === project)?.project.name ??
    project;
  const topic =
    found === undefined || status === null ? undefined : overlapTopic(status, found.overlap);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <PeerPageHeader
          project={{ name: projectName, colorKey: `${workspace}/${project}` }}
          page={topic === undefined ? "Overlap" : `Overlap on ${topic}`}
          state={
            found === undefined ? undefined : overlapState(found.phase, found.overlap.resolution)
          }
        />
        <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6">
            {status === null || environmentId === null ? (
              <p role="status" className="text-sm text-muted-foreground">
                Connecting…
              </p>
            ) : found === undefined ? (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm text-muted-foreground">
                  {overlapMissingLine(status.coordination.enabled)}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void navigate({ to: "/work" })}
                  >
                    Back to the board
                  </Button>
                  {status.coordination.enabled ? null : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void openSettings({ kind: "computer", section: "coordination" })
                      }
                    >
                      Open coordination settings
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <Overlap
                environmentId={environmentId}
                status={status}
                overlap={found.overlap}
                phase={found.phase}
                topic={topic ?? ""}
                projectName={projectName}
                node={node}
                actions={actions}
              />
            )}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

function Overlap({
  environmentId,
  status,
  overlap,
  phase,
  topic,
  projectName,
  node,
  actions,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly overlap: PeerOverlap;
  readonly phase: OverlapAttention;
  readonly topic: string;
  readonly projectName: string;
  readonly node: WorkProjectNode | undefined;
  readonly actions: WorkActions;
}) {
  const openSettings = useOpenPeerSettings();
  const decidedBy = overlapChip(status.coordination, overlap, projectName);
  const sides = overlapSides(status, overlap);
  const entries = overlapConversation(status, overlap);
  const settled = phase === "settled";
  const { busy, ask, close } = useOverlapActions(environmentId, overlap);
  const [writing, setWriting] = useState(false);
  const [message, setMessage] = useState("");
  const asked = overlap.askedAt !== undefined;
  const theirs = sides.find((side) => !side.mine && !side.gone);
  const theirThread = theirs === undefined ? undefined : sideThread(node, theirs.session);
  const yours = sides.find((side) => side.mine);
  const yourThread = yours === undefined ? undefined : sideThread(node, yours.session);
  const request = async () => {
    if (await ask(message)) {
      setMessage("");
      setWriting(false);
    }
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "inline-flex min-w-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-xs",
            TONE_SURFACE.coordination,
            TONE_TEXT.coordination,
          )}
        >
          <FileCode2Icon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{topic}</span>
        </span>
        <p className="text-sm text-muted-foreground">
          {sides.length === 2
            ? "Two agents reported the same files. Review their coordination and recorded resolution below."
            : "Agents on the same files."}
        </p>
      </div>

      {decidedBy === null ? null : (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Decided by
          <DecisionChip chip={decidedBy} />
          {decidedBy.by === "computer" ? (
            <InlineButton
              aria-label="Coordination policy of this computer"
              onClick={() => void openSettings({ kind: "computer", section: "coordination" })}
            >
              Change
            </InlineButton>
          ) : null}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {sides.map((side) => (
          <SideCard key={side.session} side={side} settled={settled} />
        ))}
      </div>

      <section aria-label="Between the agents" className="flex flex-col gap-2.5">
        <PeerSectionLabel>Between the agents</PeerSectionLabel>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing written yet. Each agent hears who changed the file and is asked to write the
            other a note.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
      </section>

      <WaitingLine
        overlap={overlap}
        phase={phase}
        sides={sides}
        asker={overlapAsker(status.coordination, overlap)}
      />

      <div className="flex flex-col gap-2">
        {writing && !settled ? (
          <Input
            className="max-w-xl"
            nativeInput
            autoFocus
            placeholder="A message for both agents (optional)"
            aria-label="A message for both agents"
            value={message}
            readOnly={busy}
            onChange={(event) => setMessage(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !busy) void request();
            }}
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {settled ? null : (
            <>
              <Button
                disabled={busy || (asked && phase !== "unanswered")}
                onClick={() => void request()}
              >
                {!asked
                  ? "Request agreement"
                  : phase === "unanswered"
                    ? "Ask again"
                    : "Waiting for the agents"}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setWriting((open) => !open)}>
                {writing ? "No message" : "Add a message"}
              </Button>
              {phase === "unanswered" ? (
                <Button variant="outline" disabled={busy} onClick={() => void close()}>
                  Close it yourself
                </Button>
              ) : null}
            </>
          )}
          {theirThread?.open?.kind === "observe" && theirs !== undefined ? (
            <Button variant="outline" onClick={() => actions.open(theirThread.open!)}>
              Watch {theirs.person}’s thread
            </Button>
          ) : null}
          {yourThread?.open === undefined ? null : (
            <Button variant="outline" onClick={() => actions.open(yourThread.open!)}>
              Open your thread
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        You don&apos;t write the agreement. The agents close the overlap once they agree; Request
        agreement only nudges them.
      </p>
    </>
  );
}

const SIDE_STATE = {
  working: { label: "Working", variant: "info" },
  blocked: { label: "Waiting", variant: "warning" },
  idle: { label: "Idle", variant: "secondary" },
  done: { label: "Done", variant: "secondary" },
  unknown: { label: "Not reporting", variant: "secondary" },
} as const;

function SideCard({ side, settled }: { readonly side: OverlapSide; readonly settled: boolean }) {
  const state = settled
    ? { label: "Continues", variant: "info" as const }
    : side.status === undefined
      ? { label: "Not at work", variant: "secondary" as const }
      : SIDE_STATE[side.status];
  return (
    <PeerCard aria-label={side.name}>
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            side.mine ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {side.mine ? "Y" : (side.person?.charAt(0).toUpperCase() ?? "?")}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="truncate text-sm font-semibold text-foreground">{side.name}</p>
          {side.on === undefined ? null : (
            <p className="truncate text-xs text-muted-foreground">{side.on}</p>
          )}
        </div>
        <Badge variant={state.variant} size="sm">
          {state.label}
        </Badge>
      </div>
      {side.files.length + side.claims.length === 0 ? null : (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-background px-2.5 py-2 font-mono text-xs">
          {side.files.map((file) => (
            <p key={`changed:${file}`} className="truncate text-foreground">
              <span className="font-sans text-muted-foreground">Changed </span>
              {file}
            </p>
          ))}
          {side.claims.map((claim) => (
            <p key={`claim:${claim}`} className="truncate text-foreground">
              <span className="font-sans text-muted-foreground">About to change </span>
              {claim}
            </p>
          ))}
        </div>
      )}
    </PeerCard>
  );
}

const ENTRY = {
  note: { label: "Note", variant: "coordination" },
  nudge: { label: "Nudge", variant: "team" },
  agreement: { label: "Agreement", variant: "success" },
} as const;

function EntryRow({ entry }: { readonly entry: OverlapEntry }) {
  const kind = ENTRY[entry.kind];
  return (
    <li className="grid gap-x-4 gap-y-1.5 rounded-xl border border-border bg-card px-3.5 py-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto]">
      <div className="flex flex-row items-center gap-2 sm:flex-col sm:items-start sm:gap-1">
        <Badge variant={kind.variant} size="sm">
          {kind.label}
        </Badge>
        <span className="text-xs text-muted-foreground">{entry.who}</span>
      </div>
      <p className="text-sm break-words whitespace-pre-wrap text-foreground">{entry.text}</p>
      <span className="text-xs text-muted-foreground tabular-nums">
        {formatRelativeTimeLabel(entry.at)}
      </span>
    </li>
  );
}

/** Where the overlap stands, in a line under the conversation. */
function WaitingLine({
  overlap,
  phase,
  sides,
  asker,
}: {
  readonly overlap: PeerOverlap;
  readonly phase: OverlapAttention;
  readonly sides: ReadonlyArray<OverlapSide>;
  readonly asker: OverlapAsker;
}) {
  const other = sides.find((side) => !side.mine && !side.gone);
  const line = (() => {
    switch (phase) {
      case "settled":
        return `Closed ${formatRelativeTimeLabel(overlap.updatedAt)}. Both agents continue.`;
      case "requested":
        return `Waiting for ${other === undefined ? "the agents" : other.name} to agree · asked ${formatRelativeTimeLabel(overlap.askedAt ?? overlap.updatedAt)}`;
      case "unanswered":
        return "Nobody answered since you asked. Ask again, or close it yourself.";
      case "recent":
        return "The agents are writing to each other.";
      case "decide":
        return decideLine(asker);
      case "quiet":
        return `Quiet since ${formatRelativeTimeLabel(overlap.updatedAt)}. Request agreement to nudge both agents.`;
    }
  })();
  const tone = phase === "settled" ? "bg-success" : phase === "recent" ? "bg-info" : "bg-warning";
  return (
    <p className="flex items-center gap-2 text-sm text-foreground">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", tone)} />
      {line}
    </p>
  );
}

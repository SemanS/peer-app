import {
  briefActionLabel,
  briefActions,
  briefDiff,
  briefStateText,
  type BriefAction,
} from "@t3tools/client-runtime/peer/openspec";
import type { EnvironmentId, PeerOpenSpecReadResult, PeerTaskBrief } from "@t3tools/contracts";
import { useState } from "react";

import { useAtomCommand } from "../../../state/use-atom-command";
import { serverEnvironment } from "../../../state/server";
import { Button } from "../../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { failureMessage } from "../WorkspaceAccess";
import { BriefEditor, type BriefDraft } from "./BriefEditor";

/** The saved brief an agent starts from when its change cannot be read. */
export function SavedBrief({ brief }: { readonly brief: PeerTaskBrief }) {
  const done = brief.checklist.filter((item) => item.done).length;
  return (
    <div className="flex min-w-0 max-w-prose flex-col gap-4">
      <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{brief.goal}</p>
      {brief.checklist.length === 0 ? null : (
        <section aria-label="Saved checklist" className="flex min-w-0 flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            Checklist · {done}/{brief.checklist.length} complete
          </h3>
          <ul className="flex flex-col gap-1 text-sm">
            {brief.checklist.map((item) => (
              <li key={item.text} className="[overflow-wrap:anywhere]">
                {item.done ? "☑" : "☐"} {item.text}
              </li>
            ))}
          </ul>
        </section>
      )}
      {brief.notes === undefined ? null : (
        <p className="whitespace-pre-line text-sm text-muted-foreground">{brief.notes}</p>
      )}
      <p className="text-xs text-muted-foreground">
        Saved by {brief.savedBy} on {brief.savedAt.slice(0, 10)}
        {brief.source === undefined ? "" : ` from ${brief.source.change}`}.
      </p>
    </div>
  );
}

/** How the task's brief stands against OpenSpec, and what a person can do about it. */
export function BriefPanel({
  environmentId,
  workspace,
  projectId,
  taskId,
  repositoryId,
  data,
  onChanged,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly repositoryId: string | undefined;
  readonly data: PeerOpenSpecReadResult;
  readonly onChanged: () => void;
}) {
  const link = useAtomCommand(serverEnvironment.peerOpenSpec.link, { reportFailure: false });
  const unlink = useAtomCommand(serverEnvironment.peerOpenSpec.unlink, { reportFailure: false });
  const saveBrief = useAtomCommand(serverEnvironment.peerOpenSpec.saveBrief, {
    reportFailure: false,
  });
  const updateTask = useAtomCommand(serverEnvironment.peerHubUpdateTask, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const state = data.link;
  if (state === undefined) return null;
  const brief = state.brief;
  const target = {
    workspace,
    projectId,
    taskId,
    expectedRevision: brief?.revision ?? 0,
  };
  const run = async (call: () => Promise<Parameters<typeof failureMessage>[0]>) => {
    setBusy(true);
    setError(null);
    const failure = failureMessage(await call());
    setBusy(false);
    if (failure !== null) setError(failure);
    else {
      setEditing(false);
      setChoosing(false);
    }
    onChanged();
  };
  const linkTo = (change: string | undefined) =>
    run(() =>
      link({
        environmentId,
        input: {
          ...target,
          ...(change === undefined ? {} : { change }),
          ...(repositoryId === undefined ? {} : { repositoryId }),
        },
      }),
    );
  const act = (action: BriefAction) => {
    switch (action.kind) {
      case "link":
      case "relink-mapped":
        return void linkTo(action.change);
      case "update":
        return void linkTo(undefined);
      case "relink":
        return setChoosing(true);
      case "keep":
      case "unlink":
        return void run(() => unlink({ environmentId, input: target }));
      case "close":
        return void run(() =>
          updateTask({ environmentId, input: { workspace, projectId, taskId, status: "done" } }),
        );
      case "edit":
      case "write":
        return setEditing(true);
    }
  };
  const save = (draft: BriefDraft) =>
    run(() =>
      saveBrief({
        environmentId,
        input: {
          ...target,
          goal: draft.goal,
          checklist: draft.checklist,
          ...(draft.notes === "" ? {} : { notes: draft.notes }),
        },
      }),
    );
  const text = briefStateText(state);
  const diff =
    state.state === "changed" && brief !== null && data.state === "ready" && data.snapshot
      ? briefDiff(brief, data.snapshot)
      : null;
  const actions = briefActions(state);
  const changes = (state.changes ?? []).filter((one) => one !== brief?.source?.change);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {text === null ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          {text}
        </p>
      )}
      {diff === null ? null : (
        <ul aria-label="What changed in OpenSpec" className="flex flex-col gap-1 text-sm">
          {diff.goalChanged ? <li>The goal changed.</li> : null}
          {diff.added.map((item) => (
            <li key={`+${item}`}>Added: {item}</li>
          ))}
          {diff.removed.map((item) => (
            <li key={`-${item}`}>Removed: {item}</li>
          ))}
          {diff.toggled.map((item) => (
            <li key={`~${item.text}`}>
              {item.done ? "Done" : "Reopened"}: {item.text}
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <BriefEditor
          brief={brief}
          busy={busy}
          onSave={(draft) => void save(draft)}
          onCancel={() => setEditing(false)}
        />
      ) : actions.length === 0 ? null : (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action.kind}
              variant={action === actions[0] ? "outline" : "ghost"}
              size="sm"
              disabled={busy}
              onClick={() => act(action)}
            >
              {briefActionLabel(action)}
            </Button>
          ))}
        </div>
      )}
      {choosing ? (
        changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            The repository has no other OpenSpec change to link.
          </p>
        ) : (
          <div className="w-72 max-w-full">
            <Select
              disabled={busy}
              onValueChange={(change) => {
                if (typeof change === "string") void linkTo(change);
              }}
            >
              <SelectTrigger size="sm" aria-label="Link another change">
                <SelectValue placeholder="Choose a change" />
              </SelectTrigger>
              <SelectPopup>
                {changes.map((change) => (
                  <SelectItem key={change} value={change}>
                    {change}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        )
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

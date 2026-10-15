/**
 * Adds or edits a webhook (design artboard 21). The destination URL and the signing key are stored
 * as secrets under names made from the webhook's id, which the webhook names and never holds; the
 * rest goes into the settings document's `webhooks.<id>` through the review, which is also where a
 * deletion is confirmed. While the review is open the form waits behind it, and comes back with
 * everything in it if the review is left; once the review saved, the dialog is done.
 */
import type { EnvironmentId, PeerWorkspaceState } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useId, useState } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "../../ui/dialog";
import { Input } from "../../ui/input";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { Toggle as PressToggle } from "../../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import {
  PeerDialogBody,
  PeerDialogFooter,
  PeerDialogMessage,
  PeerStackedField,
} from "../PeerDialog";
import { ProjectMark } from "../signals";
import { failureMessage } from "../WorkspaceAccess";
import { projectScopeKey } from "../workBoard.logic";
import { usePeerSettings } from "./PeerSettingsContext";
import { useReviewChanges } from "./useReviewChanges";
import { useSettingsView } from "./useSettingsView";
import { Destination, PayloadSample, Problem, Signing } from "./WebhookDialogParts";
import {
  DELETE_NOTE,
  EVENT_GROUPS,
  FORMATS,
  afterStoring,
  checkDraft,
  draftOf,
  formatCopy,
  groupOn,
  hookOf,
  idOf,
  newDraft,
  otherEventLabel,
  otherEvents,
  projectChoices,
  projectsAllNote,
  reviewScope,
  saveOperation,
  secretsToStore,
  titleOfId,
  withGroup,
  withoutEvent,
  type SavedHook,
  type WebhookDraft,
} from "./webhookForm.logic";

/**
 * The webhook's dialog. `editing` is the webhook as the document has it; without it the dialog adds
 * one. `takenIds` are the webhooks that exist, so a new one's id is not theirs and the twentieth is
 * the last. `onChanged` runs once a change was saved, to read the lists again.
 */
export function WebhookDialog({
  environmentId,
  workspace,
  editing,
  takenIds,
  onChanged,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
  readonly editing: { readonly id: string; readonly hook: SavedHook } | null;
  readonly takenIds: ReadonlySet<string>;
  readonly onChanged: () => void;
  readonly onClose: () => void;
}) {
  const { status } = usePeerSettings();
  const view = useSettingsView(workspace.slug);
  const secrets = useEnvironmentQuery(
    status.email === null
      ? null
      : serverEnvironment.peerSettings.secrets({
          environmentId,
          person: status.email,
          input: { workspace: workspace.slug },
        }),
  );
  const putSecret = useAtomCommand(serverEnvironment.peerSettings.putSecret, {
    reportFailure: false,
  });
  const fieldId = useId();
  const [draft, setDraft] = useState<WebhookDraft>(() =>
    editing === null ? newDraft() : draftOf(editing.id, editing.hook),
  );
  // The events the form has no checkbox for stay listed while the dialog is open, so one that is
  // unticked can be ticked again.
  const [extras] = useState(() => otherEvents(draft.events));
  const [storedNow, setStoredNow] = useState<ReadonlyArray<string>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // A save that changes only a secret (a replaced address or key) leaves the document as it was, so
  // its review finds nothing to save: Done ends the dialog like a saved change, and the lists are
  // read again, since the secret is already stored.
  const review = useReviewChanges({
    scope: "Webhooks",
    onSaved: () => setSaved(true),
    onNothingToSave: () => setSaved(true),
  });
  const reviewing = review.dialog !== null;

  const id = idOf(draft);
  const problems = checkDraft(draft, { takenIds });
  const stored = new Set([
    ...(secrets.data?.secrets ?? []).map((secret) => secret.name),
    ...storedNow,
  ]);
  const choices = projectChoices(
    view.document,
    workspace.projects.map(({ project }) => ({ id: project.id, name: project.name })),
  );
  const known = new Set(choices.map((choice) => choice.id));
  // A project the webhook names that the workspace no longer has stays a chip, so it can be unticked.
  const chips = [
    ...choices,
    ...(draft.projects ?? [])
      .filter((project) => !known.has(project))
      .map((project) => ({ id: project, name: project })),
  ];
  const generic = draft.format === "generic";
  const base = view.revision;
  const change = (next: Partial<WebhookDraft>) => setDraft((current) => ({ ...current, ...next }));

  // Once the review saved and is closed, the dialog is done.
  const finish = useEffectEvent(() => {
    onChanged();
    onClose();
  });
  useEffect(() => {
    if (saved && !reviewing) finish();
  }, [saved, reviewing]);

  const save = async () => {
    if (busy || !problems.ready || base === null) return;
    setBusy(true);
    setError(null);
    try {
      for (const secret of secretsToStore(draft)) {
        const result = await putSecret({
          environmentId,
          input: { workspace: workspace.slug, name: secret.name, value: secret.value },
        });
        const failure = failureMessage(result);
        if (failure !== null || result._tag !== "Success") {
          setError(`Could not store ${secret.name}${failure === null ? "" : `: ${failure}`}`);
          return;
        }
        setStoredNow((current) => [...current, secret.name]);
      }
      const next = afterStoring(draft);
      setDraft(next);
      secrets.refresh();
      review.open(saveOperation({ workspace: workspace.slug, base, id, hook: hookOf(next) }), {
        scope: reviewScope(id),
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (base === null) return;
    review.open(saveOperation({ workspace: workspace.slug, base, id, hook: null }), {
      scope: reviewScope(id),
      context: DELETE_NOTE,
    });
  };

  return (
    <>
      <Dialog
        open={!reviewing && !saved}
        onOpenChange={(next) => {
          if (!next && !busy) onClose();
        }}
      >
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <div className="pe-6">
              <DialogTitle>Webhook</DialogTitle>
            </div>
          </DialogHeader>
          <PeerDialogBody>
            <form
              id={`${fieldId}-form`}
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
                <PeerStackedField
                  label="Name"
                  htmlFor={`${fieldId}-name`}
                  hint={
                    editing !== null
                      ? `Id: ${id}. It can’t change.`
                      : id === ""
                        ? undefined
                        : `Id: ${id}`
                  }
                >
                  <Input
                    id={`${fieldId}-name`}
                    autoComplete="off"
                    autoFocus={editing === null}
                    disabled={editing !== null}
                    placeholder={formatCopy(draft.format).namePlaceholder}
                    aria-invalid={problems.name !== null}
                    value={editing === null ? draft.name : titleOfId(editing.id)}
                    onChange={(event) => change({ name: event.target.value })}
                  />
                </PeerStackedField>
                <ToggleGroup
                  aria-label="Format"
                  value={[draft.format]}
                  onValueChange={(next) => {
                    const format = next[0];
                    if (format !== undefined) change({ format });
                  }}
                >
                  {FORMATS.map((format) => (
                    <Toggle key={format.id} value={format.id}>
                      {format.label}
                    </Toggle>
                  ))}
                </ToggleGroup>
              </div>
              <Problem>{problems.name}</Problem>
              <Destination
                draft={draft}
                stored={stored}
                fieldId={`${fieldId}-url`}
                problem={problems.url}
                onChange={setDraft}
              />
              {generic ? (
                <>
                  <Signing
                    draft={draft}
                    stored={stored}
                    fieldId={`${fieldId}-key`}
                    problem={problems.signing}
                    onChange={setDraft}
                  />
                  <PayloadSample
                    workspace={{ slug: workspace.slug, name: workspace.name }}
                    actor={workspace.memberName}
                  />
                </>
              ) : null}
              <fieldset className="flex flex-col gap-1.5">
                <legend className="pb-1.5 text-sm font-medium text-foreground">Events</legend>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {EVENT_GROUPS.map((group) => (
                    <label
                      key={group.key}
                      className="flex h-7 cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={groupOn(draft.events, group)}
                        onCheckedChange={(on) =>
                          change({ events: withGroup(draft.events, group, on) })
                        }
                      />
                      {group.label}
                    </label>
                  ))}
                  {extras.map((event) => (
                    <label
                      key={event}
                      className="flex h-7 cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={draft.events.includes(event)}
                        onCheckedChange={(on) =>
                          change({
                            events: on
                              ? [...draft.events, event]
                              : withoutEvent(draft.events, event),
                          })
                        }
                      />
                      {otherEventLabel(event)}
                    </label>
                  ))}
                </div>
                <Problem>{problems.events}</Problem>
              </fieldset>
              <div className="flex flex-col gap-2">
                <span id={`${fieldId}-projects`} className="text-sm font-medium text-foreground">
                  Projects
                </span>
                <ToggleGroup
                  aria-labelledby={`${fieldId}-projects`}
                  value={[draft.projects === null ? "all" : "selected"]}
                  onValueChange={(next) => {
                    const mode = next[0];
                    if (mode === "all") change({ projects: null });
                    else if (mode === "selected" && draft.projects === null)
                      change({ projects: [] });
                  }}
                >
                  <Toggle value="all">Open to all</Toggle>
                  <Toggle value="selected">Only these</Toggle>
                </ToggleGroup>
                {draft.projects === null ? (
                  <p className="text-xs text-muted-foreground">{projectsAllNote(workspace.name)}</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {chips.map((chip) => {
                      const on = draft.projects?.includes(chip.id) === true;
                      return (
                        <PressToggle
                          key={chip.id}
                          variant="outline"
                          size="xs"
                          pressed={on}
                          onPressedChange={(next) =>
                            change({
                              projects: next
                                ? [...(draft.projects ?? []), chip.id]
                                : (draft.projects ?? []).filter((project) => project !== chip.id),
                            })
                          }
                        >
                          <ProjectMark
                            name={chip.name}
                            colorKey={projectScopeKey({
                              workspace: workspace.slug,
                              projectId: chip.id,
                            })}
                            className="size-4"
                          />
                          {chip.name}
                        </PressToggle>
                      );
                    })}
                  </div>
                )}
                <Problem>{problems.projects}</Problem>
              </div>
              <Problem>{problems.limit}</Problem>
              {base === null ? (
                <PeerDialogMessage>
                  {view.hubHasSettings
                    ? "Reading the settings…"
                    : "Webhooks can only be changed with a newer Peer Hub."}
                </PeerDialogMessage>
              ) : null}
              {error === null ? null : <PeerDialogMessage tone="error">{error}</PeerDialogMessage>}
            </form>
          </PeerDialogBody>
          <PeerDialogFooter
            secondary={
              editing === null ? undefined : (
                <>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => change({ enabled: !draft.enabled })}
                  >
                    {draft.enabled ? "Pause" : "Resume"}
                  </Button>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost-destructive"
                          disabled={busy || base === null}
                          onClick={remove}
                        />
                      }
                    >
                      Delete…
                    </TooltipTrigger>
                    <TooltipPopup side="top">{DELETE_NOTE}</TooltipPopup>
                  </Tooltip>
                </>
              )
            }
            note={
              editing !== null && !draft.enabled
                ? "Paused: it sends nothing until it is resumed and saved."
                : undefined
            }
          >
            <Button variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={`${fieldId}-form`}
              disabled={busy || !problems.ready || base === null}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </PeerDialogFooter>
        </DialogPopup>
      </Dialog>
      {review.dialog}
    </>
  );
}

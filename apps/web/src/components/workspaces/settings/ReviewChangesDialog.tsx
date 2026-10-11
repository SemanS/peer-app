import type {
  PeerSettingsConflict,
  PeerSettingsGatewayOutcome,
  PeerSettingsLine,
  PeerSettingsPreview,
  PeerSettingsSaved,
} from "@t3tools/contracts";
import { ArrowRightIcon } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";

import { useNowMinute } from "../../../hooks/useNowMinute";
import { cn } from "../../../lib/utils";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useAtomQueryRunner } from "../../../state/use-atom-query-runner";
import { Button } from "../../ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "../../ui/dialog";
import { Input } from "../../ui/input";
import { Radio, RadioGroup } from "../../ui/radio-group";
import { Spinner } from "../../ui/spinner";
import {
  PeerDialogBody,
  PeerDialogFooter,
  PeerDialogMessage,
  PeerStackedField,
} from "../PeerDialog";
import { PeerSectionLabel } from "../PeerPageHeader";
import { TONE_SURFACE, TONE_TEXT } from "../signals";
import { failureMessage } from "../WorkspaceAccess";
import { usePeerSettings } from "./PeerSettingsContext";
import {
  NO_SETTLE,
  WHY_MAX,
  agoText,
  appliesText,
  applySets,
  changeCall,
  checkNotes,
  conflictIntro,
  conflictKey,
  conflictTitle,
  defaultChoices,
  diagnosticAt,
  discardMine,
  gatewayNote,
  isNoop,
  latestTheirs,
  lineKeys,
  lineWhere,
  mergedNote,
  mergeSettle,
  noopText,
  otherChangeText,
  refusalText,
  reviewWords,
  saveLabel,
  savedTitle,
  settlement,
  stepFor,
  theirNames,
  theirOtherLines,
  untouchedCount,
  type Choice,
  type Note,
  type ReviewMode,
  type ReviewOperation,
  type SavedOutcome,
  type Settle,
  type Step,
} from "./reviewChanges.logic";
import { useChangeRunner, type ChangeOutcome } from "./useChangeRunner";
import { useSettingsView } from "./useSettingsView";

/** The title, with what the review is from on its right: "Review changes to Booking  from revision 41". */
function ReviewHeader({
  title,
  aside,
  description,
  mark,
}: {
  readonly title: string;
  readonly aside?: string | undefined;
  readonly description?: ReactNode;
  readonly mark?: ReactNode;
}) {
  return (
    <DialogHeader>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1 pe-6">
        {mark}
        <DialogTitle>{title}</DialogTitle>
        {aside === undefined ? null : (
          <span className="text-xs text-muted-foreground">{aside}</span>
        )}
      </div>
      {description === undefined ? null : <DialogDescription>{description}</DialogDescription>}
    </DialogHeader>
  );
}

/** What changes, one row each: what it is about, then `from → to` with the new value bold. */
function LinesTable({
  lines,
  scope,
}: {
  readonly lines: ReadonlyArray<PeerSettingsLine>;
  readonly scope: string;
}) {
  return (
    <ul
      aria-label="Changes"
      className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card text-sm"
    >
      {lineKeys(lines).map(({ key, line }) => (
        <li
          key={key}
          className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] items-baseline gap-3 px-3 py-2"
        >
          <span className="min-w-0 break-words text-muted-foreground">
            {lineWhere(line, scope)}
          </span>
          <span className="min-w-0 break-words">
            <span className="text-muted-foreground">{line.from}</span>{" "}
            <ArrowRightIcon aria-hidden className="inline size-3 text-muted-foreground/70" />{" "}
            <span className="font-semibold text-foreground">{line.to}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Warnings with an amber dot, notes with a blue one. */
function NoteList({ notes }: { readonly notes: ReadonlyArray<Note> }) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {notes.map((note) => (
        <li key={`${note.tone}|${note.text}`} className="flex items-start gap-2.5">
          <span
            aria-hidden
            className={cn(
              "mt-1.5 size-2 shrink-0 rounded-full",
              note.tone === "warning" ? "bg-warning" : "bg-info",
            )}
          />
          <span className="sr-only">{note.tone === "warning" ? "Warning: " : "Note: "}</span>
          <span className="min-w-0 text-foreground">{note.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** What this will do to the people the Hub counts and to the check's warnings, and when it applies. */
function ReviewBody({
  preview,
  scope,
  notes,
  kept,
}: {
  readonly preview: PeerSettingsPreview;
  readonly scope: string;
  readonly notes: ReadonlyArray<Note>;
  /** Whose changes "Discard mine" kept, when it left nothing to save. */
  readonly kept: ReadonlyArray<string>;
}) {
  const applies = appliesText(preview.applies);
  return (
    <>
      {isNoop(preview) ? (
        <PeerDialogMessage>{noopText(kept)}</PeerDialogMessage>
      ) : (
        <LinesTable lines={preview.lines} scope={scope} />
      )}
      {notes.length === 0 ? null : (
        <section className="flex flex-col gap-2">
          <PeerSectionLabel>Before you save</PeerSectionLabel>
          <NoteList notes={notes} />
        </section>
      )}
      {applies === "" || isNoop(preview) ? null : (
        <section className="flex flex-col gap-1.5">
          <PeerSectionLabel>When it applies</PeerSectionLabel>
          <p className="text-sm text-muted-foreground">{applies}</p>
        </section>
      )}
    </>
  );
}

/** What else the revisions I conflict with changed, which stays: read once the conflict is on screen. */
function useTheirOtherChanges(workspace: string, conflicts: ReadonlyArray<PeerSettingsConflict>) {
  const { environmentId, status } = usePeerSettings();
  const read = useAtomQueryRunner(serverEnvironment.peerSettings.historyEntry, {
    reportFailure: false,
  });
  const [lines, setLines] = useState<ReadonlyArray<PeerSettingsLine>>([]);
  useEffect(() => {
    let current = true;
    const person = status.email;
    if (person === null) return undefined;
    const seqs = [...new Set(conflicts.map(({ theirsSeq }) => theirsSeq))];
    void Promise.all(
      seqs.map((seq) => read({ environmentId, person, input: { workspace, seq } })),
    ).then((results) => {
      if (!current) return;
      const revisions = results.flatMap((result) =>
        result._tag === "Success" ? [result.value] : [],
      );
      setLines(theirOtherLines(revisions, conflicts));
    });
    return () => {
      current = false;
    };
  }, [conflicts, environmentId, read, status.email, workspace]);
  return lines;
}

function ConflictBody({
  workspace,
  kind,
  scope,
  preview,
  choices,
  busy,
  onChoose,
  nameOf,
}: {
  readonly workspace: string;
  readonly kind: ReviewOperation["kind"];
  readonly scope: string;
  readonly preview: PeerSettingsPreview;
  readonly choices: Readonly<Record<string, Choice>>;
  readonly busy: boolean;
  readonly onChoose: (key: string, choice: Choice) => void;
  readonly nameOf: (person: { readonly email: string; readonly name: string }) => string;
}) {
  const { conflicts } = preview;
  const names = theirNames(conflicts, nameOf);
  const theirOther = useTheirOtherChanges(workspace, conflicts);
  const other = otherChangeText(names, theirOther);
  const words = reviewWords(kind);
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {conflictIntro({
          kind,
          base: preview.base,
          head: preview.head.seq,
          scope,
          names,
          untouched: untouchedCount(preview.lines, conflicts),
          conflicts: conflicts.length,
        })}
      </p>
      {conflicts.map((conflict) => {
        const key = conflictKey(conflict.path);
        const owner = nameOf(conflict.theirsBy);
        return (
          <fieldset
            key={key}
            disabled={busy}
            className={cn("flex min-w-0 flex-col gap-2 rounded-lg border p-3", TONE_SURFACE.needs)}
          >
            <legend className={cn("px-1.5 text-sm", TONE_TEXT.needs)}>{conflict.label}</legend>
            <RadioGroup
              aria-label={conflict.label}
              value={choices[key] ?? "mine"}
              onValueChange={(value) => onChoose(key, value === "theirs" ? "theirs" : "mine")}
            >
              <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                <Radio value="mine" />
                <span>
                  {words.mine}: <span className="font-semibold">{conflict.mineText}</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                <Radio value="theirs" />
                <span>
                  {owner}’s: <span className="font-semibold">{conflict.theirsText}</span>
                </span>
              </label>
            </RadioGroup>
          </fieldset>
        );
      })}
      {other === null ? null : <p className="text-xs text-muted-foreground">{other}</p>}
    </>
  );
}

/** The gateway did not take a save: why, and a way to try again now. */
function GatewayFailed({
  error,
  retrying,
  onRetry,
}: {
  readonly error: string;
  readonly retrying: boolean;
  readonly onRetry: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-2 rounded-xl border px-3.5 py-3",
        TONE_SURFACE.needs,
      )}
    >
      <p className={cn("text-sm font-semibold", TONE_TEXT.needs)}>Gateway sync failed: {error}</p>
      <p className="text-sm text-foreground">
        Your changes are saved in Peer, but the gateway still has the old limits until a sync
        succeeds.
      </p>
      <Button size="sm" variant="warning-outline" disabled={retrying} onClick={onRetry}>
        {retrying ? "Retrying…" : "Retry now"}
      </Button>
    </div>
  );
}

function SavedBody({
  saved,
  gateway,
  retrying,
  onRetry,
}: {
  readonly saved: PeerSettingsSaved;
  readonly gateway: PeerSettingsGatewayOutcome | undefined;
  readonly retrying: boolean;
  readonly onRetry: () => void;
}) {
  const applies = appliesText(saved.applies);
  const note = gatewayNote(gateway);
  return (
    <>
      {applies === "" ? null : <p className="text-sm text-foreground">{applies}</p>}
      {note?.kind === "failed" ? (
        <GatewayFailed error={note.error} retrying={retrying} onRetry={onRetry} />
      ) : note?.kind === "ok" ? (
        <p className="text-sm text-muted-foreground">The gateway is up to date.</p>
      ) : null}
      {saved.audit === undefined ? null : (
        <section className="flex flex-col gap-1">
          <PeerSectionLabel>In the audit log</PeerSectionLabel>
          <p className="text-sm text-muted-foreground">{saved.audit}</p>
        </section>
      )}
    </>
  );
}

/**
 * The review of a change before it is saved (design artboard 03): what it changes, what to know
 * before saving, when it applies and a reason for the history. It asks the Hub first, as a dry run,
 * and shows what comes back: the changes, a conflict with what someone saved meanwhile, the paths
 * that are not the person's to change, or a configuration that does not check. Saving shows what
 * the Hub did. Mount it when a review starts: each mounting is a fresh review.
 */
export function ReviewChangesDialog({
  operation,
  scope,
  context,
  onSaved,
  onNothingToSave,
  onClose,
}: {
  readonly operation: ReviewOperation;
  /** What the changes are to, in the title: "Booking". */
  readonly scope: string;
  /** Under the title: who proposed the changes, which revision they revert. */
  readonly context?: ReactNode;
  /** The Hub saved the changes; the page drops its draft here. */
  readonly onSaved?: ((saved: PeerSettingsSaved, outcome: SavedOutcome) => void) | undefined;
  /** The review found nothing to save and the person is done; the page drops its draft here. */
  readonly onNothingToSave?: (() => void) | undefined;
  /** Back to editing, or Done once it is saved. */
  readonly onClose: () => void;
}) {
  const { environmentId } = usePeerSettings();
  const view = useSettingsView(operation.workspace);
  const run = useChangeRunner();
  const sync = useAtomCommand(serverEnvironment.peerSettings.gatewaySync, {
    reportFailure: false,
  });
  const formId = useId();
  const [step, setStep] = useState<Step>({ kind: "previewing" });
  const [message, setMessage] = useState("");
  const [settle, setSettle] = useState<Settle>(NO_SETTLE);
  // Whose changes "Discard mine" kept: what a review that is left with nothing says.
  const [kept, setKept] = useState<ReadonlyArray<string>>([]);
  const [choices, setChoices] = useState<Readonly<Record<string, Choice>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gateway, setGateway] = useState<PeerSettingsGatewayOutcome | undefined>(undefined);
  const [retrying, setRetrying] = useState(false);
  // The minute the review last looked at the clock, for "2 minutes ago" in the conflict view.
  const now = Date.parse(`${useNowMinute()}:00Z`);

  const words = reviewWords(operation.kind);
  const show = (outcome: ChangeOutcome, mode: ReviewMode, used: Settle) => {
    setBusy(false);
    if (!outcome.ok) {
      // A dry run that fails leaves nothing to show; a save that fails leaves the review it came from.
      if (mode === "preview") setStep({ kind: "failed", message: outcome.message });
      else setError(outcome.message);
      return;
    }
    const next = stepFor(outcome.result);
    if (next.kind === "conflict") setChoices(defaultChoices(next.preview.conflicts));
    if (next.kind === "saved") {
      setGateway(next.saved.gateway);
      onSaved?.(next.saved, { dropped: used.drop.length > 0 });
    }
    setStep(next);
  };
  const check = (nextSettle: Settle) => {
    setStep({ kind: "previewing" });
    setError(null);
    void run(changeCall(operation, "preview", { message, settle: nextSettle })).then((outcome) =>
      show(outcome, "preview", nextSettle),
    );
  };
  /** Saves with what was decided so far and what is decided now: a second round keeps the first's. */
  const save = (decided: Settle) => {
    const nextSettle = mergeSettle(settle, decided);
    setBusy(true);
    setError(null);
    setSettle(nextSettle);
    void run(changeCall(operation, "save", { message, settle: nextSettle })).then((outcome) =>
      show(outcome, "save", nextSettle),
    );
  };
  useEffect(() => {
    let current = true;
    void run(changeCall(operation, "preview", { message: "", settle: NO_SETTLE })).then(
      (outcome) => {
        if (current) show(outcome, "preview", NO_SETTLE);
      },
    );
    return () => {
      current = false;
    };
    // A review asks the Hub once, when it opens; every later ask is the person's own action.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, []);

  const retryGateway = () => {
    setRetrying(true);
    void sync({ environmentId, input: { workspace: operation.workspace } })
      .then((result) => {
        if (result._tag === "Success") {
          setGateway(
            result.value.ok
              ? { ok: true }
              : { error: result.value.error ?? "the gateway did not answer" },
          );
        } else {
          setGateway({ error: failureMessage(result) ?? "the request was interrupted" });
        }
      })
      .finally(() => setRetrying(false));
  };

  const close = () => {
    if (!busy) onClose();
  };
  const document =
    view.document === null
      ? null
      : operation.kind === "save"
        ? applySets(view.document, operation.set)
        : view.document;
  const toolContext = { document, workspacePeople: view.people.length };

  const body = (() => {
    switch (step.kind) {
      case "previewing":
        return (
          <>
            <ReviewHeader title={`Review changes to ${scope}`} description={context} />
            <PeerDialogBody>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner size="sm" />
                Checking what this changes…
              </p>
            </PeerDialogBody>
            <PeerDialogFooter>
              <Button variant="outline" onClick={close}>
                {words.back}
              </Button>
            </PeerDialogFooter>
          </>
        );
      case "review": {
        const { preview } = step;
        const merged = isNoop(preview)
          ? null
          : mergedNote(preview, { name: view.nameOf(preview.head.by), now });
        return (
          <>
            <ReviewHeader
              title={`Review changes to ${scope}`}
              aside={`from revision ${preview.base}`}
              description={context}
            />
            <PeerDialogBody>
              <form
                id={formId}
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!busy && !isNoop(preview)) save(settle);
                }}
              >
                <ReviewBody
                  preview={preview}
                  scope={scope}
                  kept={kept}
                  notes={[
                    ...(merged === null ? [] : [merged]),
                    ...checkNotes(preview, toolContext),
                  ]}
                />
                {isNoop(preview) || !words.why ? null : (
                  <PeerStackedField label="Why" htmlFor={`${formId}-why`}>
                    <Input
                      id={`${formId}-why`}
                      maxLength={WHY_MAX}
                      placeholder="Why? It goes into the history"
                      value={message}
                      disabled={busy}
                      onChange={(event) => setMessage(event.target.value)}
                    />
                  </PeerStackedField>
                )}
                {error === null ? null : (
                  <PeerDialogMessage tone="error">{error}</PeerDialogMessage>
                )}
              </form>
            </PeerDialogBody>
            <PeerDialogFooter>
              <Button variant="outline" disabled={busy} onClick={close}>
                {words.back}
              </Button>
              {isNoop(preview) ? (
                <Button
                  onClick={() => {
                    onNothingToSave?.();
                    onClose();
                  }}
                >
                  Done
                </Button>
              ) : (
                <Button type="submit" form={formId} disabled={busy}>
                  {busy ? "Saving…" : saveLabel(preview.lines.length)}
                </Button>
              )}
            </PeerDialogFooter>
          </>
        );
      }
      case "conflict": {
        const { preview } = step;
        const names = theirNames(preview.conflicts, view.nameOf);
        return (
          <>
            <ReviewHeader
              title={conflictTitle(names, scope, agoText(latestTheirs(preview.conflicts), now))}
              description={context}
            />
            <PeerDialogBody>
              <ConflictBody
                workspace={operation.workspace}
                kind={operation.kind}
                scope={scope}
                preview={preview}
                choices={choices}
                busy={busy}
                nameOf={view.nameOf}
                onChoose={(key, choice) => setChoices((current) => ({ ...current, [key]: choice }))}
              />
              {error === null ? null : <PeerDialogMessage tone="error">{error}</PeerDialogMessage>}
            </PeerDialogBody>
            <PeerDialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  const next = mergeSettle(settle, discardMine(preview.conflicts));
                  setSettle(next);
                  setKept(theirNames(preview.conflicts, view.nameOf));
                  check(next);
                }}
              >
                {words.discard}
              </Button>
              <Button disabled={busy} onClick={() => save(settlement(preview.conflicts, choices))}>
                {busy ? "Saving…" : `Save on top of revision ${preview.head.seq}`}
              </Button>
            </PeerDialogFooter>
          </>
        );
      }
      case "forbidden":
        return (
          <>
            <ReviewHeader title="Some of this is not yours to change" description={context} />
            <PeerDialogBody>
              <ul className="flex flex-col gap-2 text-sm">
                {step.refused.map((refusal) => (
                  <li key={refusal.path.join("/")}>{refusalText(refusal)}</li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">{words.forbidden}</p>
            </PeerDialogBody>
            <PeerDialogFooter>
              <Button variant="outline" onClick={onClose}>
                {words.back}
              </Button>
            </PeerDialogFooter>
          </>
        );
      case "invalid":
        return (
          <>
            <ReviewHeader title="These changes do not check out" description={context} />
            <PeerDialogBody>
              <p className="text-sm text-muted-foreground">
                Peer checked the settings they would make and found a problem:
              </p>
              <ul className="flex flex-col gap-2 text-sm">
                {step.diagnostics.map((diagnostic) => (
                  <li
                    key={`${diagnostic.at}|${diagnostic.message}`}
                    className="flex flex-col gap-0.5"
                  >
                    <span className="text-foreground">{diagnostic.message}</span>
                    {diagnosticAt(diagnostic) === null ? null : (
                      <span className="font-mono text-xs text-muted-foreground">
                        {diagnosticAt(diagnostic)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </PeerDialogBody>
            <PeerDialogFooter>
              <Button variant="outline" onClick={onClose}>
                {words.back}
              </Button>
            </PeerDialogFooter>
          </>
        );
      case "saved":
        return (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2.5 pe-6">
                <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-success" />
                <DialogTitle>{savedTitle(step.saved)}</DialogTitle>
              </div>
            </DialogHeader>
            <PeerDialogBody>
              <SavedBody
                saved={step.saved}
                gateway={gateway}
                retrying={retrying}
                onRetry={retryGateway}
              />
            </PeerDialogBody>
            <PeerDialogFooter>
              <Button onClick={onClose}>Done</Button>
            </PeerDialogFooter>
          </>
        );
      case "failed":
        return (
          <>
            <ReviewHeader title={`Review changes to ${scope}`} description={context} />
            <PeerDialogBody>
              <PeerDialogMessage tone="error">{step.message}</PeerDialogMessage>
            </PeerDialogBody>
            <PeerDialogFooter>
              <Button variant="outline" onClick={onClose}>
                {words.back}
              </Button>
              <Button onClick={() => check(settle)}>Try again</Button>
            </PeerDialogFooter>
          </>
        );
    }
  })();

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogPopup className="max-w-xl">{body}</DialogPopup>
    </Dialog>
  );
}

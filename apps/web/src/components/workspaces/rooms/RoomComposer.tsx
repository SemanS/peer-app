import {
  anchorText,
  type RoomPlace,
  type RoomTargetChoice,
} from "@t3tools/client-runtime/peer/rooms";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { BotIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { randomUUID } from "../../../lib/utils";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { Textarea } from "../../ui/textarea";
import { isCommentSubmitShortcut } from "../../diffs/commentSubmitShortcut";
import { failureMessage } from "../WorkspaceAccess";
import {
  canSend,
  chosenKeys,
  draftAfter,
  draftIdentity,
  draftProblem,
  insertMention,
  matchPeople,
  mentionAt,
  operationFor,
  ownAgentNote,
  recipientsOf,
  ROOM_TEXT_MAX,
  sendNotice,
  toggleChoice,
  type RoomDraft,
  type RoomPerson,
  type SendOutcome,
} from "./room.logic";

/**
 * The room's composer: the To row, the text, and the anchor a selected line gave it. A draft leaves
 * only when the Hub confirms the post; anything else keeps it, with the same operation, so sending
 * it again adds nothing twice.
 */
export function RoomComposer({
  environmentId,
  place,
  choices,
  people,
  hasOwnRun,
  draft,
  onDraftChange,
  onSent,
}: {
  readonly environmentId: EnvironmentId;
  readonly place: RoomPlace;
  readonly choices: ReadonlyArray<RoomTargetChoice>;
  readonly people: ReadonlyArray<RoomPerson>;
  readonly hasOwnRun: boolean;
  readonly draft: RoomDraft;
  readonly onDraftChange: (draft: RoomDraft) => void;
  readonly onSent: () => void;
}) {
  const post = useAtomCommand(serverEnvironment.peerRooms.post, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);

  // A line chosen in the diff opens the composer on it, ready for the words.
  const line = draft.anchor === undefined ? undefined : anchorText(draft.anchor);
  useEffect(() => {
    if (line !== undefined) input.current?.focus();
  }, [line]);

  const recipients = recipientsOf(choices, draft.selected);
  const chosen = chosenKeys(draft);
  const problem = draftProblem(draft.text, recipients.blocked);
  const disabledChoices = choices.filter((choice) => choice.disabled !== undefined);
  const notes = [
    ...(draft.selected.includes("own-agent") && recipients.blocked === null
      ? [ownAgentNote(hasOwnRun)]
      : []),
    ...recipients.notes,
  ];

  const mention = mentionAt(draft.text, caret);
  const matches = mention === null ? [] : matchPeople(people, mention.query);
  const offered = matches[Math.min(picked, matches.length - 1)];

  const send = async () => {
    if (busy || !canSend(draft.text, recipients.blocked)) return;
    const operation = operationFor(
      draft.operation,
      draftIdentity(draft, recipients.to),
      randomUUID,
    );
    const attempt: RoomDraft = { ...draft, operation };
    onDraftChange(attempt);
    setBusy(true);
    setNotice(null);
    const result = await post({
      environmentId,
      input: {
        ...place,
        op: operation.id,
        text: draft.text.trim(),
        to: recipients.to,
        ...(draft.anchor === undefined ? {} : { anchor: draft.anchor }),
      },
    });
    setBusy(false);
    const outcome: SendOutcome =
      result._tag === "Success"
        ? { kind: "sent" }
        : isAtomCommandInterrupted(result)
          ? { kind: "unknown" }
          : { kind: "failed", reason: failureMessage(result) ?? "the Hub did not take it." };
    onDraftChange(draftAfter(attempt, outcome));
    setNotice(sendNotice(outcome));
    if (outcome.kind === "sent") onSent();
    input.current?.focus();
  };

  const choosePerson = (person: RoomPerson) => {
    if (mention === null) return;
    const next = insertMention(draft.text, mention, person.label, caret);
    onDraftChange({
      ...draft,
      text: next.text,
      selected: draft.selected.includes(person.key)
        ? draft.selected
        : [...draft.selected, person.key],
    });
    setCaret(next.caret);
    setPicked(0);
    requestAnimationFrame(() => input.current?.setSelectionRange(next.caret, next.caret));
  };

  return (
    <form
      aria-label="New message"
      className="flex max-h-[55dvh] shrink-0 flex-col gap-2.5 overflow-y-auto border-t border-border bg-background px-4 py-3 sm:px-6"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div role="group" aria-label="To" className="flex flex-wrap items-center gap-1">
        <span className="me-1 text-xs text-muted-foreground">To</span>
        {choices.map((choice) => (
          <Button
            key={choice.key}
            type="button"
            size="compact"
            variant={chosen.includes(choice.key) ? "outline" : "ghost-muted"}
            aria-pressed={chosen.includes(choice.key)}
            disabled={choice.disabled !== undefined}
            onClick={() =>
              onDraftChange({ ...draft, selected: toggleChoice(draft.selected, choice) })
            }
          >
            {choice.kind === "own-agent" || choice.kind === "agent" ? (
              <BotIcon aria-hidden />
            ) : null}
            {choice.label}
          </Button>
        ))}
      </div>
      {disabledChoices.map((choice) => (
        <p key={choice.key} className="text-xs text-muted-foreground">
          {choice.label}: {choice.disabled}
        </p>
      ))}
      {draft.anchor === undefined ? null : (
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span>On</span>
          <span className="min-w-0 truncate font-mono text-foreground/80">
            {anchorText(draft.anchor)}
          </span>
          <Button
            type="button"
            size="icon-micro"
            variant="ghost-muted"
            aria-label="Remove the line"
            onClick={() => {
              const { anchor: _anchor, ...rest } = draft;
              onDraftChange(rest);
            }}
          >
            <XIcon aria-hidden />
          </Button>
        </p>
      )}
      {matches.length === 0 ? null : (
        <ul aria-label="People" className="flex flex-col">
          {matches.map((person) => (
            <li key={person.key}>
              <button
                type="button"
                className={
                  "flex w-full min-w-0 items-baseline gap-2 rounded-sm px-2 py-1 text-start text-sm text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" +
                  (person === offered ? " bg-accent" : "")
                }
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choosePerson(person)}
              >
                <span className="min-w-0 truncate">{person.label}</span>
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {person.email}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Textarea
        ref={input}
        aria-label="Message"
        placeholder="Write to the room. @ names a person."
        value={draft.text}
        readOnly={busy}
        onChange={(event) => {
          onDraftChange({ ...draft, text: event.target.value });
          setCaret(event.target.selectionStart);
          setPicked(0);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (offered !== undefined && (event.key === "Enter" || event.key === "Tab")) {
            event.preventDefault();
            choosePerson(offered);
            return;
          }
          if (matches.length > 0 && event.key === "ArrowDown") {
            event.preventDefault();
            setPicked((index) => (index + 1) % matches.length);
            return;
          }
          if (matches.length > 0 && event.key === "ArrowUp") {
            event.preventDefault();
            setPicked((index) => (index - 1 + matches.length) % matches.length);
            return;
          }
          if (isCommentSubmitShortcut(event, draft.text, busy)) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-[1_1_12rem] flex-col gap-0.5">
          {notes.map((note) => (
            <p key={note} className="text-xs text-muted-foreground">
              {note}
            </p>
          ))}
          {problem === null ? null : (
            <p role="status" className="text-xs text-warning-foreground">
              {problem}
            </p>
          )}
          {notice === null ? null : (
            <p role="alert" className="text-xs text-warning-foreground">
              {notice}
            </p>
          )}
        </div>
        {draft.text.length > ROOM_TEXT_MAX - 200 ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {draft.text.length} / {ROOM_TEXT_MAX}
          </span>
        ) : null}
        <Button type="submit" size="sm" disabled={busy || !canSend(draft.text, recipients.blocked)}>
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}

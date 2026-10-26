import type { PeerBriefChecklistItem, PeerTaskBrief } from "@t3tools/contracts";
import { useState } from "react";

import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { Textarea } from "../../ui/textarea";

export interface BriefDraft {
  readonly goal: string;
  readonly checklist: ReadonlyArray<PeerBriefChecklistItem>;
  readonly notes: string;
}

const itemsOf = (text: string, before: ReadonlyArray<PeerBriefChecklistItem>) => {
  const done = new Map(before.map((item) => [item.text, item.done]));
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(0, 200)
    .map((line) => ({ text: line.slice(0, 500), done: done.get(line) ?? false }));
};

/** A task's own brief: its goal, one checklist item per line, and notes. */
export function BriefEditor({
  brief,
  busy,
  onSave,
  onCancel,
}: {
  readonly brief: PeerTaskBrief | null;
  readonly busy: boolean;
  readonly onSave: (draft: BriefDraft) => void;
  readonly onCancel: () => void;
}) {
  const [goal, setGoal] = useState(brief?.goal ?? "");
  const [lines, setLines] = useState((brief?.checklist ?? []).map((item) => item.text).join("\n"));
  const [done, setDone] = useState<ReadonlyArray<PeerBriefChecklistItem>>(brief?.checklist ?? []);
  const [notes, setNotes] = useState(brief?.notes ?? "");
  const checklist = itemsOf(lines, done);
  return (
    <form
      aria-label="Edit brief"
      className="flex min-w-0 max-w-prose flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ goal: goal.trim(), checklist, notes: notes.trim() });
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Goal
        <Textarea
          value={goal}
          maxLength={4_000}
          onChange={(event) => setGoal(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Checklist, one item per line
        <Textarea value={lines} onChange={(event) => setLines(event.target.value)} />
      </label>
      {checklist.length === 0 ? null : (
        <ul aria-label="Checklist items" className="flex flex-col gap-1.5">
          {checklist.map((item) => (
            <li key={item.text} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={item.done}
                aria-label={`Done: ${item.text}`}
                onCheckedChange={(checked) =>
                  setDone([
                    ...done.filter((one) => one.text !== item.text),
                    { text: item.text, done: checked === true },
                  ])
                }
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">{item.text}</span>
            </li>
          ))}
        </ul>
      )}
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Notes
        <Textarea
          value={notes}
          maxLength={8_000}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy || goal.trim() === ""}>
          Save brief
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

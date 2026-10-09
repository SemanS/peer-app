import { useState } from "react";
import { MegaphoneIcon } from "lucide-react";
import {
  announcementCharacterCount,
  announcementDraftError,
  announcementReach,
  announcementReachLine,
  editAnnouncementDraft,
  newAnnouncementDraft,
  type AnnouncementDraft,
} from "@t3tools/client-runtime/peer/announcements";
import type { ProjectSlotProps } from "../slots.types";
import { Button } from "../../ui/button";
import { Textarea } from "../../ui/textarea";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription } from "../../ui/dialog";
import { useAtomCommand } from "../../../state/use-atom-command";
import { randomUUID } from "../../../lib/utils";
import { failureMessage } from "../WorkspaceAccess";
import { announcementAtoms } from "./atoms";
import { AnnouncementList } from "./AnnouncementList";
export function NotifyAgentsDialog(props: ProjectSlotProps) {
  const [open, setOpen] = useState(false);
  if (props.status.announcements?.unsupported.includes(props.project.workspace)) return null;
  return (
    <>
      <Button
        size="icon-xs"
        variant="ghost-muted"
        aria-label={`Notify agents on ${props.project.name}`}
        onClick={() => setOpen(true)}
      >
        <MegaphoneIcon className="size-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Notify agents</DialogTitle>
            <DialogDescription>
              {props.project.name}. Share information that applies until withdrawn or expired.
            </DialogDescription>
          </DialogHeader>
          {open ? <NotifyAgentsForm {...props} /> : null}
        </DialogPopup>
      </Dialog>
    </>
  );
}
function NotifyAgentsForm({ environmentId, status, project }: ProjectSlotProps) {
  const [draft, setDraft] = useState(() => newAnnouncementDraft(randomUUID()));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [posted, setPosted] = useState<string | undefined>();
  const post = useAtomCommand(announcementAtoms.post, { reportFailure: false });
  const edit = (patch: Partial<AnnouncementDraft>) => {
    setDraft((d) => editAnnouncementDraft(d, patch, randomUUID()));
    setMessage(null);
  };
  const reach = announcementReach(
    (status.coordination?.sessions ?? []).filter((s) => s.workspace === project.workspace),
    project.projectId,
    draft.task,
  );
  async function send() {
    const invalid = announcementDraftError(draft);
    if (invalid) {
      setMessage(invalid);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await post({
        environmentId,
        input: { workspace: project.workspace, project: project.projectId, ...draft },
      });
      const failure = failureMessage(result);
      setMessage(failure ?? "Announcement posted. Agents hear it at their next step.");
      if (result._tag === "Success") {
        setPosted(result.value.id);
        setDraft(newAnnouncementDraft(randomUUID()));
        setMessage(`Posted “${result.value.text}”. Agents hear it at their next step.`);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-4 pt-4">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void send();
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          Message
          <Textarea
            required
            value={draft.text}
            disabled={busy}
            onChange={(e) => edit({ text: e.target.value })}
          />
          <span>{announcementCharacterCount(draft.text)}/300 characters</span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Applies to
          <select
            value={draft.task ?? ""}
            disabled={busy}
            onChange={(e) => edit({ task: e.target.value || undefined })}
          >
            <option value="">Whole project</option>
            {project.tasks
              .filter((t) => t.status !== "done")
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Valid for
          <select
            value={draft.validForMinutes}
            disabled={busy}
            onChange={(e) => edit({ validForMinutes: Number(e.target.value) })}
          >
            <option value={60}>1 hour</option>
            <option value={240}>4 hours</option>
            <option value={1440}>24 hours</option>
            <option value={4320}>3 days</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.wake}
            disabled={busy}
            onChange={(e) => edit({ wake: e.target.checked })}
          />
          Wake idle agents
        </label>
        <p className="text-sm text-muted-foreground">{announcementReachLine(reach)}</p>
        <div>
          <Button type="submit" disabled={busy || announcementDraftError(draft) !== null}>
            {busy ? "Posting…" : "Notify agents"}
          </Button>
        </div>
        {message ? (
          <p role="status" className="text-sm">
            {message}
          </p>
        ) : null}
      </form>
      <AnnouncementList
        environmentId={environmentId}
        status={status}
        workspace={project.workspace}
        project={project.projectId}
        refreshKey={posted}
        recent
      />
    </div>
  );
}

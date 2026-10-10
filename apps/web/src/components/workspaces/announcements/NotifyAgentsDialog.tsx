import { useId, useState } from "react";
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
import { Checkbox } from "../../ui/checkbox";
import { Dialog, DialogClose, DialogPopup } from "../../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Textarea } from "../../ui/textarea";
import { useAtomCommand } from "../../../state/use-atom-command";
import { randomUUID } from "../../../lib/utils";
import { failureMessage } from "../WorkspaceAccess";
import {
  PeerDialogBody,
  PeerDialogFooter,
  PeerDialogHeader,
  PeerDialogMessage,
  PeerStackedField,
} from "../PeerDialog";
import { ProjectMark } from "../signals";
import { projectScopeKey } from "../workBoard.logic";
import { announcementAtoms } from "./atoms";
import { AnnouncementList } from "./AnnouncementList";

const WHOLE_PROJECT = "project";

const VALID_FOR = [
  { value: "60", label: "1 hour" },
  { value: "240", label: "4 hours" },
  { value: "1440", label: "24 hours" },
  { value: "4320", label: "3 days" },
];

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
        <DialogPopup className="max-w-xl">
          <PeerDialogHeader
            icon={MegaphoneIcon}
            tone="team"
            title="Notify agents"
            context={
              <>
                <ProjectMark
                  name={props.project.name}
                  colorKey={projectScopeKey(props.project)}
                  className="size-3.5"
                />
                <span className="text-foreground/80">{props.project.name}</span>
                <span aria-hidden>·</span>
                <span>Every live agent hears it once, until it is withdrawn or expires.</span>
              </>
            }
          />
          {open ? <NotifyAgentsForm {...props} /> : null}
        </DialogPopup>
      </Dialog>
    </>
  );
}

function NotifyAgentsForm({ environmentId, status, project }: ProjectSlotProps) {
  const formId = useId();
  const [draft, setDraft] = useState(() => newAnnouncementDraft(randomUUID()));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ readonly text: string; readonly failed: boolean }>();
  const [posted, setPosted] = useState<string | undefined>();
  const post = useAtomCommand(announcementAtoms.post, { reportFailure: false });
  const edit = (patch: Partial<AnnouncementDraft>) => {
    setDraft((d) => editAnnouncementDraft(d, patch, randomUUID()));
    setMessage(undefined);
  };
  const reach = announcementReach(
    (status.coordination?.sessions ?? []).filter((s) => s.workspace === project.workspace),
    project.projectId,
    draft.task,
  );
  const tasks = project.tasks.filter((t) => t.status !== "done");
  const appliesTo = [
    { value: WHOLE_PROJECT, label: "Whole project" },
    ...tasks.map((t) => ({
      value: t.id,
      label: t.key === undefined ? t.title : `${t.key} · ${t.title}`,
    })),
  ];
  const characters = announcementCharacterCount(draft.text);
  async function send() {
    const invalid = announcementDraftError(draft);
    if (invalid) {
      setMessage({ text: invalid, failed: true });
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await post({
        environmentId,
        input: { workspace: project.workspace, project: project.projectId, ...draft },
      });
      const failure = failureMessage(result);
      if (failure !== null) setMessage({ text: failure, failed: true });
      if (result._tag === "Success") {
        setPosted(result.value.id);
        setDraft(newAnnouncementDraft(randomUUID()));
        setMessage({
          text: `Posted “${result.value.text}”. Agents hear it at their next step.`,
          failed: false,
        });
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PeerDialogBody>
        <form
          id={formId}
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void send();
          }}
        >
          <PeerStackedField label="Message" htmlFor={`${formId}-text`} aside={`${characters}/300`}>
            <Textarea
              id={`${formId}-text`}
              required
              autoFocus
              value={draft.text}
              disabled={busy}
              placeholder="For example: main is red, don't merge until the fix lands."
              aria-invalid={characters > 300 || undefined}
              onChange={(e) => edit({ text: e.target.value })}
            />
          </PeerStackedField>
          <div className="grid gap-4 sm:grid-cols-2">
            <PeerStackedField label="Applies to" htmlFor={`${formId}-task`}>
              <Select
                value={draft.task ?? WHOLE_PROJECT}
                items={appliesTo}
                disabled={busy}
                onValueChange={(value) =>
                  edit({ task: value === null || value === WHOLE_PROJECT ? undefined : value })
                }
              >
                <SelectTrigger id={`${formId}-task`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {appliesTo.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </PeerStackedField>
            <PeerStackedField label="Valid for" htmlFor={`${formId}-valid`}>
              <Select
                value={String(draft.validForMinutes)}
                items={VALID_FOR}
                disabled={busy}
                onValueChange={(value) => {
                  if (value !== null) edit({ validForMinutes: Number(value) });
                }}
              >
                <SelectTrigger id={`${formId}-valid`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {VALID_FOR.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </PeerStackedField>
          </div>
          <label className="flex items-start gap-2.5">
            <Checkbox
              checked={draft.wake}
              disabled={busy}
              onCheckedChange={(checked) => edit({ wake: checked })}
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm text-foreground">Wake idle agents</span>
              <span className="text-xs text-muted-foreground">
                Idle agents hear it now instead of at their next step.
              </span>
            </span>
          </label>
          {message === undefined ? null : (
            <PeerDialogMessage tone={message.failed ? "error" : "neutral"}>
              {message.text}
            </PeerDialogMessage>
          )}
        </form>
        <AnnouncementList
          environmentId={environmentId}
          status={status}
          workspace={project.workspace}
          project={project.projectId}
          refreshKey={posted}
          recent
        />
      </PeerDialogBody>
      <PeerDialogFooter note={announcementReachLine(reach)}>
        <DialogClose render={<Button variant="ghost" />}>Close</DialogClose>
        <Button
          type="submit"
          form={formId}
          disabled={busy || announcementDraftError(draft) !== null}
        >
          {busy ? "Posting…" : "Notify agents"}
        </Button>
      </PeerDialogFooter>
    </>
  );
}

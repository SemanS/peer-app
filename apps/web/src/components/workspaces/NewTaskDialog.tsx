import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  CheckIcon,
  LayersIcon,
  LinkIcon,
  ListPlusIcon,
  MessageSquarePlusIcon,
  PlusIcon,
} from "lucide-react";
import { useId, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../ui/combobox";
import { Dialog, DialogPopup } from "../ui/dialog";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import {
  areaChoices,
  canCreate,
  createTaskInput,
  issueKey,
  issueKeyProblem,
  oneLine,
  TASK_TITLE_MAX,
  titleCount,
} from "./newTask.logic";
import {
  PeerDialogBody,
  PeerDialogFooter,
  PeerDialogHeader,
  PeerDialogMessage,
} from "./PeerDialog";
import { ProjectMark } from "./signals";
import { useWorkActions } from "./useWorkActions";
import { issueKeyHint, type PeerVcsKind } from "./vcsWords";
import { projectScopeKey } from "./workBoard.logic";
import type { WorkProjectNode } from "./workTree.logic";
import { failureMessage } from "./WorkspaceAccess";

/** The picker's row for no area, and the prefix of the row that names a new one. */
const NO_AREA = "\u0000no-area";
const NEW_AREA = "\u0000new-area:";

/**
 * Capturing a task the way a modern tracker does: one line for what needs doing, and the rest as
 * quiet chips under it (the area, a tracker issue it links) that stay out of the way until wanted.
 * Enter creates it; "Create more" keeps the composer open for the next one, and "Create and start
 * chat" opens a chat on the new task straight away where the project is open on this computer.
 */
export function NewTaskDialog({
  environmentId,
  project,
  t3ProjectId,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly project: WorkProjectNode;
  /** The project's repository as it is open on this computer; a chat needs it. */
  readonly t3ProjectId: ProjectId | undefined;
  readonly onClose: () => void;
}) {
  const createTask = useAtomCommand(serverEnvironment.peerHubCreateTask, { reportFailure: false });
  const actions = useWorkActions(environmentId);
  const navigate = useNavigate();
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState("");
  const [area, setArea] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const creating = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const scope = { workspace: project.workspace, projectId: project.projectId };
  const areas = project.areas.flatMap((node) => (node.name === null ? [] : [node.name]));
  const draft = { title, area, key };
  const ready = !busy && canCreate(draft);
  const count = titleCount(title);

  const openTask = (task: string) =>
    void navigate({
      to: "/task/$workspace/$project/$task",
      params: { workspace: scope.workspace, project: scope.projectId, task },
    });

  const create = async (startChat: boolean) => {
    if (!ready || creating.current) return;
    creating.current = true;
    setBusy(true);
    setError(null);
    const input = createTaskInput(scope, draft);
    const result = await createTask({ environmentId, input });
    setBusy(false);
    creating.current = false;
    const failure = failureMessage(result);
    if (failure !== null) {
      setError(failure);
      return;
    }
    if (result._tag !== "Success") return;
    const task = result.value.createdTask?.id;
    if (startChat && task !== undefined && t3ProjectId !== undefined) {
      onClose();
      void actions.startThread(scope, task, t3ProjectId);
      return;
    }
    toastManager.add({
      type: "success",
      title: "Task created",
      description:
        task === undefined
          ? `${input.title}. Open it from Tasks; this environment did not return the new task’s identity.`
          : input.title,
      ...(task === undefined
        ? {}
        : { actionProps: { children: "Open", onClick: () => openTask(task) } }),
    });
    if (!more) {
      onClose();
      return;
    }
    setTitle("");
    setKey("");
    setCreated(input.title);
    titleRef.current?.focus();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogPopup>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void create(false);
          }}
        >
          <PeerDialogHeader
            icon={ListPlusIcon}
            title="New task"
            context={
              <>
                <ProjectMark
                  name={project.name}
                  colorKey={projectScopeKey(project)}
                  className="size-4"
                />
                <span className="truncate">{project.name}</span>
              </>
            }
          />
          <PeerDialogBody>
            <div className="flex flex-col gap-3">
              <textarea
                ref={titleRef}
                autoFocus
                rows={1}
                maxLength={TASK_TITLE_MAX}
                aria-label="What needs doing"
                placeholder="What needs doing?"
                className="field-sizing-content min-h-9 w-full resize-none bg-transparent text-lg font-medium leading-snug text-foreground outline-none placeholder:text-muted-foreground/70"
                value={title}
                readOnly={busy}
                onChange={(event) => {
                  setTitle(oneLine(event.currentTarget.value));
                  setCreated(null);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  void create(false);
                }}
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <AreaChip areas={areas} value={area} disabled={busy} onChange={setArea} />
                <IssueChip
                  value={key}
                  kind={project.vcs ?? "git"}
                  disabled={busy}
                  onChange={setKey}
                />
                {count === null ? null : (
                  <span className="ms-auto text-xs tabular-nums text-muted-foreground">
                    {count}
                  </span>
                )}
              </div>
              {error !== null ? (
                <PeerDialogMessage tone="error">{error}</PeerDialogMessage>
              ) : created !== null ? (
                <PeerDialogMessage>{`Created “${created}”. Name the next one.`}</PeerDialogMessage>
              ) : null}
            </div>
          </PeerDialogBody>
          <PeerDialogFooter
            note={
              t3ProjectId === undefined
                ? undefined
                : "Enter creates only the task. Starting work is a separate choice."
            }
            secondary={
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Switch size="sm" checked={more} onCheckedChange={setMore} />
                Create more
              </label>
            }
          >
            {t3ProjectId === undefined ? null : (
              <Button
                type="button"
                variant="outline"
                disabled={!ready}
                onClick={() => void create(true)}
              >
                <MessageSquarePlusIcon aria-hidden />
                Create and start chat
              </Button>
            )}
            <Button type="submit" disabled={!ready}>
              {busy ? "Creating…" : "Create task"}
            </Button>
          </PeerDialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** The area as a chip: it lists the project's areas, finds one by name, or names a new one. */
function AreaChip({
  areas,
  value,
  disabled,
  onChange,
}: {
  readonly areas: ReadonlyArray<string>;
  readonly value: string | null;
  readonly disabled: boolean;
  readonly onChange: (area: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { matches, create } = areaChoices(areas, query);
  const items = [NO_AREA, ...matches, ...(create === null ? [] : [`${NEW_AREA}${create}`])];
  return (
    <Combobox
      items={items}
      filteredItems={items}
      filter={null}
      autoHighlight
      disabled={disabled}
      value={value ?? NO_AREA}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery("");
      }}
      onValueChange={(next) => {
        if (typeof next !== "string") return;
        onChange(
          next === NO_AREA ? null : next.startsWith(NEW_AREA) ? next.slice(NEW_AREA.length) : next,
        );
        setOpen(false);
      }}
    >
      <ComboboxTrigger
        aria-label={value === null ? "Area" : `Area: ${value}`}
        render={<Button type="button" variant="outline" size="xs" />}
      >
        <LayersIcon aria-hidden />
        <span className={cn("max-w-48 truncate", value === null && "text-muted-foreground")}>
          {value ?? "Area"}
        </span>
      </ComboboxTrigger>
      <ComboboxPopup align="start" className="flex w-72 flex-col">
        <ComboboxSearchInput
          aria-label="Find or name an area"
          placeholder="Find or name an area"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxList className="max-h-64">
          {items.map((item, index) => (
            <ComboboxItem key={item} hideIndicator index={index} value={item}>
              {item === NO_AREA ? (
                <span className="flex-1 text-muted-foreground">No area</span>
              ) : item.startsWith(NEW_AREA) ? (
                <>
                  <PlusIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{`New area “${item.slice(NEW_AREA.length)}”`}</span>
                </>
              ) : (
                <span className="flex-1 truncate">{item}</span>
              )}
              {(value ?? NO_AREA) === item ? (
                <CheckIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              ) : null}
            </ComboboxItem>
          ))}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

/**
 * A tracker issue the task stands for, as a chip. Optional: a key such as KRK-812 names the task
 * after the issue, and a chat whose branch or title names the key joins the task on its own.
 */
function IssueChip({
  value,
  kind,
  disabled,
  onChange,
}: {
  readonly value: string;
  /** The project's version control here, for the word a chat's ref goes by. */
  readonly kind: PeerVcsKind;
  readonly disabled: boolean;
  readonly onChange: (key: string) => void;
}) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const problem = issueKeyProblem(draft);
  const link = () => {
    if (problem !== null) return;
    onChange(issueKey(draft));
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(value);
      }}
    >
      <PopoverTrigger
        aria-label={value === "" ? "Link an issue" : `Linked issue: ${value}`}
        render={<Button type="button" variant="outline" size="xs" disabled={disabled} />}
      >
        <LinkIcon aria-hidden />
        <span className={cn("font-mono", value === "" && "font-sans text-muted-foreground")}>
          {value === "" ? "Link issue" : value}
        </span>
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="start" width="md">
        <div className="flex flex-col gap-2.5">
          <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
            Issue key
          </label>
          <Input
            id={fieldId}
            nativeInput
            size="sm"
            font="mono"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="KRK-812"
            aria-invalid={problem !== null}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              // The composer's own form is the dialog's: Enter here links the key and creates nothing.
              event.preventDefault();
              event.stopPropagation();
              link();
            }}
          />
          <p
            className={cn(
              "text-xs",
              problem === null ? "text-muted-foreground" : "text-destructive-foreground",
            )}
          >
            {problem ?? issueKeyHint(kind)}
          </p>
          <div className="flex justify-end gap-1.5">
            {value === "" ? null : (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                Remove
              </Button>
            )}
            <Button
              type="button"
              size="xs"
              disabled={problem !== null || issueKey(draft) === ""}
              onClick={link}
            >
              Link
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

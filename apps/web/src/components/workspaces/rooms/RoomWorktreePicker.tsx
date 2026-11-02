import type { PeerRoomDiff } from "@t3tools/contracts";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "../../ui/button";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../../ui/select";

const TASK_CHECKOUT = "task-checkout";

export function RoomWorktreePicker({
  projectName,
  diff,
  selected,
  onSelect,
  onRefresh,
}: {
  readonly projectName: string;
  readonly diff: PeerRoomDiff | null;
  readonly selected: string | undefined;
  readonly onSelect: (path: string | undefined) => void;
  readonly onRefresh: () => void;
}) {
  const worktrees = diff?.worktrees ?? [];
  const current = worktrees.find((entry) => entry.path === selected);
  return (
    <div className="flex min-w-0 shrink-0 flex-col gap-1 border-b border-border/60 px-3 py-1.5">
      <div className="flex min-w-0 items-center gap-1">
        <div className="min-w-0 flex-1">
          <Select
            value={selected ?? TASK_CHECKOUT}
            onValueChange={(value) => {
              if (value !== null) onSelect(value === TASK_CHECKOUT ? undefined : value);
            }}
          >
            <SelectTrigger
              className="w-full min-w-0"
              size="compact"
              variant="ghost"
              aria-label={`${projectName} worktree`}
            >
              <SelectValue>
                {selected === undefined
                  ? "Task checkout"
                  : (current?.name ?? "Unavailable worktree")}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup matchTriggerWidth={false}>
              <SelectItem value={TASK_CHECKOUT}>Task checkout</SelectItem>
              {selected !== undefined && current === undefined ? (
                <SelectItem value={selected} disabled>
                  Unavailable worktree
                </SelectItem>
              ) : null}
              {worktrees.map((entry) => (
                <SelectItem key={entry.path} value={entry.path}>
                  <span className="flex min-w-0 flex-col">
                    <span>{entry.name}</span>
                    <span className="max-w-[min(36rem,80vw)] truncate font-mono text-xs text-muted-foreground">
                      {entry.path}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Refresh worktrees"
          title="Refresh worktrees"
          onClick={onRefresh}
        >
          <RefreshCwIcon aria-hidden />
        </Button>
      </div>
      {diff?.worktreesError === undefined ? null : (
        <p role="status" className="text-xs text-muted-foreground">
          {diff.worktreesError}
        </p>
      )}
    </div>
  );
}

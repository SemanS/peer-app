import type { PeerAgentEntry, PeerAgentView } from "@t3tools/contracts";
import {
  BotIcon,
  FileTextIcon,
  GlobeIcon,
  ListChecksIcon,
  PencilIcon,
  SearchIcon,
  SquareTerminalIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { useLayoutEffect, useRef } from "react";

import { cn } from "../../lib/utils";
import ChatMarkdown from "../ChatMarkdown";

const TOOL_ICON: Readonly<Record<string, LucideIcon>> = {
  Bash: SquareTerminalIcon,
  Read: FileTextIcon,
  Edit: PencilIcon,
  MultiEdit: PencilIcon,
  Write: PencilIcon,
  NotebookEdit: PencilIcon,
  Grep: SearchIcon,
  Glob: SearchIcon,
  WebFetch: GlobeIcon,
  WebSearch: GlobeIcon,
  Task: BotIcon,
  Agent: BotIcon,
  TodoWrite: ListChecksIcon,
};

/**
 * The agent's steps, following the newest unless the reader scrolled back. herdr's agent page and
 * Observe's page of a colleague's thread both show an agent this way.
 */
export function AgentTimeline({
  view,
  goneText = "This agent no longer runs in herdr.",
}: {
  readonly view: PeerAgentView | undefined;
  /** What to say when the work is gone. */
  readonly goneText?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  // Each new view of the agent scrolls to its newest step, unless the reader scrolled back.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (view === undefined || element === null || !following.current) return;
    element.scrollTop = element.scrollHeight;
  }, [view]);
  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(event) => {
        const element = event.currentTarget;
        following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
      }}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-6">
        {view === undefined ? (
          <p className="text-sm text-muted-foreground">Connecting…</p>
        ) : view.gone ? (
          <p className="text-sm text-muted-foreground">{goneText}</p>
        ) : view.entries !== undefined ? (
          view.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            view.entries.map((entry) => <AgentStep key={entry.id} entry={entry} cwd={view.cwd} />)
          )
        ) : (
          <>
            {view.hint === undefined ? null : (
              <p className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
                {view.hint}
              </p>
            )}
            <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground wrap-break-word">
              {view.terminal ?? ""}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

function AgentStep({
  entry,
  cwd,
}: {
  readonly entry: PeerAgentEntry;
  readonly cwd: string | undefined;
}) {
  if (entry.kind === "prompt") {
    return (
      <div className="max-w-xl self-end rounded-2xl bg-secondary px-3.5 py-2 text-sm whitespace-pre-wrap text-secondary-foreground">
        {entry.text}
      </div>
    );
  }
  if (entry.kind === "text") return <ChatMarkdown text={entry.text} cwd={cwd} />;
  const Icon = TOOL_ICON[entry.name] ?? WrenchIcon;
  return (
    <div className="flex min-w-0 items-start gap-2 text-xs">
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-3.5 shrink-0",
          entry.failed ? "text-destructive" : "text-muted-foreground",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-foreground", entry.name === "Bash" && "font-mono")}>
          {entry.summary}
        </p>
        {entry.result === undefined ? null : (
          <p
            className={cn("truncate", entry.failed ? "text-destructive" : "text-muted-foreground")}
          >
            {entry.result}
          </p>
        )}
      </div>
    </div>
  );
}

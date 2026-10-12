/**
 * The second line of a Chats row: `‹task key› · ‹project› · ‹agent›`, then `started 14:02` where
 * another chat has the same title. At the sidebar's default width the line does not always fit;
 * the project gives way first, because the monogram on the left already stands for it, and the
 * task, the agent and the start time stay whole. What the parts are is decided in
 * `Sidebar.chats.logic.ts`.
 */
import type { ChatMetaPart, ChatMetaPartKind } from "../Sidebar.chats.logic";

// Each part keeps the space of its leading " · " (`whitespace-pre`, which `truncate` would
// override), so a part that shrinks to nothing takes its separator with it.
const PART_CLASS_NAME: Readonly<Record<ChatMetaPartKind, string>> = {
  project: "min-w-0 overflow-hidden text-ellipsis whitespace-pre",
  task: "max-w-[45%] shrink-0 overflow-hidden text-ellipsis whitespace-pre",
  agent: "max-w-[40%] shrink-0 overflow-hidden text-ellipsis whitespace-pre",
  started: "shrink-0 whitespace-pre",
  when: "shrink-0 whitespace-pre",
};

export function ChatMetaLine({ parts }: { readonly parts: ReadonlyArray<ChatMetaPart> }) {
  return (
    <span aria-hidden className="flex min-w-0 flex-1 items-center overflow-hidden">
      {parts.map((part, index) => (
        <span key={part.kind} className={PART_CLASS_NAME[part.kind]}>
          {index === 0 ? part.text : ` · ${part.text}`}
        </span>
      ))}
    </span>
  );
}

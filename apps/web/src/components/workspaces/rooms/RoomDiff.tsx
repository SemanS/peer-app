import type {
  CodeViewDiffItem,
  CodeViewItem,
  DiffLineAnnotation,
  SelectedLineRange,
} from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import type { NameOf } from "@t3tools/client-runtime/peer/rooms";
import type { PeerRoomAnchor, PeerRoomDiff, PeerRoomMessage } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { useTheme } from "~/hooks/useTheme";
import {
  buildFileDiffContentVersion,
  buildFileDiffIdentityKey,
  fnv1a32,
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { Button } from "../../ui/button";
import { StyledDiffCodeView } from "../../diffs/StyledDiffCodeView";
import type { WorkOpen } from "../workTree.logic";
import { authorOf } from "./room.logic";
import {
  anchorFromSelection,
  diffSourceText,
  pathAnchor,
  placeAnchors,
  type ApartAnchor,
  viewerSide,
} from "./roomDiff.logic";

interface RoomAnnotation {
  readonly messages: ReadonlyArray<PeerRoomMessage>;
}

/** An anchor to bring into view; a new `ask` brings the same line back. */
export interface DiffFocus {
  readonly anchor: PeerRoomAnchor;
  readonly ask: number;
}

/**
 * The task's diff, from git on this computer, with anchored messages at their lines. A line's
 * gutter button or a selection starts a message on it; the composer takes it from there.
 */
export function RoomDiff({
  diff,
  error,
  onRefresh,
  messages,
  drafting,
  focus,
  me,
  nameOf,
  watch,
  onWatch,
  onComment,
  onOpenMessage,
}: {
  readonly diff: PeerRoomDiff | null;
  readonly error: string | null;
  /** Reads it again: nothing else does while the person stays on the page. */
  readonly onRefresh: () => void;
  readonly messages: ReadonlyArray<PeerRoomMessage>;
  /** A line is in the composer's draft, so its selection stays lit. */
  readonly drafting: boolean;
  readonly focus: DiffFocus | null;
  readonly me: string;
  readonly nameOf: NameOf;
  /** A colleague's shared thread to watch where the work is not here. */
  readonly watch: WorkOpen | undefined;
  readonly onWatch: (open: WorkOpen) => void;
  readonly onComment: (anchor: PeerRoomAnchor) => void;
  readonly onOpenMessage: (seq: number) => void;
}) {
  if (diff === null) {
    return (
      <div className="flex flex-col items-start gap-2 px-4 py-5 sm:px-6">
        <p role={error === null ? "status" : "alert"} className="text-sm text-muted-foreground">
          {error ?? "Reading the diff on this computer…"}
        </p>
        {error === null ? null : (
          <Button size="sm" variant="outline" onClick={onRefresh}>
            Try again
          </Button>
        )}
      </div>
    );
  }
  if (diff.state === "notHere") {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-5 sm:px-6">
        <p className="text-sm text-foreground">{diff.reason}</p>
        <div className="flex flex-wrap gap-2">
          {watch === undefined ? null : (
            <Button size="sm" variant="outline" onClick={() => onWatch(watch)}>
              Watch
            </Button>
          )}
          <Button size="sm" variant="ghost-muted" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
        {diff.files.length === 0 ? null : (
          <ul
            aria-label="Files the Hub knows"
            className="flex flex-col divide-y divide-border/60 border-y border-border/60"
          >
            {diff.files.map((path) => (
              <li key={path} className="flex min-h-9 min-w-0 items-center gap-2 py-1">
                <span className="min-w-0 flex-1 font-mono text-xs [overflow-wrap:anywhere] text-foreground">
                  {path}
                </span>
                <Button
                  size="compact"
                  variant="ghost-muted"
                  onClick={() => onComment(pathAnchor(path))}
                >
                  Comment
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    <DiffHere
      key={diff.base}
      diff={diff}
      messages={messages}
      drafting={drafting}
      focus={focus}
      me={me}
      nameOf={nameOf}
      onRefresh={onRefresh}
      onComment={onComment}
      onOpenMessage={onOpenMessage}
    />
  );
}

function DiffHere({
  diff,
  messages,
  drafting,
  focus,
  me,
  nameOf,
  onRefresh,
  onComment,
  onOpenMessage,
}: {
  readonly diff: Extract<PeerRoomDiff, { state: "here" }>;
  readonly messages: ReadonlyArray<PeerRoomMessage>;
  readonly drafting: boolean;
  readonly focus: DiffFocus | null;
  readonly me: string;
  readonly nameOf: NameOf;
  readonly onRefresh: () => void;
  readonly onComment: (anchor: PeerRoomAnchor) => void;
  readonly onOpenMessage: (seq: number) => void;
}) {
  const { resolvedTheme } = useTheme();
  const viewer = useRef<CodeViewHandle<RoomAnnotation, undefined>>(null);
  const [selected, setSelected] = useState<{
    readonly id: string;
    readonly range: SelectedLineRange;
  } | null>(null);
  const parsed = getRenderablePatch(diff.patch, "room-diff");
  const files = parsed?.kind === "files" ? parsed.files : [];
  const lines = files.map((file) => ({ path: resolveFileDiffPath(file), hunks: file.hunks }));
  const { pinned, apart } = placeAnchors(messages, lines, diff.head);
  const items: CodeViewDiffItem<RoomAnnotation>[] = files.map((fileDiff) => {
    const path = resolveFileDiffPath(fileDiff);
    const annotations: DiffLineAnnotation<RoomAnnotation>[] = pinned
      .filter((line) => line.path === path)
      .map((line) => ({
        side: line.side,
        lineNumber: line.lineNumber,
        metadata: { messages: line.messages },
      }));
    return {
      id: buildFileDiffIdentityKey(fileDiff),
      type: "diff",
      fileDiff,
      annotations,
      version: fnv1a32(
        `${buildFileDiffContentVersion(fileDiff)}:${annotations
          .flatMap((annotation) => annotation.metadata.messages.map((row) => row.seq))
          .join(",")}`,
      ),
    };
  });

  const itemIdOf = (path: string) => {
    const file = files.find((candidate) => resolveFileDiffPath(candidate) === path);
    return file === undefined ? undefined : buildFileDiffIdentityKey(file);
  };
  const focusAsk = focus?.ask;
  const focusItem = focus === null ? undefined : itemIdOf(focus.anchor.path);
  const focusLine = focus === null ? undefined : (focus.anchor.endLine ?? focus.anchor.line);
  const focusSide = focus === null ? undefined : viewerSide(focus.anchor.side);
  useEffect(() => {
    if (focusAsk === undefined || focusItem === undefined || focusLine === undefined) return;
    viewer.current?.scrollTo({
      type: "line",
      id: focusItem,
      lineNumber: focusLine,
      ...(focusSide === undefined ? {} : { side: focusSide }),
      align: "center",
    });
  }, [focusAsk, focusItem, focusLine, focusSide]);

  const beginComment = (
    range: SelectedLineRange | null,
    context: { readonly item: CodeViewItem<RoomAnnotation> },
  ) => {
    const item = context.item;
    if (range === null || item.type !== "diff") return;
    onComment(anchorFromSelection(resolveFileDiffPath(item.fileDiff), range, diff.head));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-1 border-b border-border/60 px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <p className="min-w-0 text-xs text-muted-foreground">{diffSourceText(diff)}</p>
          <Button size="compact" variant="ghost-muted" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
        {diff.truncated ? (
          <p role="status" className="text-xs text-warning-foreground">
            This diff was cut at 512 KiB, so it ends early.
          </p>
        ) : null}
        <ApartList apart={apart} me={me} nameOf={nameOf} onOpenMessage={onOpenMessage} />
      </div>
      {parsed === null ? (
        <p className="px-4 py-5 text-sm text-muted-foreground sm:px-6">
          Nothing has changed on this task yet.
        </p>
      ) : parsed.kind === "raw" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-4 py-3 sm:px-6">
          <p className="text-xs text-muted-foreground">{parsed.reason}</p>
          <pre className="font-mono text-xs whitespace-pre text-foreground">{parsed.text}</pre>
        </div>
      ) : (
        <StyledDiffCodeView<RoomAnnotation>
          className="@container min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
          viewerRef={viewer}
          items={items}
          selectedLines={drafting ? selected : null}
          onSelectedLinesChange={setSelected}
          options={{
            diffStyle: "unified",
            lineDiffType: "none",
            overflow: "wrap",
            theme: resolveDiffThemeName(resolvedTheme),
            preferredHighlighter: PREFERRED_HIGHLIGHTER,
            themeType: resolvedTheme,
            stickyHeaders: true,
            enableGutterUtility: true,
            enableLineSelection: true,
            onGutterUtilityClick: beginComment,
            onLineSelectionEnd: beginComment,
          }}
          renderAnnotation={(annotation) => (
            <ul className="divide-y divide-border/30 border-y border-border/30 bg-background">
              {annotation.metadata?.messages.map((message) => (
                <li key={message.seq}>
                  <button
                    type="button"
                    className="flex w-full min-w-0 flex-col gap-0.5 px-3 py-2 text-start font-sans outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => onOpenMessage(message.seq)}
                  >
                    <AuthorLine message={message} me={me} nameOf={nameOf} />
                    <span className="line-clamp-3 text-sm whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
                      {message.text}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        />
      )}
    </div>
  );
}

function AuthorLine({
  message,
  me,
  nameOf,
}: {
  readonly message: PeerRoomMessage;
  readonly me: string;
  readonly nameOf: NameOf;
}) {
  const author = authorOf(message, me, nameOf);
  return (
    <span className="flex min-w-0 items-baseline gap-2 text-xs text-muted-foreground">
      <span
        className={
          author.kind === "agent"
            ? "truncate font-mono text-foreground"
            : "truncate font-semibold text-foreground"
        }
      >
        {author.name}
      </span>
      <span className="tabular-nums">#{message.seq}</span>
    </span>
  );
}

/** Comments that have no line on this diff, so they are still found from here. */
function ApartList({
  apart,
  me,
  nameOf,
  onOpenMessage,
}: {
  readonly apart: ReadonlyArray<ApartAnchor>;
  readonly me: string;
  readonly nameOf: NameOf;
  readonly onOpenMessage: (seq: number) => void;
}) {
  if (apart.length === 0) return null;
  return (
    <details className="min-w-0 text-xs text-muted-foreground">
      <summary className="cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        {apart.length === 1 ? "1 comment" : `${apart.length} comments`} not on these lines
      </summary>
      <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto pt-1">
        {apart.map(({ message, where, why }) => (
          <li key={message.seq}>
            <button
              type="button"
              className="flex w-full min-w-0 flex-col rounded-sm px-1 py-0.5 text-start outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => onOpenMessage(message.seq)}
            >
              <AuthorLine message={message} me={me} nameOf={nameOf} />
              <span className="font-mono [overflow-wrap:anywhere]">
                {where} · {why}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The Chats view's header: a labelled "New chat" button, and search over the chats.
 *
 * The project is chosen in the project menu above the view switch, for Tasks and Chats alike, so
 * the header holds no scope control. Search owns its row and spans it.
 */
import { PlusIcon, SearchIcon } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";

import { Button } from "../ui/button";
import { SidebarInput } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface SidebarThreadHeaderProps {
  onNewChat: (event: ReactMouseEvent) => void;
  newChatDisabled: boolean;
  newChatShortcutLabel: string | null | undefined;
  newChatInProjectShortcutLabel: string | null | undefined;
  showNewChatInProjectHint: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  isSearching: boolean;
  searchResultCount: number;
  activeSearchResultIndex: number;
  onClearSearch: () => void;
}

export function SidebarThreadHeader({
  onNewChat,
  newChatDisabled,
  newChatShortcutLabel,
  newChatInProjectShortcutLabel,
  showNewChatInProjectHint,
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onSearchKeyDown,
  isSearching,
  searchResultCount,
  activeSearchResultIndex,
  onClearSearch,
}: SidebarThreadHeaderProps) {
  const resultsVisible = isSearching && searchResultCount > 0;
  // Results shrink as the query narrows, so the active index can outrun the
  // list; pointing aria-activedescendant at a removed option strands the
  // screen reader on nothing.
  const activeResultExists = resultsVisible && activeSearchResultIndex < searchResultCount;
  const newChatLabel = newChatShortcutLabel ? `New chat (${newChatShortcutLabel})` : "New chat";

  return (
    <div className="flex flex-col gap-1.5">
      <Tooltip>
        <TooltipTrigger
          render={<Button className="w-full" disabled={newChatDisabled} onClick={onNewChat} />}
        >
          <PlusIcon aria-hidden />
          New chat
        </TooltipTrigger>
        <TooltipPopup side="top">
          {showNewChatInProjectHint ? (
            <span className="flex flex-col gap-0.5">
              <span>{newChatLabel}</span>
              <span className="text-muted-foreground">
                New chat in the current project: Shift+click
                {newChatInProjectShortcutLabel ? ` (${newChatInProjectShortcutLabel})` : ""}
              </span>
            </span>
          ) : (
            newChatLabel
          )}
        </TooltipPopup>
      </Tooltip>
      <div className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground">
        <SearchIcon className="size-4 shrink-0 text-(--sidebar-icon-color)" />
        <SidebarInput
          ref={searchInputRef}
          nativeInput
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="Search chats"
          aria-label="Search chats"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={resultsVisible}
          aria-controls={resultsVisible ? "sidebar-thread-search-results" : undefined}
          aria-activedescendant={
            activeResultExists
              ? `sidebar-thread-search-result-${activeSearchResultIndex}`
              : undefined
          }
          className="min-w-0 flex-1"
        />
        {isSearching ? (
          <Button
            type="button"
            size="micro"
            variant="ghost-muted"
            className="shrink-0"
            onClick={() => {
              onClearSearch();
              searchInputRef.current?.focus();
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}

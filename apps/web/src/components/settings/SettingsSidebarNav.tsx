/**
 * The one settings navigation (design artboard 3d), for the app's settings and Peer's alike: search
 * on top, the Overview, then Workspace, Projects, Me, This computer and App with the pages the
 * person may open (`settingsNavGroups`). Searching replaces the list with results that say where
 * each lives; choosing one opens its page and scrolls to the field.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ChevronLeftIcon, SearchIcon, XIcon } from "lucide-react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { isElectron } from "../../env";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";
import { SidebarUpdatePill } from "../sidebar/SidebarUpdatePill";
import { useNavigateToMainApp } from "../sidebar/mainAppLocation";
import {
  useLastPeerWorkspace,
  usePeerSettingsEnvironment,
} from "../workspaces/settings/PeerSettingsContext";
import { PeerSettingsAccount } from "../workspaces/settings/PeerSettingsAccount";
import {
  currentNavWorkspace,
  parsePeerSettingsPath,
  workspaceSwitchTarget,
} from "../workspaces/settings/peerSettings.logic";
import { useOpenPeerSettings } from "../workspaces/settings/peerSettingsLinks";
import { EnvironmentPicker, SettingsNavGroupView, WorkspaceSwitcher } from "./SettingsNavParts";
import { navMarks, settingsNavGroups, type SettingsNavItem } from "./settingsNav.logic";
import { scrollToSettingsTarget } from "./settingsLayout";
import { validateSettingsScopeSearch } from "./settingsScope";
import {
  isPeerSearchItem,
  isSettingsOverviewVisible,
  searchEntryPath,
  searchSettingsEntries,
  type SettingsSearchEntry,
} from "./settingsSearch";
import { useOverview } from "./useOverviewFacts";
import { useSettingsSearchEntries } from "./useSettingsSearchEntries";

const T3ConnectSidebarSignIn = lazy(() =>
  import("../clerk/T3ConnectSidebarSignIn").then((module) => ({
    default: module.T3ConnectSidebarSignIn,
  })),
);
const T3ConnectSidebarAvatar = lazy(() =>
  import("../clerk/T3ConnectSidebarSignIn").then((module) => ({
    default: module.T3ConnectSidebarAvatar,
  })),
);

const NO_WORKSPACES: ReadonlyArray<never> = [];

/** "1 place", "3 places": how many results the search found. */
const placesText = (count: number) => `${count} ${count === 1 ? "place" : "places"}`;

export function SettingsSidebarNav({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const openPeer = useOpenPeerSettings();
  const currentHash = useLocation({ select: (location) => location.hash });
  const currentSearch = useLocation({ select: (location) => location.search });
  const scopeSearch = useMemo(() => validateSettingsScopeSearch(currentSearch), [currentSearch]);
  const { isMobile, setOpenMobile, open, setOpen } = useSidebar();
  const { environment, connected, status } = usePeerSettingsEnvironment();
  const [lastWorkspace] = useLastPeerWorkspace();
  const overview = useOverview();

  const signedIn = connected && status !== null && status.signedIn ? status : null;
  const workspaces = signedIn === null ? NO_WORKSPACES : signedIn.workspaces;
  const current = parsePeerSettingsPath(pathname);
  const workspace = currentNavWorkspace(workspaces, current, lastWorkspace);
  const nav = settingsNavGroups({
    pathname,
    workspace: signedIn === null ? null : workspace,
    signedOut: connected && status !== null ? !status.signedIn : undefined,
    status: connected && status !== null ? status : undefined,
    projectPage: isSettingsOverviewVisible(scopeSearch),
    marks: navMarks(overview.groups),
  });
  // App stays folded until a page of it is open or the person opens it; a choice they made holds.
  const [appOpen, setAppOpen] = useState<boolean | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const searchableItems = useSettingsSearchEntries(scopeSearch, overview.groups);
  const results = useMemo(
    () => searchSettingsEntries(query, searchableItems),
    [query, searchableItems],
  );
  const isSearching = query.trim().length > 0;
  const hasResults = results.length > 0;
  // The highlighted result stays inside the list as the list shrinks.
  const activeIndex = Math.min(activeResultIndex, Math.max(results.length - 1, 0));

  useEffect(() => {
    const result = results[activeIndex];
    if (!result) return;
    document
      .getElementById(`settings-search-result-${result.id}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, results]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      // "/" from anywhere that is not typing, and ⌘F / Ctrl+F in the desktop app, where there is no
      // find bar of the browser's to lose.
      const find =
        isElectron &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "f";
      const slash = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!find && !slash) return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        ((slash &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)) ||
          // Keep focus inside open dialogs and popups instead of escaping
          // their focus trap into the sidebar search.
          target.closest('[role="dialog"], [aria-modal="true"], [data-slot$="popup"]') !== null)
      ) {
        return;
      }

      event.preventDefault();
      if (isMobile) {
        setOpenMobile(true);
      } else if (!open) {
        setOpen(true);
      }
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobile, open, setOpen, setOpenMobile]);

  const closeMobile = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);
  const openItem = useCallback(
    (item: SettingsNavItem) => {
      closeMobile();
      if (item.target.kind === "peer") {
        void openPeer(item.target.location);
        return;
      }
      void navigate({
        to: item.target.to,
        hash: "",
        replace: true,
        hashScrollIntoView: false,
      });
    },
    [closeMobile, navigate, openPeer],
  );
  const clearSearch = useCallback(() => {
    setQuery("");
    setActiveResultIndex(0);
  }, []);
  const handleSearchResultClick = useCallback(
    (item: SettingsSearchEntry) => {
      clearSearch();
      closeMobile();
      if (isPeerSearchItem(item)) {
        void openPeer(item.location, { hash: item.targetId });
        return;
      }
      const targetId = item.targetId ?? item.id;
      if (pathname === item.to && currentHash.replace(/^#/, "") === targetId) {
        scrollToSettingsTarget(targetId);
        return;
      }
      void navigate({
        to: item.to,
        hash: targetId,
        replace: true,
        hashScrollIntoView: false,
        state: { settingsTargetHighlight: true },
      });
    },
    [clearSearch, closeMobile, currentHash, navigate, openPeer, pathname],
  );
  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape" && isSearching) {
        event.preventDefault();
        event.stopPropagation();
        clearSearch();
        return;
      }
      if (results.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveResultIndex((activeIndex + 1) % results.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveResultIndex((activeIndex - 1 + results.length) % results.length);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const result = results[activeIndex];
        if (result) handleSearchResultClick(result);
      }
    },
    [activeIndex, clearSearch, handleSearchResultClick, isSearching, results],
  );

  const switcher =
    workspace !== null && workspaces.length > 1 ? (
      <WorkspaceSwitcher
        workspaces={workspaces}
        current={workspace.slug}
        onSelect={(slug) => {
          const target = workspaces.find((candidate) => candidate.slug === slug);
          if (target === undefined) return;
          closeMobile();
          void openPeer(workspaceSwitchTarget(current, target));
        }}
      />
    ) : null;
  const overviewItem = nav.overview;

  return (
    <>
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => {
                  closeMobile();
                  void navigateToMainApp();
                }}
              >
                <ChevronLeftIcon />
                <span>Back to Tasks</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <h2 className="px-2 pt-3 pb-1 text-base font-semibold text-sidebar-foreground">
            Settings
          </h2>
          <EnvironmentPicker />
          <div className="mt-2 flex h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground">
            <SearchIcon className="size-4 shrink-0 text-sidebar-muted-foreground/80" />
            <SidebarInput
              ref={searchInputRef}
              nativeInput
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setActiveResultIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search settings"
              aria-label="Search settings"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={isSearching && hasResults}
              aria-controls={isSearching && hasResults ? "settings-search-results" : undefined}
              aria-activedescendant={
                isSearching && results[activeIndex]
                  ? `settings-search-result-${results[activeIndex].id}`
                  : undefined
              }
              className="min-w-0 flex-1"
            />
            {isSearching ? (
              <Button
                type="button"
                size="icon-micro"
                variant="ghost-muted"
                className="shrink-0"
                aria-label="Clear settings search"
                onClick={() => {
                  clearSearch();
                  searchInputRef.current?.focus();
                }}
              >
                <XIcon className="size-3" />
              </Button>
            ) : (
              <Kbd>/</Kbd>
            )}
          </div>
        </SidebarGroup>
        {isSearching ? (
          <SidebarGroup>
            <p role="status" className="px-2 pb-1 text-xs text-sidebar-muted-foreground">
              {hasResults
                ? placesText(results.length)
                : `No settings match “${query.trim()}”. Try a word from a page, like token, webhook or schedule.`}
            </p>
            <SidebarMenu
              id={hasResults ? "settings-search-results" : undefined}
              role={hasResults ? "listbox" : undefined}
              aria-label={hasResults ? "Settings search results" : undefined}
            >
              {results.map((item, index) => (
                <SidebarMenuItem key={item.id} role="presentation">
                  <SidebarMenuButton
                    id={`settings-search-result-${item.id}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    tabIndex={-1}
                    size="sm"
                    isActive={index === activeIndex}
                    className="h-auto min-h-10 items-start"
                    onMouseMove={() => setActiveResultIndex(index)}
                    onClick={() => handleSearchResultClick(item)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground">
                          {item.title}
                        </span>
                        {isPeerSearchItem(item) && item.status !== undefined ? (
                          <Badge variant="warning" size="sm">
                            {item.status}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="block truncate text-2xs text-sidebar-muted-foreground/75">
                        {searchEntryPath(item)}
                      </span>
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : (
          <>
            <SidebarGroup>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={overviewItem.current}
                    aria-current={overviewItem.current ? "page" : undefined}
                    onClick={() => openItem(overviewItem)}
                  >
                    <span className="truncate">{overviewItem.label}</span>
                    {overviewItem.badge === null ? null : (
                      <Badge variant="warning" size="sm" className="ms-auto">
                        {overviewItem.badge}
                      </Badge>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
            {nav.groups.map((group) => (
              <SettingsNavGroupView
                key={group.id}
                group={group}
                open={group.id === "app" ? (appOpen ?? !group.folded) : true}
                onToggle={() => setAppOpen(!(appOpen ?? !group.folded))}
                switcher={group.id === "workspace" ? switcher : null}
                workspaceSlug={workspace?.slug ?? null}
                onOpen={openItem}
              />
            ))}
          </>
        )}
      </SidebarContent>
      <SidebarFooter>
        <Suspense fallback={null}>
          <T3ConnectSidebarSignIn />
        </Suspense>
        {signedIn !== null && environment !== null ? (
          <PeerSettingsAccount environmentId={environment.environmentId} status={signedIn} />
        ) : null}
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <SidebarMenu className="flex-row items-center">
              <SidebarUpdatePill />
            </SidebarMenu>
          </div>
          <Suspense fallback={null}>
            <T3ConnectSidebarAvatar />
          </Suspense>
        </div>
      </SidebarFooter>
    </>
  );
}

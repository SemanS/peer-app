/**
 * The parts of the one settings navigation: a group's heading (with the workspace switcher beside
 * Workspace, and a fold for App), a row (with a project's mark, a dot where something is left to
 * finish, a few words beside the label), and the computer picker for a person with several.
 */
import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronRightIcon, ChevronsUpDownIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../ui/menu";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { WorkSectionLabel } from "../workspaces/marks";
import { ProjectMark } from "../workspaces/signals";
import { projectScopeKey } from "../workspaces/workBoard.logic";
import { usePeerSettingsEnvironment } from "../workspaces/settings/PeerSettingsContext";
import type { SettingsNavGroup, SettingsNavItem } from "./settingsNav.logic";
import { settingsScopeEnvironmentLabel } from "./settingsScopeAxis";

const switcherTrigger =
  "flex min-w-0 items-center gap-1 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:text-foreground";

/** The workspace's name beside the group label; a menu when the person is in several workspaces. */
export function WorkspaceSwitcher({
  workspaces,
  current,
  onSelect,
}: {
  readonly workspaces: ReadonlyArray<{ readonly slug: string; readonly name: string }>;
  readonly current: string;
  readonly onSelect: (slug: string) => void;
}) {
  const name = workspaces.find((workspace) => workspace.slug === current)?.name ?? current;
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label="Choose the workspace"
            className={`${switcherTrigger} font-normal tracking-normal normal-case`}
          />
        }
      >
        <span className="truncate">{name}</span>
        <ChevronsUpDownIcon aria-hidden className="size-3 shrink-0" />
      </MenuTrigger>
      <MenuPopup align="start" className="min-w-48">
        <MenuRadioGroup value={current} onValueChange={(value) => onSelect(String(value))}>
          {workspaces.map((workspace) => (
            <MenuRadioItem key={workspace.slug} value={workspace.slug} closeOnClick>
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

/** Which computer's Peer the settings show, for a person with more than one environment. */
export function EnvironmentPicker() {
  const { environments, environment } = usePeerSettingsEnvironment();
  const navigate = useNavigate();
  if (environments.length < 2 || environment === null) return null;
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label="Choose the computer whose Peer these settings are"
            className={`${switcherTrigger} mt-1 w-full px-2 py-1 text-xs`}
          />
        }
      >
        <EnvironmentMachineIcon
          aria-hidden
          kind={resolveEnvironmentMachineKind(environment.serverConfig)}
          className="size-3.5 shrink-0"
        />
        <span className="min-w-0 flex-1 truncate text-left">
          {settingsScopeEnvironmentLabel(environment, environments)}
        </span>
        <ChevronsUpDownIcon aria-hidden className="size-3 shrink-0" />
      </MenuTrigger>
      <MenuPopup align="start" className="min-w-48">
        <MenuRadioGroup
          value={environment.environmentId}
          onValueChange={(value) =>
            void navigate({ to: "/settings/peer", search: { machine: String(value) } })
          }
        >
          {environments.map((candidate) => (
            <MenuRadioItem key={candidate.environmentId} value={candidate.environmentId}>
              <span className="flex min-w-0 items-center gap-2">
                <EnvironmentMachineIcon
                  aria-hidden
                  kind={resolveEnvironmentMachineKind(candidate.serverConfig)}
                  className="size-3.5"
                />
                <span className="min-w-0 flex-1 truncate">
                  {settingsScopeEnvironmentLabel(candidate, environments)}
                </span>
                {candidate.connection.phase === "connected" ? null : (
                  <span className="shrink-0 text-xs text-muted-foreground">Offline</span>
                )}
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

/** One row: its label, a project's mark and "lead", a dot where something is left, a few words. */
function SettingsNavRow({
  item,
  workspaceSlug,
  onOpen,
}: {
  readonly item: SettingsNavItem;
  readonly workspaceSlug: string | null;
  readonly onOpen: (item: SettingsNavItem) => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={item.current}
        aria-current={item.current ? "page" : undefined}
        onClick={() => onOpen(item)}
      >
        {item.project === undefined || workspaceSlug === null ? null : (
          <ProjectMark
            name={item.project.name}
            colorKey={projectScopeKey({ workspace: workspaceSlug, projectId: item.project.id })}
            className="size-4.5"
          />
        )}
        <span
          className={cn(
            "truncate",
            item.quiet === true && !item.current && "text-sidebar-muted-foreground/60",
          )}
        >
          {item.label}
        </span>
        {item.project?.lead === true ? (
          <span className="ms-auto shrink-0 text-2xs font-normal text-sidebar-muted-foreground">
            lead
          </span>
        ) : null}
        {item.tag === undefined ? null : (
          <span className="ms-auto shrink-0 text-2xs font-normal text-warning-foreground">
            {item.tag}
          </span>
        )}
        {item.dot === true ? (
          <span
            role="img"
            aria-label="Something is left to finish here"
            className="ms-auto size-1.5 shrink-0 rounded-full bg-warning"
          />
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * A group's heading and its rows. App folds behind its count (`open` is whether it shows its rows);
 * the heading of Workspace carries the switcher when the person is in several workspaces.
 */
export function SettingsNavGroupView({
  group,
  open,
  onToggle,
  switcher,
  workspaceSlug,
  onOpen,
}: {
  readonly group: SettingsNavGroup;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly switcher: ReactNode;
  readonly workspaceSlug: string | null;
  readonly onOpen: (item: SettingsNavItem) => void;
}) {
  const foldable = group.id === "app";
  return (
    <SidebarGroup>
      {foldable ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex w-full items-center gap-2 rounded-sm px-2 pt-2 pb-2 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span>{group.label}</span>
          <span className="flex-1" />
          {open ? (
            <ChevronDownIcon aria-hidden className="size-3" />
          ) : (
            <>
              <span className="font-normal normal-case tracking-normal">{group.items.length}</span>
              <ChevronRightIcon aria-hidden className="size-3" />
            </>
          )}
        </button>
      ) : (
        <WorkSectionLabel>
          {group.label}
          {group.who === undefined
            ? null
            : (switcher ?? (
                <span className="min-w-0 truncate font-normal tracking-normal normal-case">
                  {group.who}
                </span>
              ))}
        </WorkSectionLabel>
      )}
      {open ? (
        <SidebarMenu>
          {group.items.map((item) => (
            <SettingsNavRow
              key={item.id}
              item={item}
              workspaceSlug={workspaceSlug}
              onOpen={onOpen}
            />
          ))}
        </SidebarMenu>
      ) : null}
    </SidebarGroup>
  );
}

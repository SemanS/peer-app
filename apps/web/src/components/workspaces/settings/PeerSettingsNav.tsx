import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronsUpDownIcon, Settings2Icon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../../lib/utils";
import { EnvironmentMachineIcon } from "../../EnvironmentMachineIcon";
import { useNavigateToMainApp } from "../../sidebar/mainAppLocation";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../../ui/menu";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../../ui/sidebar";
import { settingsScopeEnvironmentLabel } from "../../settings/settingsScopeAxis";
import { WorkSectionLabel } from "../marks";
import { ProjectMark } from "../signals";
import { projectScopeKey } from "../workBoard.logic";
import { PeerSettingsAccount } from "./PeerSettingsAccount";
import { useLastPeerWorkspace, usePeerSettingsEnvironment } from "./PeerSettingsContext";
import { useOpenPeerSettings } from "./peerSettingsLinks";
import {
  currentNavWorkspace,
  isPeerNavItemCurrent,
  parsePeerSettingsPath,
  peerNavGroups,
  workspaceSwitchTarget,
  type PeerNavGroup,
  type PeerSettingsLocation,
} from "./peerSettings.logic";

const NO_WORKSPACES: ReadonlyArray<never> = [];

const switcherTrigger =
  "flex min-w-0 items-center gap-1 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:text-foreground";

/** The workspace's name beside the group label; a menu when the person is in several workspaces. */
function WorkspaceSwitcher({
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
            <MenuRadioItem key={workspace.slug} value={workspace.slug}>
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
function EnvironmentPicker() {
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

function NavGroup({
  group,
  current,
  workspaceSlug,
  switcher,
  onOpen,
}: {
  readonly group: PeerNavGroup;
  readonly current: PeerSettingsLocation | null;
  readonly workspaceSlug: string | null;
  readonly switcher: ReactNode;
  readonly onOpen: (location: PeerSettingsLocation) => void;
}) {
  return (
    <SidebarGroup>
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
      <SidebarMenu>
        {group.items.map((item) => {
          const isCurrent = isPeerNavItemCurrent(item, current);
          return (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton
                isActive={isCurrent}
                aria-current={isCurrent ? "page" : undefined}
                onClick={() => onOpen(item.location)}
              >
                {item.project === undefined || workspaceSlug === null ? null : (
                  <ProjectMark
                    name={item.project.name}
                    colorKey={projectScopeKey({
                      workspace: workspaceSlug,
                      projectId: item.project.id,
                    })}
                    className="size-4.5"
                  />
                )}
                <span
                  className={cn(
                    "truncate",
                    item.quiet === true && !isCurrent && "text-sidebar-muted-foreground/60",
                  )}
                >
                  {item.label}
                </span>
                {item.project?.lead === true ? (
                  <span className="ms-auto shrink-0 text-2xs font-normal text-sidebar-muted-foreground">
                    lead
                  </span>
                ) : null}
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}

/**
 * The sidebar on `/settings/peer/…`, in place of T3's settings list: back to Work, then the
 * Workspace the person has open, its Projects, Me, and This computer. What a member has no use for
 * (the admin pages) is left out; see `peerNavGroups`.
 */
export function PeerSettingsNav({ pathname }: { readonly pathname: string }) {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const open = useOpenPeerSettings();
  const { isMobile, setOpenMobile } = useSidebar();
  const { environment, connected, status } = usePeerSettingsEnvironment();
  const [lastWorkspace] = useLastPeerWorkspace();
  const current = parsePeerSettingsPath(pathname);
  const signedIn = connected && status !== null && status.signedIn ? status : null;
  const workspaces = signedIn === null ? NO_WORKSPACES : signedIn.workspaces;
  const workspace = currentNavWorkspace(workspaces, current, lastWorkspace);
  const groups = signedIn === null ? [] : peerNavGroups(workspace);
  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };
  const openPage = (location: PeerSettingsLocation) => {
    closeMobile();
    void open(location);
  };
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
                <span>Back to Work</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <h2 className="px-2 pt-3 pb-1 text-base font-semibold text-sidebar-foreground">
            Settings
          </h2>
          <EnvironmentPicker />
        </SidebarGroup>
        {connected && status?.signedIn === false ? (
          <p className="px-4 text-xs text-sidebar-muted-foreground">
            Sign in to see your workspaces, projects and keys.
          </p>
        ) : null}
        {groups.map((group) => (
          <NavGroup
            key={group.id}
            group={group}
            current={current}
            workspaceSlug={workspace?.slug ?? null}
            switcher={
              group.id === "workspace" && workspace !== null && workspaces.length > 1 ? (
                <WorkspaceSwitcher
                  workspaces={workspaces}
                  current={workspace.slug}
                  onSelect={(slug) => {
                    const target = workspaces.find((candidate) => candidate.slug === slug);
                    if (target !== undefined) openPage(workspaceSwitchTarget(current, target));
                  }}
                />
              ) : null
            }
            onOpen={openPage}
          />
        ))}
      </SidebarContent>
      <SidebarFooter>
        {signedIn !== null && environment !== null ? (
          <PeerSettingsAccount environmentId={environment.environmentId} status={signedIn} />
        ) : null}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => {
                closeMobile();
                void navigate({ to: "/settings/general" });
              }}
            >
              <Settings2Icon />
              <span>All settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}

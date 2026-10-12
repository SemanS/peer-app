import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../../WorkspaceBreadcrumb";
import { usePeerSettingsEnvironment } from "./PeerSettingsContext";
import {
  parsePeerSettingsPath,
  peerSettingsGroupLabel,
  peerSettingsPageTitle,
} from "./peerSettings.logic";

/**
 * `Settings / <group> / <page>`, where the group is the one the settings navigation lists the page
 * under (Workspace, Projects, Me, This computer): a project's page reads as its name, as its header
 * does. The area's front door, which names no page, reads `Settings / Peer`.
 */
export function PeerSettingsBreadcrumb({ pathname }: { readonly pathname: string }) {
  const { status } = usePeerSettingsEnvironment();
  const location = parsePeerSettingsPath(pathname);
  const page = peerSettingsPageTitle(location, status?.workspaces ?? []);
  return (
    <WorkspaceBreadcrumb ariaLabel="Settings breadcrumb">
      <WorkspaceBreadcrumbItem>Settings</WorkspaceBreadcrumbItem>
      <WorkspaceBreadcrumbSeparator />
      <WorkspaceBreadcrumbItem current={page === null} className="truncate">
        {location === null ? "Peer" : peerSettingsGroupLabel(location)}
      </WorkspaceBreadcrumbItem>
      {page === null ? null : (
        <>
          <WorkspaceBreadcrumbSeparator />
          <WorkspaceBreadcrumbItem current className="truncate">
            {page}
          </WorkspaceBreadcrumbItem>
        </>
      )}
    </WorkspaceBreadcrumb>
  );
}

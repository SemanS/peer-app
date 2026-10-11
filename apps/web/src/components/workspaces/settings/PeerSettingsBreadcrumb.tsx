import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../../WorkspaceBreadcrumb";
import { usePeerSettingsEnvironment } from "./PeerSettingsContext";
import { parsePeerSettingsPath, peerSettingsPageTitle } from "./peerSettings.logic";

/** `Settings / Peer / <page>`: a project's page reads as its name, as its header does. */
export function PeerSettingsBreadcrumb({ pathname }: { readonly pathname: string }) {
  const { status } = usePeerSettingsEnvironment();
  const page = peerSettingsPageTitle(parsePeerSettingsPath(pathname), status?.workspaces ?? []);
  return (
    <WorkspaceBreadcrumb ariaLabel="Settings breadcrumb">
      <WorkspaceBreadcrumbItem>Settings</WorkspaceBreadcrumbItem>
      <WorkspaceBreadcrumbSeparator />
      <WorkspaceBreadcrumbItem current={page === null} className="truncate">
        Peer
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

import { Fragment } from "react";

import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { isPeerSettingsPath } from "../workspaces/settings/peerSettings.logic";
import { PeerSettingsBreadcrumb } from "../workspaces/settings/PeerSettingsBreadcrumb";
import { settingsBreadcrumbPath } from "./settingsNav.logic";

/**
 * `Settings / <group> / <page>`, with the group the settings navigation lists the page under (This
 * computer, App). The scope a change applies to lives at the top of the page content, see
 * `SettingsScopeSentence`.
 */
export function SettingsBreadcrumb({ pathname }: { pathname: string }) {
  // Peer's own area names its pages itself: workspaces and projects have no fixed labels.
  if (isPeerSettingsPath(pathname)) return <PeerSettingsBreadcrumb pathname={pathname} />;
  const path = settingsBreadcrumbPath(pathname);

  return (
    <WorkspaceBreadcrumb ariaLabel="Settings breadcrumb">
      {path === null ? (
        <WorkspaceBreadcrumbItem current className="truncate">
          Settings
        </WorkspaceBreadcrumbItem>
      ) : (
        <>
          <WorkspaceBreadcrumbItem>Settings</WorkspaceBreadcrumbItem>
          {path.map((part, index) => (
            <Fragment key={part}>
              <WorkspaceBreadcrumbSeparator />
              <WorkspaceBreadcrumbItem current={index === path.length - 1} className="truncate">
                {part}
              </WorkspaceBreadcrumbItem>
            </Fragment>
          ))}
        </>
      )}
    </WorkspaceBreadcrumb>
  );
}

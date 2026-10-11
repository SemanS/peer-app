import { ComingInThisChange, PeerSettingsPage } from "../PeerSettingsPage";

/** A workspace's tool catalog. Members read it; admins change it. */
export function ToolCatalog() {
  return (
    <PeerSettingsPage title="Tools">
      <ComingInThisChange>
        the workspace’s tool catalog, its versions, and which projects use each tool
      </ComingInThisChange>
    </PeerSettingsPage>
  );
}

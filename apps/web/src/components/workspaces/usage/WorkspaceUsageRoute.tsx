import { PeerPluginPage } from "../PluginOff";
import { WorkspaceUsagePage } from "./WorkspaceUsagePage";

/** The page while the usage plugin is active; the plugin's off page where a link finds it is not. */
export function WorkspaceUsageRoute({ workspace }: { readonly workspace: string }) {
  return (
    <PeerPluginPage plugin="usage" title="Usage">
      <WorkspaceUsagePage key={workspace} workspace={workspace} />
    </PeerPluginPage>
  );
}

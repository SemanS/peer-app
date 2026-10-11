import { formatRelativeTimeLabel } from "../../../../timestampFormat";
import {
  SettingsRow,
  SettingsSection,
  useRelativeTimeTick,
} from "../../../settings/settingsLayout";
import type { WorkspacePageProps } from "../pageProps";
import { ComingInThisChange, PeerSettingsPage } from "../PeerSettingsPage";

/** The Hub this computer is signed in to: read only, since its operator changes it. */
export function HubStatus({ status }: WorkspacePageProps) {
  useRelativeTimeTick(60_000);
  return (
    <PeerSettingsPage
      title="Hub"
      description="Read only. The Hub’s operator changes these, not the app."
    >
      <SettingsSection title="Hub" hideTitle>
        <SettingsRow title="Address" description={status.hubUrl} />
        <SettingsRow
          title="Synced"
          description={status.lastSyncAt ? formatRelativeTimeLabel(status.lastSyncAt) : "Not yet"}
        />
      </SettingsSection>
      <ComingInThisChange>the Hub’s version and data, and which features are on</ComingInThisChange>
    </PeerSettingsPage>
  );
}

import { Outlet, useLocation } from "@tanstack/react-router";
import { UsersIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { SettingsPageContainer } from "../../settings/settingsLayout";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../../ui/empty";
import { WorkspacePicker } from "../WorkspaceAccess";
import {
  PeerSettingsProvider,
  useLastPeerWorkspace,
  usePeerSettings,
  usePeerSettingsEnvironment,
} from "./PeerSettingsContext";
import { PeerSettingsPage } from "./PeerSettingsPage";
import {
  PEER_SETTINGS_PATH,
  environmentIsComing,
  locationWorkspace,
  parsePeerSettingsPath,
} from "./peerSettings.logic";
import { PeerSettingsRedirect, useOpenPeerSettings } from "./peerSettingsLinks";
import { SignedOutPeerSettings } from "./SignedOutPeerSettings";

function PeerSettingsMessage({ children }: { readonly children: ReactNode }) {
  return (
    <SettingsPageContainer>
      <p role="status" className="text-sm text-muted-foreground">
        {children}
      </p>
    </SettingsPageContainer>
  );
}

/** Keeps the workspace being viewed, so This computer's pages (which name none) keep showing it. */
function RememberWorkspace({ pathname }: { readonly pathname: string }) {
  const { status } = usePeerSettings();
  const [last, setLast] = useLastPeerWorkspace();
  const slug = locationWorkspace(parsePeerSettingsPath(pathname));
  const listed = slug !== null && status.workspaces.some((workspace) => workspace.slug === slug);
  useEffect(() => {
    if (listed && slug !== last) setLast(slug);
  }, [last, listed, setLast, slug]);
  return null;
}

/**
 * `/settings/peer` itself: the workspace the person last had open (else the first) opens on its
 * General page; with no workspace yet, joining or creating one is all there is to do.
 */
function PeerSettingsFrontDoor() {
  const { environmentId, status } = usePeerSettings();
  const [last, setLast] = useLastPeerWorkspace();
  const open = useOpenPeerSettings();
  const target =
    status.workspaces.find((workspace) => workspace.slug === last) ?? status.workspaces[0];
  if (target !== undefined) {
    return (
      <PeerSettingsRedirect
        to={{ kind: "workspace", workspace: target.slug, section: "general" }}
      />
    );
  }
  return (
    <PeerSettingsPage
      title="Join or create a workspace"
      description={
        status.joinable.length === 0 ? undefined : "Your address qualifies for these workspaces."
      }
    >
      <div className="max-w-xl">
        <WorkspacePicker
          environmentId={environmentId}
          status={status}
          onJoined={(slug) => {
            setLast(slug);
            void open({ kind: "workspace", workspace: slug, section: "general" });
          }}
        />
      </div>
    </PeerSettingsPage>
  );
}

/**
 * The layout of `/settings/peer/…`: the environment's Peer, whatever state it is in. Pages render
 * only once someone is signed in; until then (or while the environment is out of reach) the area
 * says why, and the sign-in view is the one page there is.
 */
export function PeerSettingsLayout() {
  const { environment, connected, status } = usePeerSettingsEnvironment();
  const pathname = useLocation({ select: (location) => location.pathname });
  if (environment === null) {
    return (
      <SettingsPageContainer>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>No environments available</EmptyTitle>
            <EmptyDescription>Connect an environment to join a workspace.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </SettingsPageContainer>
    );
  }
  if (!connected) {
    return (
      <PeerSettingsMessage>
        {environmentIsComing(environment)
          ? `Connecting to ${environment.label}…`
          : `${environment.label} is not connected.`}
      </PeerSettingsMessage>
    );
  }
  if (status === null) {
    return <PeerSettingsMessage>Loading workspaces on {environment.label}…</PeerSettingsMessage>;
  }
  if (!status.signedIn) {
    return <SignedOutPeerSettings environmentId={environment.environmentId} status={status} />;
  }
  return (
    <PeerSettingsProvider value={{ environmentId: environment.environmentId, status }}>
      <RememberWorkspace pathname={pathname} />
      {pathname.replace(/\/+$/, "") === PEER_SETTINGS_PATH ? <PeerSettingsFrontDoor /> : <Outlet />}
    </PeerSettingsProvider>
  );
}

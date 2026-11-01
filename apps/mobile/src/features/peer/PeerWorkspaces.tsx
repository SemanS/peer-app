import { LocalWork } from "./LocalWork";
import {
  editionLabel,
  type EnvironmentId,
  type PeerHubSetCoordinationInput,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { domainStateLabel } from "@t3tools/client-runtime/peer-domain-offers";
import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsSection } from "../settings/components/SettingsSection";
import { useSettingsEnvironmentFilter } from "../settings/settings-environment-filter";
import { PeerAccessControls } from "./PeerAccessControls";
import { PeerDomainOffers } from "./PeerDomainOffers";
import { PeerFoundings } from "./PeerFoundings";
import { PeerSignIn } from "./PeerSignIn";
import { organizationLine } from "./organizationLine.logic";
import { PeerAdapters } from "./PeerAdapters";
import { PeerPluginsSection } from "./PeerPluginsSection";
import { usePeerMobilePlugins } from "./slots";
import { workspaceSectionsAt } from "./slots.logic";

/**
 * Peer workspaces: the way to the rooms, then for each environment selected in Settings signing in,
 * what the active plugins add (the agents herdr runs, the audit log), how agents coordinate, and the
 * plugins themselves.
 */
export function PeerWorkspaces() {
  const { selectedTargets } = useSettingsEnvironmentFilter();
  if (selectedTargets.length === 0) {
    return (
      <Text className="text-foreground-muted">Connect an environment to work with your team.</Text>
    );
  }
  return (
    <>
      <RoomsRow />
      {selectedTargets.map((target) => (
        <PeerEnvironment
          key={target.environmentId}
          environmentId={target.environmentId}
          label={target.label}
        />
      ))}
    </>
  );
}

/** Opens the rooms of every computer the phone knows. */
function RoomsRow() {
  const navigation = useNavigation();
  return (
    <SettingsSection>
      <SettingsRow
        icon="bubble.left.and.bubble.right"
        label="Rooms"
        value="Your tasks' conversations"
        onPress={() => navigation.navigate("Rooms")}
      />
    </SettingsSection>
  );
}

function PeerEnvironment({
  environmentId,
  label,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}) {
  const query = useEnvironmentQuery(serverEnvironment.peerHubLive({ environmentId, input: {} }));
  const coordinate = useAtomCommand(serverEnvironment.peerHubSetCoordination, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const status = query.data;
  const plugins = usePeerMobilePlugins(status);
  const runCoordination = (input: PeerHubSetCoordinationInput) => {
    setBusy(true);
    setMessage(null);
    void coordinate({ environmentId, input })
      .then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          setMessage(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => setBusy(false));
  };
  return (
    <View className="gap-4">
      <Text className="text-lg font-t3-semibold text-foreground">{label}</Text>
      {query.error !== null ? (
        <Text accessibilityRole="alert" className="text-destructive">
          {query.error}
        </Text>
      ) : null}
      {status === null ? (
        <Text className="text-foreground-muted">
          {query.error === null
            ? "Loading workspaces…"
            : "Reconnect the environment and try again."}
        </Text>
      ) : (
        <>
          {status.signedIn ? null : <PeerSignIn environmentId={environmentId} status={status} />}
          <LocalWork status={status} />
          {status.signedIn ? (
            <PeerAccessControls environmentId={environmentId} status={status} />
          ) : null}
          <PeerFoundings environmentId={environmentId} status={status} />
          <PeerDomainOffers environmentId={environmentId} status={status} />
          {status.workspaces.map((workspace) => (
            <SettingsSection key={workspace.slug} title={workspace.name}>
              <Text className="p-4 text-sm text-foreground-muted">
                {organizationLine(workspace, status.workspaces.length)}
              </Text>
              <Text className="p-4 text-sm text-foreground-muted">
                {editionLabel(workspace.edition)}
              </Text>
              {workspace.domainClaims?.length ? (
                <Text className="p-4 text-sm text-foreground-muted">
                  {workspace.domainClaims
                    .map((claim) => domainStateLabel(claim.state, claim.domain))
                    .join(" · ")}
                </Text>
              ) : null}
            </SettingsSection>
          ))}
          {workspaceSectionsAt(plugins, "tasks").map(({ key, Component }) => (
            <Component
              key={key}
              environmentId={environmentId}
              label={label}
              status={status}
              plugins={plugins}
            />
          ))}
          <PeerAdapters
            label={label}
            status={status}
            busy={busy}
            message={message}
            onCoordinate={runCoordination}
          />
          {workspaceSectionsAt(plugins, "end").map(({ key, Component }) => (
            <Component
              key={key}
              environmentId={environmentId}
              label={label}
              status={status}
              plugins={plugins}
            />
          ))}
          {status.workspaces.length === 0 ? (
            <Text className="text-foreground-muted">
              Optional: connect Peer Hub from web or desktop to coordinate across your team’s
              computers. Local chats and coordination remain available here.
            </Text>
          ) : null}
        </>
      )}
      {status === null ? null : (
        <PeerPluginsSection environmentId={environmentId} label={label} status={status} />
      )}
    </View>
  );
}

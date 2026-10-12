import type { PeerHubStatus } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { APP_VERSION } from "../../../branding";
import { environmentCatalog } from "../../../connection/catalog";
import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
import { useNowMinute } from "../../../hooks/useNowMinute";
import { usePrimaryEnvironment } from "../../../state/environments";
import type { EnvironmentQueryView } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { hubBuild } from "../settings/hubStatus.logic";
import { useOpenPeerSettings } from "../settings/peerSettingsLinks";
import { reportFailure } from "../workFeedback";
import { KnowledgeErrorCard } from "./KnowledgeErrorCard";
import {
  knowledgeErrorView,
  readKnowledgeProblem,
  type KnowledgeErrorAction,
  type KnowledgeErrorFacts,
} from "./knowledgeError.logic";

/**
 * The card for a list of Knowledge to keep that is not there: the request failed, or was never made
 * because the primary environment is not connected. Nothing while the list loads or has loaded.
 * It tells the Hub's failures apart (the server names them), says the Hub is up only when Peer's
 * status holds a sync of it a moment ago, and acts on the card's buttons.
 */
export function KnowledgeProblem({
  workspace,
  status,
  list,
  showingOlder,
}: {
  readonly workspace: string;
  /** The Peer status of the primary environment, once it has loaded. */
  readonly status: PeerHubStatus | null;
  readonly list: Pick<
    EnvironmentQueryView<unknown>,
    "error" | "failure" | "dataUpdatedAt" | "isPending" | "refresh"
  >;
  /** The candidates of an earlier load are still listed under the card. */
  readonly showingOlder: boolean;
}) {
  const primary = usePrimaryEnvironment();
  const connected = primary !== null && primary.connection.phase === "connected";
  const navigate = useNavigate();
  const openSettings = useOpenPeerSettings();
  const retryEnvironment = useAtomCommand(environmentCatalog.retryNow, { reportFailure: false });
  const sync = useAtomCommand(serverEnvironment.peerHubSync, { reportFailure: false });
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({ target: "the error details" });
  const nowMinute = useNowMinute();

  const failure = list.error === null ? null : readKnowledgeProblem(list.failure ?? list.error);
  if (connected && failure === null) return null;

  const build = hubBuild(status?.hub);
  const facts: KnowledgeErrorFacts = {
    environment:
      primary === null
        ? null
        : {
            label: primary.label,
            connecting:
              primary.connection.phase === "connecting" ||
              primary.connection.phase === "reconnecting",
          },
    hub:
      status === null
        ? null
        : {
            url: status.hubUrl,
            version: build?.version ?? null,
            commit: build?.commit ?? null,
            syncedAt: status.lastSyncAt,
            syncError: status.error,
            signedIn: status.signedIn,
          },
    appVersion: APP_VERSION,
    lastLoadedAt: list.dataUpdatedAt > 0 ? list.dataUpdatedAt : null,
    showingOlder,
    now: Date.parse(`${nowMinute}:00.000Z`),
  };
  const view = knowledgeErrorView(
    connected && failure !== null ? failure : { kind: "disconnected" },
    facts,
  );

  const act = (action: KnowledgeErrorAction) => {
    switch (action) {
      case "retry":
        list.refresh();
        return;
      case "copy":
        copyToClipboard(view.copy, undefined);
        return;
      case "hub":
        void openSettings({ kind: "workspace", workspace, section: "hub" });
        return;
      case "signIn":
        // Peer forgets a session the Hub ended when it next syncs: sync now, so the sign-in is
        // there to open.
        void (
          primary === null
            ? Promise.resolve()
            : sync({ environmentId: primary.environmentId, input: {} })
        ).then(() => navigate({ to: "/settings/peer" }));
        return;
      case "reconnect":
        if (primary === null) return;
        void retryEnvironment(primary.environmentId).then((result) => {
          reportFailure("Could not reconnect", result);
        });
        return;
    }
  };

  return (
    <KnowledgeErrorCard view={view} retrying={list.isPending} copied={isCopied} onAction={act} />
  );
}

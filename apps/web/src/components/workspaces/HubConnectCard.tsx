import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { Button } from "../ui/button";
import { dismissHubCard, hubCardStage } from "./hubSignIn.logic";
import { WorkspacePicker, WorkspaceSignIn } from "./WorkspaceAccess";

const StoredDismissals = Schema.Array(Schema.String);

/**
 * The start screen's way into a team Hub while nobody is signed in: the email sign-in inline and
 * what it gives, until "Use Peer without a Hub" puts it away for this environment. Right after
 * signing in, while the person has no organization yet, it offers the organizations to join or
 * found. The sidebar's "Sign in to Peer Hub" stays the way back once it is put away.
 */
export function HubConnectCard({
  environmentId,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
}) {
  const [dismissed, setDismissed] = useLocalStorage(
    "peer:hub-card-dismissed",
    [],
    StoredDismissals,
  );
  const stage = hubCardStage({ status, environmentId, dismissed });
  if (stage === null) return null;
  return (
    <section
      aria-labelledby="peer-hub-card-title"
      className="flex max-w-lg flex-col gap-4 rounded-xl border border-border bg-background p-5"
    >
      <div className="flex flex-col gap-1.5">
        <h2 id="peer-hub-card-title" className="text-base font-semibold text-foreground">
          {stage === "sign-in" ? "Connect your team’s Peer Hub" : "Choose your organization"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {stage === "sign-in"
            ? "Sign in with your work email to see your organizations, the invitations waiting for you and the projects your team shares. Peer works on this computer without it."
            : `Signed in as ${status.email ?? "you"}. Join your team’s organization, accept one founded for you, or create your own.`}
        </p>
      </div>
      {stage === "sign-in" ? (
        <>
          <WorkspaceSignIn environmentId={environmentId} status={status} idPrefix="peer-hub-card" />
          <div>
            <Button
              size="xs"
              variant="ghost-muted"
              onClick={() => setDismissed((current) => dismissHubCard(current, environmentId))}
            >
              Use Peer without a Hub
            </Button>
          </div>
        </>
      ) : (
        <WorkspacePicker environmentId={environmentId} status={status} />
      )}
    </section>
  );
}

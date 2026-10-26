import { foundingWords, pendingFoundings } from "@t3tools/client-runtime/peer-organizations";
import type { EnvironmentId, PeerFounding, PeerHubStatus } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useRelativeTimeTick } from "../settings/settingsLayout";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { useActiveOrganization } from "./organizationChoice";

/**
 * Organizations a hub administrator founded for the signed-in person: "Vocabulift is waiting for
 * you as its owner", with Accept and Decline. Accepting creates it with the person as its owner,
 * syncs and makes it the active organization; an expired offer can only be declined.
 */
export function FoundingOffers({
  environmentId,
  status,
  onAccepted,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly onAccepted?: ((slug: string) => void) | undefined;
}) {
  const foundings = pendingFoundings(status);
  if (foundings.length === 0) return null;
  return (
    <ul aria-label="Organizations waiting for you" className="space-y-2">
      {foundings.map((founding) => (
        <FoundingRow
          key={founding.slug}
          environmentId={environmentId}
          founding={founding}
          onAccepted={onAccepted}
        />
      ))}
    </ul>
  );
}

function FoundingRow({
  environmentId,
  founding,
  onAccepted,
}: {
  readonly environmentId: EnvironmentId;
  readonly founding: PeerFounding;
  readonly onAccepted: ((slug: string) => void) | undefined;
}) {
  const accept = useAtomCommand(serverEnvironment.peerHubAcceptFounding, { reportFailure: false });
  const decline = useAtomCommand(serverEnvironment.peerHubDeclineFounding, {
    reportFailure: false,
  });
  const { choose } = useActiveOrganization();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useRelativeTimeTick(60_000);
  const words = foundingWords(founding, now);
  const answer = async (action: "accept" | "decline") => {
    setBusy(action);
    setError(null);
    const command = action === "accept" ? accept : decline;
    const result = await command({ environmentId, input: { slug: founding.slug } });
    setBusy(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      return;
    }
    if (action === "accept") {
      choose(founding.slug);
      onAccepted?.(founding.slug);
    }
  };
  return (
    <li className="rounded-lg border border-border bg-background px-3 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium break-words">{words.title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{words.detail}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() => void answer("decline")}
          >
            {busy === "decline" ? "Declining…" : "Decline"}
          </Button>
          {words.expired ? null : (
            <Button size="sm" disabled={busy !== null} onClick={() => void answer("accept")}>
              {busy === "accept" ? "Accepting…" : "Accept"}
            </Button>
          )}
        </span>
      </div>
      {error === null ? null : (
        <Alert variant="error" className="mt-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </li>
  );
}

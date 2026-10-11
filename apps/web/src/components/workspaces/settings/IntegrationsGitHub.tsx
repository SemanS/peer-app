/**
 * The GitHub PR checks card of the Integrations page (design artboard 19): whether the checks are
 * on, when GitHub last pinged and what they cover, Setup (the wizard) and Turn off… (a review that
 * lists what goes). It reads GitHub's status from the Hub; a Hub that does not check pull requests
 * says so and offers nothing.
 */
import type { EnvironmentId, PeerGitHubStatus, PeerWorkspaceState } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useState } from "react";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { useRelativeTimeTick } from "../../settings/settingsLayout";
import { Badge } from "../../ui/badge";
import { Button, InlineButton } from "../../ui/button";
import { PeerCard } from "../PeerPageHeader";
import { failureMessage } from "../WorkspaceAccess";
import { GitHubWizard } from "./GitHubWizard";
import { GITHUB_SECRET_MISSING, TURN_OFF_TEXT, githubCardView } from "./integrations.logic";
import { useReviewChanges } from "./useReviewChanges";

export function GitHubChecksCard({
  environmentId,
  workspace,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
}) {
  useRelativeTimeTick(60_000);
  const read = useAtomCommand(serverEnvironment.peerGitHubStatus, { reportFailure: false });
  const [status, setStatus] = useState<PeerGitHubStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);

  const load = () =>
    read({ environmentId, input: { workspace: workspace.slug } }).then((result) => {
      if (result._tag === "Success") {
        setStatus(result.value);
        setError(null);
      } else {
        setError(failureMessage(result));
      }
    });
  // Read once when the card opens; every later read follows what the person does.
  const loadOnOpen = useEffectEvent(() => void load());
  useEffect(() => {
    loadOnOpen();
  }, []);

  const review = useReviewChanges({ scope: "GitHub PR checks", onSaved: () => void load() });
  const view = status === null ? null : githubCardView(status, formatRelativeTimeLabel);

  return (
    <>
      <PeerCard aria-label="GitHub PR checks">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-sm font-semibold text-foreground">GitHub PR checks</h2>
          {view === null ? null : (
            <Badge variant={view.badge.tone} size="lg">
              {view.badge.label}
            </Badge>
          )}
          {view === null || view.meta === "" ? null : (
            <span className="text-xs text-muted-foreground">{view.meta}</span>
          )}
          <div className="ms-auto flex items-center gap-1.5">
            {view?.canSetUp === true ? (
              <Button size="sm" variant="outline" onClick={() => setWizard(true)}>
                Setup
              </Button>
            ) : null}
            {view?.canTurnOff === true ? (
              <Button
                size="sm"
                variant="ghost-destructive"
                onClick={() =>
                  review.open(
                    { kind: "github-disable", workspace: workspace.slug },
                    { context: TURN_OFF_TEXT },
                  )
                }
              >
                Turn off…
              </Button>
            ) : null}
          </div>
        </div>
        {view === null ? (
          error === null ? (
            <p role="status" className="text-sm text-muted-foreground">
              Reading GitHub’s status…
            </p>
          ) : null
        ) : (
          <p className="text-sm text-muted-foreground">{view.description}</p>
        )}
        {view?.secretMissing === true ? (
          <p role="status" className="text-sm text-warning-foreground">
            {GITHUB_SECRET_MISSING}
          </p>
        ) : null}
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive-foreground">
            Could not read GitHub’s status: {error}{" "}
            <InlineButton tone="muted" onClick={() => void load()}>
              Try again
            </InlineButton>
          </p>
        )}
      </PeerCard>
      {wizard && status !== null ? (
        <GitHubWizard
          environmentId={environmentId}
          workspace={workspace}
          status={status}
          onChanged={() => void load()}
          onClose={() => setWizard(false)}
        />
      ) : null}
      {review.dialog}
    </>
  );
}

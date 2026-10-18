/**
 * The GitHub PR checks card of the Integrations page (design artboard 19): where the checks stand
 * in the status language (Off, Needs setup at its step, Connected as of GitHub's last ping, Problem),
 * Setup (the wizard) and Turn off… (a review that lists what goes). It reads GitHub's status from
 * the Hub; a Hub that does not check pull requests says so and offers nothing.
 */
import { VERIFICATION_POLL_MS, verificationReadKey } from "@t3tools/client-runtime/peer/github";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PeerGitHubStatus,
  PeerHubStatus,
  PeerWorkspaceState,
} from "@t3tools/contracts";
import { useEffect, useEffectEvent, useState } from "react";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import {
  CHECKING_LABEL,
  LOADING,
  failedFact,
  readyFact,
  type Fact,
} from "../../settings/connectionFacts";
import { ConnectionBadge, ConnectionStatus } from "../../settings/ConnectionStatus";
import { useRelativeTimeTick } from "../../settings/settingsLayout";
import { Button, InlineButton } from "../../ui/button";
import { PeerCard } from "../PeerPageHeader";
import { failureMessage } from "../WorkspaceAccess";
import { GitHubWizard } from "./GitHubWizard";
import { GITHUB_SECRET_MISSING, TURN_OFF_TEXT, githubCardView } from "./integrations.logic";
import { useReviewChanges } from "./useReviewChanges";

type GitHubAnswers = ReadonlyMap<
  string,
  { readonly status: PeerGitHubStatus | null; readonly error: string | null }
>;

/** The answers with `result` kept for the target it was `asked` for; a failure keeps the status. */
function withAnswer(
  before: GitHubAnswers,
  asked: string,
  result: AtomCommandResult<PeerGitHubStatus, unknown>,
): GitHubAnswers {
  return new Map(before).set(
    asked,
    result._tag === "Success"
      ? { status: result.value, error: null }
      : { status: before.get(asked)?.status ?? null, error: failureMessage(result) },
  );
}

/**
 * GitHub's status for one workspace, read when `target` appears or changes and again on `reload`.
 * `moved` is what the Peer's own status says of the workspace's verification
 * (`verificationReadKey`): applying or removing the `github` block while the page is open changes
 * it, and the status is read again then. GitHub's first ping publishes nothing the Peer could
 * hear, so `waitForPing` asks the Hub every `VERIFICATION_POLL_MS` until one has arrived. The card
 * keeps the status it had while a later read fails; `fact` is what the pages that only tell the
 * connection read (a failure outranks the status it had).
 */
export function useGitHubChecksStatus(
  target: {
    readonly environmentId: EnvironmentId;
    readonly workspace: string;
    readonly moved?: string;
  } | null,
  options: { readonly waitForPing?: boolean } = {},
) {
  const read = useAtomCommand(serverEnvironment.peerGitHubStatus, { reportFailure: false });
  const environmentId = target?.environmentId ?? null;
  const workspace = target?.workspace ?? null;
  const key = environmentId === null || workspace === null ? null : `${environmentId}/${workspace}`;
  // The target and what the Peer's status says of its verification: a read is due when either moves.
  const readKey = key === null ? null : `${key}|${target?.moved ?? ""}`;
  // Answers are kept by the target they were read for, so one that arrives late cannot show up on
  // a target it does not belong to.
  const [answers, setAnswers] = useState<GitHubAnswers>(new Map());

  useEffect(() => {
    if (readKey === null || environmentId === null || workspace === null) return;
    let wanted = true;
    void read({ environmentId, input: { workspace } }).then((result) => {
      if (wanted)
        setAnswers((before) => withAnswer(before, `${environmentId}/${workspace}`, result));
    });
    return () => {
      wanted = false;
    };
  }, [environmentId, read, readKey, workspace]);

  const here = key === null ? undefined : answers.get(key);
  const status = here?.status ?? null;
  const error = here?.error ?? null;
  const fact: Fact<PeerGitHubStatus> =
    error !== null ? failedFact(error) : status === null ? LOADING : readyFact(status);
  const reload = () => {
    if (environmentId === null || workspace === null) return;
    void read({ environmentId, input: { workspace } }).then((result) =>
      setAnswers((before) => withAnswer(before, `${environmentId}/${workspace}`, result)),
    );
  };
  const poll = useEffectEvent(() => {
    if (!document.hidden) reload();
  });
  const waiting =
    options.waitForPing === true &&
    status !== null &&
    status.configured &&
    status.unsupported !== true &&
    status.lastPingAt === null;
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(poll, VERIFICATION_POLL_MS);
    return () => clearInterval(timer);
  }, [waiting]);
  return { status, error, fact, reload };
}

export function GitHubChecksCard({
  environmentId,
  status: hub,
  workspace,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: PeerWorkspaceState;
}) {
  useRelativeTimeTick(60_000);
  const { status, error, reload } = useGitHubChecksStatus(
    {
      environmentId,
      workspace: workspace.slug,
      moved: verificationReadKey(hub, workspace),
    },
    { waitForPing: true },
  );
  const [wizard, setWizard] = useState(false);

  const review = useReviewChanges({ scope: "GitHub PR checks", onSaved: reload });
  const view = status === null ? null : githubCardView(status);

  return (
    <>
      <PeerCard aria-label="GitHub PR checks">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <h2 className="text-sm font-semibold text-foreground">GitHub PR checks</h2>
          <div className="min-w-0 flex-1">
            {view === null ? (
              error === null ? (
                <ConnectionBadge state="off" label={CHECKING_LABEL} />
              ) : null
            ) : (
              <ConnectionStatus
                {...view.connection}
                action={
                  <span className="flex items-center gap-1.5">
                    {view.canSetUp ? (
                      <Button size="sm" variant="outline" onClick={() => setWizard(true)}>
                        {view.setupLabel}
                      </Button>
                    ) : null}
                    {view.canTurnOff ? (
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
                  </span>
                }
              />
            )}
          </div>
        </div>
        {view === null ? null : <p className="text-sm text-muted-foreground">{view.description}</p>}
        {view?.secretMissing === true && view.connection.state !== "problem" ? (
          <p role="status" className="text-sm text-warning-foreground">
            {GITHUB_SECRET_MISSING}
          </p>
        ) : null}
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive-foreground">
            Could not read GitHub’s status: {error}{" "}
            <InlineButton tone="muted" onClick={reload}>
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
          onChanged={reload}
          onClose={() => setWizard(false)}
        />
      ) : null}
      {review.dialog}
    </>
  );
}

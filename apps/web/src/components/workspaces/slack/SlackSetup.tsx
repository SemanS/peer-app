import type { EnvironmentId, PeerSlackAdminResult, PeerWorkspaceState } from "@t3tools/contracts";
import { slackSetupStep } from "@t3tools/client-runtime/peer/slack";
import { useState } from "react";

import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { SlackChoose } from "./SlackChoose";
import { SlackExisting } from "./SlackExisting";
import { SlackFeedback } from "./SlackRow";
import { SlackStepper } from "./SlackStepper";
import { slackCreateFacts, slackSteps, slackStartingFlow } from "./slackSteps.logic";
import { useSlackHints } from "./useSlackHints";
import { useSlackRun } from "./useSlackRun";

type Flow = "choose" | "existing" | "create";

/**
 * An owner’s or admin’s Slack setup while Slack is not connected (design artboards 4a-4c). It opens
 * at the two ways in; once anything is done, in Slack or in Peer, it opens at the first step not
 * done, with a line saying what is next. The Hub’s view decides what is done; what the admin did in
 * Slack is remembered in this browser. When the Hub says Slack is connected and the admin is still
 * here, the stepper says so once.
 */
export function SlackSetup({
  environmentId,
  workspace,
  admin,
  refresh,
  onDone,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: PeerWorkspaceState;
  readonly admin: PeerSlackAdminResult;
  /** Reads the connection again, after each action. */
  readonly refresh: () => void;
  /** The admin read that Slack is connected. */
  readonly onDone: () => void;
}) {
  const { hints, change, clear } = useSlackHints(workspace.slug);
  const { busy, message, error, run } = useSlackRun(refresh);
  const [chosen, setChosen] = useState<Flow | null>(null);
  const steps = slackSteps({
    admin,
    hints,
    workspace,
    ago: formatRelativeTimeLabel,
  });
  const nothingStored = slackSetupStep(admin).step === "create";
  // A connected workspace shows the stepper at its end, whichever way the admin came.
  const flow: Flow =
    steps.current === null ? "create" : (chosen ?? slackStartingFlow(admin, hints));
  const leave = () => {
    clear();
    setChosen("choose");
  };
  const common = { environmentId, workspace, admin, hints, changeHints: change, busy, run };
  const host = slackCreateFacts(admin, workspace.slug).host;
  return (
    <div className="flex flex-col gap-3">
      {flow === "choose" ? (
        <SlackChoose steps={steps} workspaceName={workspace.name} host={host} onPick={setChosen} />
      ) : flow === "existing" ? (
        <SlackExisting {...common} onLeave={leave} onContinue={() => setChosen("create")} />
      ) : (
        <SlackStepper
          {...common}
          steps={steps}
          title={
            hints.openedAt !== null || hints.created || nothingStored
              ? "Create a new Slack app"
              : "Connect Slack"
          }
          onLeave={nothingStored ? leave : null}
          onDone={onDone}
        />
      )}
      <SlackFeedback message={message} error={error} />
    </div>
  );
}

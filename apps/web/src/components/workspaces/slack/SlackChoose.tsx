import { InfoIcon } from "lucide-react";

import { cn } from "../../../lib/utils";
import { InlineButton } from "../../ui/button";
import { SlackStepMark } from "./SlackParts";
import { useOpenExternal } from "./SlackApp";
import {
  SLACK_APPS_URL,
  SLACK_OVERVIEW,
  slackAppListHint,
  type SlackSteps,
} from "./slackSteps.logic";

function Choice({
  title,
  text,
  time,
  onPick,
}: {
  readonly title: string;
  readonly text: string;
  readonly time: string;
  readonly onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex cursor-pointer flex-col gap-1.5 rounded-xl border border-border bg-card p-4 text-start outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="text-sm font-semibold text-foreground">{title}</span>
      <span className="text-sm text-muted-foreground">{text}</span>
      <span className="mt-1 text-xs text-info-foreground">{time} →</span>
    </button>
  );
}

/**
 * Before setup starts (design artboard 4a): the four steps ahead, then the two ways in. An admin who
 * already has a Peer app in Slack should connect it rather than make a second, so the list of their
 * Slack apps is one click away.
 */
export function SlackChoose({
  steps,
  workspaceName,
  host,
  onPick,
}: {
  readonly steps: SlackSteps;
  readonly workspaceName: string;
  /** The Hub the new app would call, for the sentence under "Create a new Slack app". */
  readonly host: string;
  readonly onPick: (flow: "existing" | "create") => void;
}) {
  const { open, failed } = useOpenExternal();
  return (
    <div className="flex flex-col gap-3">
      <ol aria-label="Setup steps" className="grid gap-2 sm:grid-cols-4">
        {SLACK_OVERVIEW.map((step) => {
          const row = steps.rows.find((candidate) => candidate.id === step.id);
          const state = row?.state ?? "later";
          return (
            <li
              key={step.id}
              className={cn(
                "flex flex-col gap-1.5 rounded-lg border p-2.5",
                state === "current"
                  ? "border-warning/40 bg-warning/8"
                  : "border-border bg-muted/20",
              )}
            >
              <span className="flex items-center gap-2">
                <SlackStepMark n={row?.n ?? 1} state={state} />
                <span className="text-sm font-semibold text-foreground">{step.title}</span>
              </span>
              <span className="text-xs text-muted-foreground">{step.sub}</span>
            </li>
          );
        })}
      </ol>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Choice
          title="Connect an existing Slack app"
          text="You or a colleague already made a Peer app in Slack. Check two addresses, copy two values, verify."
          time="About 2 minutes"
          onPick={() => onPick("existing")}
        />
        <Choice
          title="Create a new Slack app"
          text={`Peer opens Slack with the app filled in for ${host}. You install it and copy two values back.`}
          time="About 4 minutes"
          onPick={() => onPick("create")}
        />
      </div>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <InfoIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-info" />
        <span>
          Not sure? Open{" "}
          <InlineButton tone="default" onClick={() => open(SLACK_APPS_URL)}>
            api.slack.com/apps
          </InlineButton>{" "}
          first. {slackAppListHint(workspaceName)}
          {failed ? " Could not open the browser; go to api.slack.com/apps yourself." : ""}
        </span>
      </p>
    </div>
  );
}

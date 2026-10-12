import { ClockIcon, CircleCheckIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../../lib/utils";
import { useEnvironmentQuery } from "../../../state/query";
import { Alert, AlertAction, AlertDescription } from "../../ui/alert";
import { Badge } from "../../ui/badge";
import { Button, InlineButton } from "../../ui/button";
import { slackAtoms } from "./atoms";
import { SlackStepMark } from "./SlackParts";
import {
  StepChannels,
  StepCreate,
  StepSecrets,
  StepVerify,
  type SlackBodyProps,
  type SlackNav,
} from "./SlackStepBodies";
import {
  slackDoneText,
  slackStepAfter,
  slackStepBefore,
  type SlackStepRow,
  type SlackSteps,
} from "./slackSteps.logic";
import type { SlackStepId } from "./slack.logic";

type StepperProps = Omit<SlackBodyProps, "nav"> & {
  readonly steps: SlackSteps;
  /** What the stepper is called: the path the admin took. */
  readonly title: string;
  /** Nothing is stored in the Hub yet, so the admin may go back to the two ways in. */
  readonly onLeave: (() => void) | null;
  /** The admin has read that Slack is connected. */
  readonly onDone: () => void;
};

const BAR: Readonly<Record<SlackStepRow["state"], string>> = {
  done: "bg-success",
  current: "bg-warning",
  later: "bg-muted",
};

/** How far the admin is, a segment for each step. */
function ProgressBar({ rows }: { readonly rows: ReadonlyArray<SlackStepRow> }) {
  return (
    <div aria-hidden className="grid grid-cols-4 gap-1">
      {rows.map((row) => (
        <div key={row.id} className={cn("h-1 rounded-full", BAR[row.state])} />
      ))}
    </div>
  );
}

function StepItem({
  row,
  open,
  onToggle,
  children,
}: {
  readonly row: SlackStepRow;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}) {
  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-4",
        open ? "border-warning/40 bg-card" : "border-border bg-muted/20",
      )}
    >
      <div className="flex items-center gap-3">
        <SlackStepMark n={row.n} state={row.state} />
        <div className="flex min-w-0 flex-1 flex-col">
          {row.state === "later" ? (
            <span className="text-sm font-semibold text-muted-foreground">{row.title}</span>
          ) : (
            <InlineButton className="self-start" aria-expanded={open} onClick={onToggle}>
              {row.title}
            </InlineButton>
          )}
          <span className="text-xs text-muted-foreground">{row.summary}</span>
        </div>
        {open && row.where !== "" ? <Badge variant="secondary">{row.where}</Badge> : null}
      </div>
      {open ? <div className="flex flex-col gap-3 ps-9">{children}</div> : null}
    </li>
  );
}

/**
 * Creating an app, as four numbered steps (design artboard 4b). The step open is the first not done,
 * so an admin who left for Slack comes back to the next one with a line saying what that is. Earlier
 * steps open to be read again, and every step has Back; the Hub’s state moves the stepper on.
 */
export function SlackStepper({ steps, title, onLeave, onDone, ...flow }: StepperProps) {
  const { environmentId, workspace, admin } = flow;
  // A step the admin chose to keep open (coming back, or still reading while in Slack) outranks the
  // first step not done until they go on.
  const [pinned, setPinned] = useState<SlackStepId | null>(null);
  const open = pinned ?? steps.current;
  const channels = useEnvironmentQuery(
    open === "channels"
      ? slackAtoms.channels({ environmentId, input: { workspace: workspace.slug } })
      : null,
  );

  const navFor = (id: SlackStepId): SlackNav => {
    const before = slackStepBefore(id);
    const after = slackStepAfter(id);
    return {
      pin: () => setPinned(id),
      release: () => setPinned(null),
      back: before === null ? null : () => setPinned(before),
      next:
        id === steps.current || after === null
          ? null
          : () => setPinned(after === steps.current ? null : after),
    };
  };

  const body = (row: SlackStepRow) => {
    const props: SlackBodyProps = { ...flow, nav: navFor(row.id) };
    switch (row.id) {
      case "create":
        return <StepCreate {...props} />;
      case "secrets":
        return <StepSecrets {...props} />;
      case "verify":
        return <StepVerify {...props} />;
      case "channels":
        return <StepChannels {...props} channels={channels} />;
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {onLeave === null ? null : (
          <InlineButton className="self-start" tone="muted" onClick={onLeave}>
            ‹ Other ways to connect
          </InlineButton>
        )}
        <div className="flex items-baseline gap-3">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <span className="text-xs text-muted-foreground">{steps.progress}</span>
        </div>
        <ProgressBar rows={steps.rows} />
      </div>
      {steps.resume !== null && pinned === null ? (
        <Alert variant="info" role="status">
          <ClockIcon aria-hidden />
          <AlertDescription>{steps.resume}</AlertDescription>
        </Alert>
      ) : null}
      <ol className="flex flex-col gap-2.5">
        {steps.rows.map((row) => (
          <StepItem
            key={row.id}
            row={row}
            open={open === row.id}
            onToggle={() => setPinned(open === row.id && pinned === row.id ? null : row.id)}
          >
            {body(row)}
          </StepItem>
        ))}
      </ol>
      {steps.current === null ? (
        <Alert variant="success" role="status">
          <CircleCheckIcon aria-hidden />
          <AlertDescription>{slackDoneText(admin, workspace.name)}</AlertDescription>
          <AlertAction>
            <Button size="xs" variant="outline" onClick={onDone}>
              Done
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
    </div>
  );
}

import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";
import type { SlackStepState } from "./slackSteps.logic";

/** Copies a value and says so for a moment. */
export function SlackCopyButton({
  label,
  value,
  text = "Copy",
}: {
  /** What is copied, for screen readers: "Copy events address". */
  readonly label: string;
  readonly value: string;
  readonly text?: string;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 1_500, target: label });
  return (
    <Button
      size="xs"
      variant="outline"
      aria-label={`Copy ${label}`}
      onClick={() => copyToClipboard(value, undefined)}
    >
      {isCopied ? "Copied" : text}
    </Button>
  );
}

const MARK: Readonly<Record<SlackStepState, string>> = {
  done: "bg-success/16 text-success-foreground",
  current: "bg-warning/16 text-warning-foreground",
  later: "bg-muted text-muted-foreground",
};

/** A step's number in a circle, a check once it is done. */
export function SlackStepMark({
  n,
  state,
}: {
  readonly n: number;
  readonly state: SlackStepState;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
        MARK[state],
      )}
    >
      {state === "done" ? <CheckIcon className="size-3.5" /> : n}
    </span>
  );
}

/** A name or address set in type, inside a sentence. */
export function SlackCode({ children }: { readonly children: ReactNode }) {
  return (
    <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  );
}

/** A box on the setup's steps, with the title the box's content answers to. */
export function SlackBox({
  children,
  className,
}: {
  readonly children: ReactNode;
  /** Layout only. */
  readonly className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col gap-2 rounded-lg border border-border bg-card p-3", className)}
    >
      {children}
    </div>
  );
}

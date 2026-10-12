import type { ComponentProps, ReactNode } from "react";

import { cn } from "../../../lib/utils";
import { SettingsRow } from "../../settings/settingsLayout";

/** A row of Slack's settings, whose title may carry a badge beside it. */
export function SlackRow({
  title,
  ...props
}: Omit<ComponentProps<typeof SettingsRow>, "title"> & { readonly title: ReactNode }) {
  return (
    <SettingsRow {...props} title={<span className="flex items-center gap-2">{title}</span>} />
  );
}

/** What a part of the section last did: the line a success leaves, or why the action failed. */
export function SlackFeedback({
  message,
  error,
  inset = false,
}: {
  readonly message: string | null;
  readonly error: string | null;
  /** Between the rows of a settings group, with their padding. */
  readonly inset?: boolean;
}) {
  const padding = inset && "px-3 py-3 sm:px-4";
  if (error !== null) {
    return (
      <p role="alert" className={cn(padding, "text-sm text-destructive-foreground")}>
        {error}
      </p>
    );
  }
  return message === null ? null : (
    <p role="status" className={cn(padding, "text-sm text-muted-foreground")}>
      {message}
    </p>
  );
}

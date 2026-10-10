import type { ComponentProps, ReactNode } from "react";

import { SettingsRow } from "../../settings/settingsLayout";

/** A row under a workspace's Slack row, indented like the projects under a workspace. */
export function SlackRow({
  title,
  ...props
}: Omit<ComponentProps<typeof SettingsRow>, "title"> & { readonly title: ReactNode }) {
  return (
    <SettingsRow {...props} title={<span className="flex items-center gap-2 pl-4">{title}</span>} />
  );
}

/** What a part of the section last did: the line a success leaves, or why the action failed. */
export function SlackFeedback({
  message,
  error,
}: {
  readonly message: string | null;
  readonly error: string | null;
}) {
  if (error !== null) {
    return (
      <p role="alert" className="px-3 py-3 text-sm text-destructive sm:px-4">
        {error}
      </p>
    );
  }
  return message === null ? null : (
    <p role="status" className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
      {message}
    </p>
  );
}

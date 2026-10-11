/**
 * The small parts a project's Capacity and Coordination pages share: a section with its heading,
 * the mark on what the draft changed, who changes what a person only reads, and the line for
 * settings that could not be read.
 */
import { useId, type ReactNode } from "react";

import { Badge } from "../../ui/badge";
import { InlineButton } from "../../ui/button";

/** A section of a project's page: its heading, a line under it, and what it holds. */
export function PageSection({
  title,
  aside,
  description,
  children,
}: {
  readonly title: string;
  /** Beside the heading, quiet: "3 of 50". */
  readonly aside?: ReactNode;
  readonly description?: ReactNode;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2.5">
      <h2 id={headingId} className="flex items-baseline gap-2 text-sm font-semibold">
        {title}
        {aside === undefined ? null : (
          <span className="font-normal text-muted-foreground">{aside}</span>
        )}
      </h2>
      {description === undefined ? null : (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      {children}
    </section>
  );
}

/** What the draft changed and no review has saved yet, beside the thing it changed. */
export function NotSaved() {
  return <Badge variant="info">Not saved</Badge>;
}

/** Who changes what the person only reads, in the Hub's words for its owners ("Booking's leads and admins"). */
export function OwnersNote({ owners }: { readonly owners: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      {owners.charAt(0).toUpperCase()}
      {owners.slice(1)} change this.
    </p>
  );
}

/** Why the settings were not read, and a way to ask again; what the page shows meanwhile is the manifest's. */
export function SettingsReadError({
  project,
  error,
  onRetry,
}: {
  readonly project: string;
  readonly error: string;
  readonly onRetry: () => void;
}) {
  return (
    <p role="alert" className="text-sm text-destructive-foreground">
      Could not read {project}’s settings: {error}{" "}
      <InlineButton tone="muted" onClick={onRetry}>
        Try again
      </InlineButton>
    </p>
  );
}

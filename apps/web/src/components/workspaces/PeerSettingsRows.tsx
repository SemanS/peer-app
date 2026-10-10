import type { ReactNode } from "react";

import { SettingsRow } from "../settings/settingsLayout";
import { Button } from "../ui/button";

/**
 * A row title under a workspace or under one of its projects in Settings → Workspaces, indented
 * like the workspace's own rows (Invite, a project's repositories and Tools).
 */
export function NestedRowTitle({
  under,
  children,
}: {
  readonly under: "workspace" | "project";
  readonly children: ReactNode;
}) {
  return (
    <span
      className={
        under === "workspace" ? "pl-4 text-muted-foreground" : "pl-8 text-muted-foreground"
      }
    >
      {children}
    </span>
  );
}

/**
 * A settings row that reads on demand: Show opens what it holds under the row, Hide folds it.
 * `label` names the row for the button's accessible name.
 */
export function FoldedSettingsRow({
  title,
  label,
  description,
  open,
  busy = false,
  onOpenChange,
  children,
}: {
  readonly title: ReactNode;
  readonly label: string;
  readonly description?: ReactNode;
  readonly open: boolean;
  readonly busy?: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
}) {
  return (
    <SettingsRow
      title={title}
      description={description}
      control={
        <Button
          size="sm"
          variant="outline"
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} ${label}`}
          disabled={busy}
          onClick={() => onOpenChange(!open)}
        >
          {open ? "Hide" : "Show"}
        </Button>
      }
    >
      {open ? <div className="flex flex-col gap-3 pt-2 pb-3">{children}</div> : null}
    </SettingsRow>
  );
}

/** A failure inside a settings row, in the row's text size. */
export function SettingsRowError({ children }: { readonly children: ReactNode }) {
  return (
    <p role="alert" className="text-xs text-destructive">
      {children}
    </p>
  );
}

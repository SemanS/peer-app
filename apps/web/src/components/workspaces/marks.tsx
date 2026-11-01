import type { EnvironmentMachineKind } from "@t3tools/contracts";
import { createContext, type ReactNode, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import type { ProviderInstanceEntry } from "../../providerInstances";

/**
 * A heading in the sidebar's Work view (Needs you, Signals, Tasks, Projects), with
 * whatever counts it beside it.
 */
export function WorkSectionLabel({ children }: { readonly children: ReactNode }) {
  return (
    <p className="flex min-w-0 items-center gap-2 px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
      {children}
    </p>
  );
}

/** Who a thread belongs to: you in the accent color, a colleague in a quiet outline. */
export function PersonMark({ name, mine }: { readonly name: string; readonly mine: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full text-3xs font-semibold",
        mine
          ? "bg-primary text-primary-foreground"
          : "border border-sidebar-border bg-sidebar text-muted-foreground",
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** What a card needs to know of this computer: its provider instances, and its name and kind. */
export interface WorkHere {
  readonly providers: ReadonlyMap<string, ProviderInstanceEntry>;
  readonly label: string | null;
  readonly machine: EnvironmentMachineKind;
}

export const WorkHereContext = createContext<WorkHere>({
  providers: new Map(),
  label: null,
  machine: "laptop",
});

/** Edits a title in place: Enter or leaving the field saves, Escape keeps the old one. */
export function TitleInput({
  value,
  label,
  onDone,
}: {
  readonly value: string;
  readonly label: string;
  /** The edited title, or null when cancelled. */
  readonly onDone: (title: string | null) => void;
}) {
  const [draft, setDraft] = useState(value);
  const finished = useRef(false);
  const finish = (title: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(title);
  };
  return (
    <input
      autoFocus
      value={draft}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          finish(draft);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
        }
      }}
      onBlur={() => finish(draft)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 text-sm font-medium text-card-foreground outline-none focus:border-foreground"
    />
  );
}

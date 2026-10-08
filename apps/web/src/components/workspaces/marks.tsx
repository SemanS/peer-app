import {
  type EnvironmentMachineKind,
  isProviderDriverKind,
  ProviderDriverKind,
} from "@t3tools/contracts";
import { createContext, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { getTriggerDisplayModelLabel } from "../chat/providerIconUtils";
import type { WorkAgent } from "./workTree.logic";

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

/** Harness names agents report, as the drivers whose icons the Threads list draws. */
const HARNESS_DRIVER: Readonly<Record<string, string>> = {
  claude: "claudeAgent",
  "claude-code": "claudeAgent",
  codex: "codex",
  cursor: "cursor",
  "cursor-agent": "cursor",
  opencode: "opencode",
  grok: "grok",
  antigravity: "antigravity",
  pi: "pi",
};

interface AgentLook {
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly accentColor?: string | undefined;
  readonly acpRegistryAgentId?: string | undefined;
  readonly acpRegistryIconUrl?: string | undefined;
  /** The model, as the Threads list names it. */
  readonly model: string | undefined;
}

/** How a thread's agent looks: this computer's provider instance, or a reported harness. */
export function agentLook(
  agent: WorkAgent | undefined,
  providers: ReadonlyMap<string, ProviderInstanceEntry>,
): AgentLook | null {
  if (agent === undefined) return null;
  if ("instanceId" in agent) {
    const entry = providers.get(agent.instanceId);
    if (entry === undefined) return null;
    const model = entry.models.find((candidate) => candidate.slug === agent.model);
    return {
      driverKind: entry.driverKind,
      displayName: entry.displayName,
      accentColor: entry.accentColor,
      acpRegistryAgentId: entry.acpRegistryAgentId,
      acpRegistryIconUrl: entry.acpRegistryIconUrl,
      model: model === undefined ? agent.model : getTriggerDisplayModelLabel(model),
    };
  }
  const name = agent.harness.trim().toLowerCase();
  const slug = HARNESS_DRIVER[name] ?? name;
  return {
    driverKind: isProviderDriverKind(slug) ? slug : ProviderDriverKind.make("agent"),
    displayName: agent.harness,
    model: undefined,
  };
}

/** The agent's mark, where the Threads list draws it. */
export function AgentMark({ look }: { readonly look: AgentLook | null }) {
  if (look === null) return null;
  return (
    <ProviderInstanceIcon
      driverKind={look.driverKind}
      displayName={look.displayName}
      accentColor={look.accentColor}
      acpRegistryAgentId={look.acpRegistryAgentId}
      acpRegistryIconUrl={look.acpRegistryIconUrl}
      iconClassName="size-3.5 opacity-60"
    />
  );
}

/** "17h", "now": when a thread was last active, as the Threads list says it. */
export function activeLabel(at: string | undefined): string | null {
  if (at === undefined) return null;
  const label = formatRelativeTimeLabel(at);
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

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

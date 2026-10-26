import {
  WS_METHODS,
  type EnvironmentId,
  type PeerBriefChecklistItem,
  type PeerBriefLink,
  type PeerOpenSpecReadInput,
  type PeerOpenSpecReadResult,
  type PeerOpenSpecSnapshot,
  type PeerTaskBrief,
} from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { request } from "../rpc/client.ts";
import { createEnvironmentQueryAtomFamily, createEnvironmentRpcCommand } from "../state/runtime.ts";

export function createOpenSpecEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const read = createEnvironmentQueryAtomFamily(runtime, {
    label: "environment-data:peer.openspec.read",
    staleTimeMs: 0,
    idleTtlMs: 0,
    execute: ({ person: _person, ...input }: PeerOpenSpecReadInput & { person: string }) =>
      request(WS_METHODS.peerOpenSpecRead, input),
  });
  return {
    read: (target: {
      readonly environmentId: EnvironmentId;
      readonly person: string;
      readonly input: PeerOpenSpecReadInput;
    }) =>
      read({
        environmentId: target.environmentId,
        input: { ...target.input, person: target.person },
      }),
    /** Link, relink or refresh a task's brief from a change; answers with the task's source. */
    link: createEnvironmentRpcCommand(runtime, {
      label: "peer:openspec:link",
      tag: WS_METHODS.peerOpenSpecLink,
    }),
    /** Keep the brief and drop its link. */
    unlink: createEnvironmentRpcCommand(runtime, {
      label: "peer:openspec:unlink",
      tag: WS_METHODS.peerOpenSpecUnlink,
    }),
    /** Save a person's own brief, which drops any link. */
    saveBrief: createEnvironmentRpcCommand(runtime, {
      label: "peer:openspec:save-brief",
      tag: WS_METHODS.peerOpenSpecSaveBrief,
    }),
  };
}

/** What a person can do about a task's brief in its state; in the order to show them. */
export type BriefAction =
  | { readonly kind: "link"; readonly change: string }
  | { readonly kind: "update" }
  | { readonly kind: "close" }
  | { readonly kind: "relink" }
  | { readonly kind: "relink-mapped"; readonly change: string }
  | { readonly kind: "keep" }
  | { readonly kind: "edit" }
  | { readonly kind: "unlink" }
  | { readonly kind: "write" };

export function briefActions(link: PeerBriefLink | undefined): ReadonlyArray<BriefAction> {
  if (link === undefined || !link.served) return [];
  const mapped: ReadonlyArray<BriefAction> =
    link.mappingDiffers === undefined
      ? []
      : [{ kind: "relink-mapped", change: link.mappingDiffers }];
  switch (link.state) {
    case "proposed":
      return link.proposed === undefined ? [] : [{ kind: "link", change: link.proposed.change }];
    case "none":
      return [{ kind: "write" }];
    case "changed":
      return [{ kind: "update" }, ...mapped, { kind: "unlink" }];
    case "archived":
      return [{ kind: "close" }, ...mapped, { kind: "relink" }, { kind: "keep" }];
    case "missing":
      return [...mapped, { kind: "relink" }, { kind: "keep" }];
    case "unlinked":
      return [{ kind: "edit" }, { kind: "relink" }];
    case "current":
      return [...mapped, { kind: "unlink" }];
    case "unreadable":
      return [];
  }
}

export function briefActionLabel(action: BriefAction): string {
  switch (action.kind) {
    case "link":
      return `Link to ${action.change}`;
    case "update":
      return "Update from OpenSpec";
    case "close":
      return "Close task";
    case "relink":
      return "Link another change";
    case "relink-mapped":
      return `Relink to ${action.change}`;
    case "keep":
      return "Keep as own brief";
    case "edit":
      return "Edit brief";
    case "unlink":
      return "Unlink";
    case "write":
      return "Write a brief";
  }
}

/** One sentence on how the task's brief stands, or null when there is nothing to say. */
export function briefStateText(link: PeerBriefLink | undefined): string | null {
  if (link === undefined) return null;
  const change = link.brief?.source?.change;
  const differs =
    link.mappingDiffers === undefined
      ? ""
      : ` openspec/peer-tasks.json maps this task to ${link.mappingDiffers} instead.`;
  switch (link.state) {
    case "current":
      return differs === "" ? null : `Linked to ${change}.${differs}`;
    case "changed":
      return `${change} was edited after this brief was saved. The agent gets the live change; the saved brief stays until you update it.${differs}`;
    case "archived":
      return `${change} was archived as openspec/changes/archive/${link.archivedAs}. The agent starts from the saved brief.${differs}`;
    case "missing":
      return `${change} no longer exists in the repository. The agent starts from the saved brief.${differs}`;
    case "unlinked":
      return "This is the task's own brief, linked to no OpenSpec change.";
    case "unreadable":
      return "The repository cannot be read on this computer, so the agent starts from the saved brief.";
    case "proposed":
      return link.served
        ? `The repository ${link.proposed?.via === "mapping" ? "maps this task to" : "has a change named like this task:"} ${link.proposed?.change}. Link it to keep a brief that survives when the change moves.`
        : null;
    case "none":
      return null;
  }
}

/** Where the agent's first prompt comes from, as the launch shows it. */
export function promptSourceText(result: PeerOpenSpecReadResult | undefined): string | null {
  if (result === undefined) return null;
  if (result.state === "brief") return "The agent starts from the saved brief.";
  if (result.state === "ready")
    return result.link?.state === "changed"
      ? "The agent starts from the live change, which differs from the saved brief."
      : "The agent starts from the live OpenSpec change.";
  return null;
}

export interface BriefDiff {
  readonly goalChanged: boolean;
  readonly added: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
  /** Items in both, whose done mark changed: `done` is the live mark. */
  readonly toggled: ReadonlyArray<PeerBriefChecklistItem>;
}

/** What "Update from OpenSpec" would change in a saved brief. */
export function briefDiff(brief: PeerTaskBrief, live: PeerOpenSpecSnapshot): BriefDiff {
  const before = new Map(brief.checklist.map((item) => [item.text, item.done]));
  const after = new Map(live.checklist.map((item) => [item.text, item.done]));
  return {
    goalChanged: brief.goal.trim() !== live.goal.trim(),
    added: live.checklist.filter((item) => !before.has(item.text)).map((item) => item.text),
    removed: brief.checklist.filter((item) => !after.has(item.text)).map((item) => item.text),
    toggled: live.checklist.filter(
      (item) => before.has(item.text) && before.get(item.text) !== item.done,
    ),
  };
}

/** A compact source excerpt; callers keep the complete proposal available separately. */
export function openSpecGoal(proposal: string): string {
  const lines = proposal.replace(/\r\n?/g, "\n").trim().split("\n");
  const why = lines.findIndex((line) => /^#{1,6}\s+Why\s*#*\s*$/i.test(line));
  const body = why < 0 ? lines : lines.slice(why + 1);
  const nextHeading = why < 0 ? -1 : body.findIndex((line) => /^#{1,6}\s+/.test(line));
  const section = (nextHeading < 0 ? body : body.slice(0, nextHeading))
    .join("\n")
    .replace(/^(?:\s*#{1,6}[^\n]*\n)+/, "")
    .trim();
  const excerpt = why < 0 ? (section.split(/\n\s*\n/)[0] ?? "") : section;
  return excerpt.length > 1_200 ? `${excerpt.slice(0, 1_199).trimEnd()}…` : excerpt;
}

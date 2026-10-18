/**
 * The Jujutsu workspaces rows of Settings › This computer: how jj stands here in Peer's
 * connection words, and which of the rows can be used.
 */
import {
  jujutsuProblem,
  jujutsuSettingsLine,
  jujutsuWord,
  type JujutsuWord,
} from "@t3tools/client-runtime/peer/jujutsu";
import type { JujutsuState } from "@t3tools/contracts";

export interface JujutsuCardView {
  readonly word: JujutsuWord;
  /** "Connected · jj 0.46.0 · 2 agent workspaces", or the word and the cause. */
  readonly line: string;
  /** Whether the rows under the plugin's own row show: only while the plugin runs. */
  readonly showRows: boolean;
  /** Whether protection can be changed: jj has to be there to write the workspaces' settings. */
  readonly protectionEditable: boolean;
  readonly protection: boolean;
}

export const SNAPSHOT_ROW = {
  title: "Snapshot after every tool step",
  description:
    "Peer runs jj util snapshot in each agent workspace after every tool step, and merges a change that a teammate's rewrite left with two versions. Always on while Jujutsu workspaces is on.",
  status: "Always on",
} as const;

export const PROTECTION_ROW = {
  title: "Each agent's changes are read-only to the other agents",
  description:
    "Peer writes peer_mine(), peer_others() and immutable_heads() into each agent workspace, so jj refuses an agent's rewrite of a change another session made, and Peer stops --ignore-immutable. Teammates' fetched changes are read-only already. Your own default workspace keeps its own settings.",
} as const;

export function jujutsuCard(
  state: JujutsuState | undefined,
  plugin: { readonly active: boolean } | undefined,
): JujutsuCardView {
  const word = jujutsuWord(state);
  const note = jujutsuProblem(state);
  const base = jujutsuSettingsLine(state);
  return {
    word,
    line: note === null ? base : `${base} · ${note.title}`,
    showRows: plugin?.active === true,
    protectionEditable: state?.connection === "connected",
    // The default is on: a status that does not say yet reads as protected.
    protection: state?.protection ?? true,
  };
}

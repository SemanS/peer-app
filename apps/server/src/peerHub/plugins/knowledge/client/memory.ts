// @effect-diagnostics nodeBuiltinImport:off - a path's shape is judged where no Effect runs (a verdict's fallback).
/**
 * A project's word on its agents' harness memory (Claude Code's auto memory: a `MEMORY.md` index
 * loaded at every start and topic files the model writes unasked, per person and repository,
 * reviewed by nobody), and what Peer says and does about it where the project keeps it `off`: the
 * one line a session starts with, and the refusal of a write into that memory at the tool
 * boundary. Where Peer starts the agent itself the environment turns the memory off instead
 * (`hubPolicy.ts`); this is for the sessions Peer only hooks.
 *
 * @module peerHub/plugins/knowledge/client/memory
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { agentMemoryOf, type PeerAgentMemory, type PeerProject } from "@t3tools/contracts";

import type { PeerVerdict } from "../../../core/plugin.ts";

/**
 * Whether `path` lies in a Claude Code auto memory directory: `<config dir>/projects/<slug>/memory/`,
 * where the config dir is `~/.claude`, any `CLAUDE_CONFIG_DIR` given, or any directory named
 * `.claude`. The slug's encoding is not documented, so the shape is matched and never a computed
 * name; a `projects/<x>/memory/` elsewhere (someone's other repository) is not matched.
 */
export function isHarnessMemoryPath(
  path: string,
  configDirs: ReadonlyArray<string | undefined> = [],
): boolean {
  const normalized = NodePath.resolve(path).split(NodePath.sep).join("/");
  const under = (dir: string) => {
    const base = NodePath.resolve(dir).split(NodePath.sep).join("/").replace(/\/+$/, "");
    return normalized.startsWith(`${base}/`) && MEMORY_BELOW.test(normalized.slice(base.length));
  };
  if (configDirs.some((dir) => dir !== undefined && dir !== "" && under(dir))) return true;
  return /\/\.claude\/projects\/[^/]+\/memory\//.test(normalized);
}
const MEMORY_BELOW = /^\/projects\/[^/]+\/memory\//;

/** The policy a project applies: what it does not say is `off`. */
export const memoryPolicyOf = (project: PeerProject | undefined): PeerAgentMemory =>
  project === undefined ? "off" : agentMemoryOf(project);

/** The one line the refused write answers with, naming the three homes. */
export function memoryRefusal(cli: string, person: string): PeerVerdict {
  return {
    decision: "deny",
    reason: `Peer: this project keeps no harness memory. A lesson for the team: \`${cli} capture\` (or kontext's ctx_capture), reviewed when a person promotes it. State: read it from Peer (\`${cli} status\`, \`${cli} current\`). A preference of yours: tell ${person}.`,
  };
}

/** The one line a session on an `off` project starts with; not said again after a compaction. */
export function memoryStartLine(cli: string, person: string): string {
  return `Keep nothing about this project in your harness memory (Claude Code's auto memory is off here). A lesson for the team: \`${cli} capture --kind <decision|convention|learning> --title "<t>" --what "<w>" --why "<y>" [--paths <p>]\`, or kontext's ctx_capture. A preference of yours: tell ${person}.`;
}

/**
 * Whether a checkout pins its agents' harness memory off itself: `autoMemoryEnabled: false` in its
 * committed `.claude/settings.json`, which holds in every session there whether or not Peer runs.
 * A missing or unreadable file is not a pin. Peer reads the file and never writes it.
 */
export async function pinsHarnessMemory(checkout: string): Promise<boolean> {
  try {
    const text = await NodeFSP.readFile(
      NodePath.join(checkout, ".claude", "settings.json"),
      "utf8",
    );
    const settings: unknown = JSON.parse(text);
    return (
      typeof settings === "object" &&
      settings !== null &&
      (settings as { readonly autoMemoryEnabled?: unknown }).autoMemoryEnabled === false
    );
  } catch {
    return false;
  }
}

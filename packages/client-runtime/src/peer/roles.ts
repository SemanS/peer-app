/**
 * The roles plugin's client logic, for web and the phone alike: the RPC atoms a person changes a
 * session's role with, and how a thread's role reads. A review session is labelled "reviewing";
 * where Peer cannot stop its edits (an MCP-only session, or a harness without Peer's edit hooks)
 * the label says the role is advisory.
 *
 * @module peer/roles
 */
import {
  runTaskOf,
  WS_METHODS,
  type PeerHubStatus,
  type PeerRoleRow,
  type PeerRolesThread,
} from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
import { activePlugin } from "./plugins.ts";

/**
 * The plugin's RPC methods as atoms: a project's roles, and the changes a person may make: give a
 * thread or session of theirs the role `review`, clear it, start a review of a task. The Hub
 * refuses what the person may not do, and its answer is the result.
 */
export function createPeerRolesAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer.roles.list",
      tag: WS_METHODS.peerRolesList,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    set: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer.roles.set",
      tag: WS_METHODS.peerRolesSet,
    }),
    clear: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer.roles.clear",
      tag: WS_METHODS.peerRolesClear,
    }),
    startReview: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer.roles.start-review",
      tag: WS_METHODS.peerRolesStartReview,
    }),
  };
}

/** The status a role is read from: the plugin's slice, the MCP-bound sessions and who is looking. */
export type RolesStatusView = Pick<PeerHubStatus, "plugins" | "roles" | "mcp">;

/** Harnesses whose edits and landing steps Peer's hooks deny for a review session. */
const ENFORCED_HARNESSES = new Set(["claude", "claude-code", "codex"]);

/**
 * A herdr agent's thread is known by its session: `herdr:claude:<id>`, after its computer for a
 * colleague's. Coordination, and so a role row, says `claude:<id>`.
 */
export function sessionOfThread(key: string): string | undefined {
  return /(?:^|:)herdr:([^:]+:.+)$/.exec(key)?.[1];
}

/**
 * Whether Peer cannot stop the session's edits: it is bound over MCP only, or its harness has no
 * Peer edit hooks. An unknown harness is not called advisory: Peer's review launcher starts only
 * Claude Code and Codex.
 */
export function isAdvisory(input: {
  readonly session?: string | undefined;
  readonly harness?: string | undefined;
  readonly mcpSessions?: ReadonlyArray<string> | undefined;
}): boolean {
  if (input.session !== undefined && input.mcpSessions?.includes(input.session) === true)
    return true;
  const harness = (input.session?.split(":")[0] ?? input.harness)?.trim().toLowerCase();
  return harness !== undefined && harness !== "" && !ENFORCED_HARNESSES.has(harness);
}

/** A thread's role as its label and the line under it say it. */
export interface ThreadRole {
  readonly role: string;
  /** "reviewing", or "reviewing · advisory" where Peer cannot stop its edits. */
  readonly label: string;
  readonly detail: string;
  readonly advisory: boolean;
  /** Its reported files changed through the shell while it had the role. */
  readonly changedFiles: boolean;
  /** The session the Hub keeps the role of; undefined while only the thread has it. */
  readonly session: string | undefined;
}

/** The label of a role: "reviewing", "reviewing · advisory"; a newer Hub's role by its name. */
export function roleLabel(role: string, advisory: boolean): string {
  const word = role === "review" ? "reviewing" : role;
  return advisory ? `${word} · advisory` : word;
}

/** What the label's detail says of a review session: what Peer stops, and what it cannot. */
export function roleDetail(
  role: string,
  facts: { readonly advisory: boolean; readonly changedFiles: boolean; readonly pending: boolean },
): string {
  const lines =
    role !== "review"
      ? [`This session has the role ${role}.`]
      : [
          facts.advisory
            ? "A review session. Peer cannot stop its edits here; the Hub still refuses its handover."
            : "A review session: Peer denies its edits and landing steps, and the Hub refuses its handover.",
          facts.pending ? "The role takes hold once its agent's session reports." : null,
          facts.changedFiles
            ? "Its files changed through the shell; a review session should revert them."
            : null,
        ];
  return lines.filter((line) => line !== null).join(" ");
}

const rowOf = (status: RolesStatusView, session: string): PeerRoleRow | undefined => {
  for (const project of status.roles?.projects ?? []) {
    const row = project.roles.find((candidate) => candidate.session === session);
    if (row !== undefined) return row;
  }
  return undefined;
};

const threadOf = (status: RolesStatusView, key: string): PeerRolesThread | undefined =>
  status.roles?.threads.find((thread) => thread.thread === key);

/**
 * A thread's role, or undefined: the Hub's row of its session (a herdr agent's), else the role its
 * person gave the thread on this computer, which its sessions take when they report. A colleague's
 * Peer thread names no session, so its role reads on the Team page from the Hub's rows, not here.
 */
export function threadRole(
  status: RolesStatusView | null | undefined,
  thread: { readonly key: string; readonly harness?: string | undefined },
): ThreadRole | undefined {
  if (status === null || status === undefined || !activePlugin(status, "roles")) return undefined;
  const session = sessionOfThread(thread.key);
  const row = session === undefined ? undefined : rowOf(status, session);
  const given = row === undefined ? threadOf(status, thread.key) : undefined;
  const role = row?.role ?? given?.role;
  if (role === undefined) return undefined;
  const advisory = isAdvisory({
    session: row === undefined ? undefined : session,
    harness: thread.harness,
    mcpSessions: status.mcp?.sessions,
  });
  const changedFiles = row?.changedFiles === true;
  return {
    role,
    label: roleLabel(role, advisory),
    detail: roleDetail(role, {
      advisory,
      changedFiles,
      pending: row === undefined && session !== undefined,
    }),
    advisory,
    changedFiles,
    session: row === undefined ? undefined : session,
  };
}

/** Where a thread of this computer's person is reported: its workspace and project, or undefined. */
export function threadPlace(
  status: Pick<PeerHubStatus, "workspaces" | "roles" | "email" | "environmentId"> | null,
  key: string,
): { readonly workspace: string; readonly project: string } | undefined {
  if (status === null) return undefined;
  const given = status.roles?.threads.find((thread) => thread.thread === key);
  if (given !== undefined) return { workspace: given.workspace, project: given.project };
  for (const workspace of status.workspaces) {
    for (const state of workspace.projects) {
      const { work } = state;
      if (
        runTaskOf(work.runs, key) !== undefined ||
        work.threads.some(
          (thread) =>
            thread.id === key &&
            thread.email === status.email &&
            thread.environment === status.environmentId,
        )
      )
        return { workspace: workspace.slug, project: state.project.id };
    }
  }
  return undefined;
}

/** The thread menu's role items: Set role: review on a thread without one, Clear role on one with it. */
export const ROLE_MENU = {
  set: { id: "roles:set-review", label: "Set role: review" },
  clear: { id: "roles:clear", label: "Clear role" },
} as const;

/**
 * The role item of a thread's menu, for its own person on this computer only: a colleague's thread
 * shows its role and offers no way to change it. A thread its computer no longer reports has
 * nothing to give a role to.
 */
export function roleMenuItem(
  thread: {
    readonly mine: boolean;
    readonly localEnvironment?: boolean | undefined;
    readonly stale: boolean;
  },
  role: ThreadRole | undefined,
): (typeof ROLE_MENU)[keyof typeof ROLE_MENU] | null {
  if (!thread.mine || thread.localEnvironment !== true) return null;
  if (role !== undefined) return ROLE_MENU.clear;
  return thread.stale ? null : ROLE_MENU.set;
}

/** Whether Start a review is offered on a task: the plugin is active and the task is not done. */
export function canStartReview(
  status: Pick<PeerHubStatus, "plugins"> | null | undefined,
  task: { readonly done: boolean },
): boolean {
  return !task.done && activePlugin(status, "roles");
}

/**
 * The harness a review starts in: the one the task was last built in, so the review runs in the
 * same tool, else Claude Code. Only Claude Code and Codex enforce a review session's limits.
 */
export function reviewHarness(
  threads: ReadonlyArray<{ readonly harness?: string | undefined }>,
): "claude" | "codex" {
  for (let index = threads.length - 1; index >= 0; index -= 1) {
    const harness = threads[index]?.harness?.trim().toLowerCase();
    if (harness === "claude" || harness === "claude-code") return "claude";
    if (harness === "codex") return harness;
  }
  return "claude";
}

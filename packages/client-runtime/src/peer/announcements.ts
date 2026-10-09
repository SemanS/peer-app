import {
  WS_METHODS,
  type PeerAnnouncementProjectInput,
  type PeerAnnouncementPostInput,
  type PeerAnnouncementAuthor,
  type PeerAnnouncementCounts,
} from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
import { request } from "../rpc/client.ts";
export const announcementCharacterCount = (text: string) => [...text].length;
export type AnnouncementDraft = Omit<PeerAnnouncementPostInput, "workspace" | "project"> & {
  readonly op: string;
};
export const newAnnouncementDraft = (op: string): AnnouncementDraft => ({
  text: "",
  wake: true,
  validForMinutes: 1440,
  op,
});
export function editAnnouncementDraft(
  draft: AnnouncementDraft,
  patch: Partial<AnnouncementDraft>,
  op: string,
): AnnouncementDraft {
  const next = { ...draft, ...patch, op: draft.op };
  return Object.entries(patch).some(
    ([name, value]) => name !== "op" && draft[name as keyof AnnouncementDraft] !== value,
  )
    ? { ...next, op }
    : draft;
}
export function announcementDraftError(draft: AnnouncementDraft): string | null {
  if (!draft.text.trim()) return "Write a message for the agents.";
  if (announcementCharacterCount(draft.text) > 300) return "Use at most 300 characters.";
  return null;
}
export function announcementReach(
  sessions: ReadonlyArray<{
    readonly project: string;
    readonly task?: string | undefined;
    readonly status: string;
    readonly agent?: string | undefined;
  }>,
  project: string,
  task?: string,
) {
  const eligible = sessions.filter(
    (s) => s.project === project && s.status !== "done" && (task === undefined || s.task === task),
  );
  const following = eligible.filter((s) => s.agent === "claude" || s.agent === "codex");
  return {
    following: following.length,
    notFollowing: eligible.length - following.length,
    total: following.length,
    idle: following.filter((s) => s.status === "idle").length,
  };
}
export const receiptLabel = (state: string) =>
  ({
    waiting: "Waiting for a step",
    "not-following": "Not following",
    offered: "Offered to adapter",
    "model-input": "Verified in model input",
    acknowledged: "Acknowledged",
  })[state] ?? state;
export const announcementAuthor = (
  author: PeerAnnouncementAuthor,
  name: (email: string) => string = (email) => email,
) => (author.kind === "credential" ? `${author.label} (automated)` : name(author.email));
export const receiptCounts = (counts: PeerAnnouncementCounts) =>
  Object.entries(counts)
    .map(([state, count]) => `${count} ${receiptLabel(state).toLowerCase()}`)
    .join(" · ");
export const canPollAnnouncement = (visible: boolean, status: string) =>
  visible && status === "active";
export const recentAnnouncements = <A extends { readonly id: string; readonly createdAt: string }>(
  rows: ReadonlyArray<A>,
) =>
  [...rows]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    .slice(0, 10);
export function createAnnouncementsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const query = <
    T extends
      | typeof WS_METHODS.peerAnnouncementsList
      | typeof WS_METHODS.peerAnnouncementsDetail
      | typeof WS_METHODS.peerAnnouncementsCredentials,
  >(
    tag: T,
  ) =>
    createEnvironmentRpcQueryAtomFamily(runtime, {
      label: `environment-data:${tag}`,
      tag,
      staleTimeMs: 0,
      idleTtlMs: 0,
    });
  const command = <
    T extends
      | typeof WS_METHODS.peerAnnouncementsPost
      | typeof WS_METHODS.peerAnnouncementsWithdraw
      | typeof WS_METHODS.peerAnnouncementsCreateCredential
      | typeof WS_METHODS.peerAnnouncementsRevokeCredential
      | typeof WS_METHODS.peerAnnouncementsSetWake,
  >(
    tag: T,
  ) => createEnvironmentRpcCommand(runtime, { label: `environment-data:${tag}`, tag });
  return {
    list: createEnvironmentQueryAtomFamily(runtime, {
      label: "environment-data:peer.announcements.list",
      staleTimeMs: 0,
      idleTtlMs: 0,
      execute: (input: PeerAnnouncementProjectInput & { readonly rev?: string | undefined }) =>
        request(WS_METHODS.peerAnnouncementsList, {
          workspace: input.workspace,
          project: input.project,
        }),
    }),
    detail: query(WS_METHODS.peerAnnouncementsDetail),
    credentials: query(WS_METHODS.peerAnnouncementsCredentials),
    post: command(WS_METHODS.peerAnnouncementsPost),
    withdraw: command(WS_METHODS.peerAnnouncementsWithdraw),
    createCredential: command(WS_METHODS.peerAnnouncementsCreateCredential),
    revokeCredential: command(WS_METHODS.peerAnnouncementsRevokeCredential),
    setWake: command(WS_METHODS.peerAnnouncementsSetWake),
  };
}

export const mayManageAnnouncementCredentials = (projectRole: string, workspaceRole: string) =>
  projectRole === "lead" || workspaceRole === "admin" || workspaceRole === "owner";
export const mayWithdrawAnnouncement = (
  author: PeerAnnouncementAuthor,
  email: string,
  projectRole: string,
  workspaceRole: string,
) =>
  mayManageAnnouncementCredentials(projectRole, workspaceRole) ||
  (author.kind === "person" && author.email === email);
export const announcementReachLine = (reach: ReturnType<typeof announcementReach>) =>
  `Reaches about ${reach.total} live ${reach.total === 1 ? "agent" : "agents"}, ${reach.idle} idle${reach.notFollowing ? `; ${reach.notFollowing} not following` : ""}. Only Claude Code and Codex with Peer’s hooks are reached. Offered is not the same as read.`;

export function announcementTiming(
  row: { readonly createdAt: string; readonly expiresAt: string },
  at: string,
) {
  const now = Date.parse(at);
  const age = Math.max(0, Math.floor((now - Date.parse(row.createdAt)) / 60_000));
  const left = Math.ceil((Date.parse(row.expiresAt) - now) / 60_000);
  const duration = (minutes: number) =>
    minutes >= 1440
      ? `${Math.floor(minutes / 1440)}d`
      : minutes >= 60
        ? `${Math.floor(minutes / 60)}h`
        : `${minutes}m`;
  return `${age ? `${duration(age)} ago` : "just now"} · ${left > 0 ? `${duration(left)} left` : "expired"}`;
}

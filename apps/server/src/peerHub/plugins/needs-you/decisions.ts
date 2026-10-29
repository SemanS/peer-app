import {
  needsYouKey,
  needsYouPushId,
  overlapAttention,
  OVERLAP_ASKED_MS,
  OVERLAP_RECENT_MS,
  STALE_INPUT_WAIT_MS,
  type PeerHubStatus,
  type PeerStaleInput,
  type NeedsYouAlertKind,
} from "@t3tools/contracts";
import type { RelayAgentActivityState } from "@t3tools/contracts/relay";

export interface DecisionPoint {
  readonly id: string;
  readonly kind: NeedsYouAlertKind;
  readonly phase: RelayAgentActivityState["phase"];
  readonly title: string;
  readonly project: string;
  readonly model: string;
  readonly headline: string;
  readonly rank: number;
  readonly since?: string;
}
export const safeTitle = (title: string, fallback = "Peer") => {
  const visible = [...title]
    .map((c) => {
      const cp = c.codePointAt(0)!;
      return cp < 32 || (cp >= 127 && cp <= 159) ? " " : c;
    })
    .join("");
  return [...visible.replace(/\s+/g, " ").trim()].slice(0, 120).join("") || fallback;
};
const projectOf = (status: PeerHubStatus, workspace?: string, project?: string) =>
  status.workspaces
    .find((w) => w.slug === workspace)
    ?.projects.find((p) => p.project.id === project);
const projectName = (status: PeerHubStatus, workspace?: string, project?: string) =>
  projectOf(status, workspace, project)?.project.name ??
  status.workspaces.find((w) => w.slug === workspace)?.name ??
  "Peer";
const taskName = (status: PeerHubStatus, workspace: string, project: string, task?: string) => {
  const found = projectOf(status, workspace, project)?.work.tasks.find((t) => t.id === task);
  return found
    ? found.key
      ? `${found.key} · ${found.title}`
      : found.title
    : projectName(status, workspace, project);
};

/** Only titles and task labels cross the relay boundary; no session labels or context text. */
export function decisionPoints(
  status: PeerHubStatus,
  refusals: ReadonlyArray<PeerStaleInput>,
  now: number,
): ReadonlyArray<DecisionPoint> {
  if (!status.signedIn || status.email === null) return [];
  const result: DecisionPoint[] = [];
  const add = (key: string, point: Omit<DecisionPoint, "id">) =>
    result.push({
      ...point,
      id: needsYouPushId(key)!,
      title: safeTitle(point.title),
      project: safeTitle(point.project),
      model: safeTitle(point.model),
    });
  for (const agent of status.agents.list) {
    if (agent.status !== "blocked" && agent.status !== "done") continue;
    add(needsYouKey.agent(status.environmentId, agent.id), {
      kind: "agent",
      phase: agent.status === "blocked" ? "waiting_for_input" : "completed",
      rank: agent.status === "blocked" ? 1 : 5,
      title: agent.title,
      project: projectName(status, agent.workspace, agent.projectId),
      model: agent.agent ?? "Peer",
      headline: agent.status === "blocked" ? "Agent needs input" : "Agent finished",
    });
  }
  for (const { workspace, request } of status.requests ?? []) {
    if (request.status !== "pending" || request.recipient !== status.email) continue;
    add(needsYouKey.request(workspace, request.id), {
      kind: "request",
      phase: "waiting_for_approval",
      rank: 2,
      title: `Request: ${request.title}`,
      project: projectName(status, workspace, request.project),
      model: "Peer",
      headline: "Teammate request",
      since: request.createdAt,
    });
  }
  const own = status.coordination.sessions.filter((s) => s.local && s.email === status.email);
  if (status.coordination.enabled)
    for (const overlap of status.coordination.overlaps) {
      const atWork = status.coordination.sessions.flatMap((s) =>
        s.workspace === overlap.workspace &&
        s.project === overlap.project &&
        overlap.sessions.includes(s.id)
          ? [s.id]
          : [],
      );
      const phase = overlapAttention(overlap, now, atWork);
      const session = own.find((s) => atWork.includes(s.id) && s.local);
      // Once its agents ended, the overlap is still this person's to close when their agent, or
      // Peer in their name, wrote on it.
      const mine =
        session !== undefined ||
        (atWork.length === 0 && overlap.notes.some((note) => note.email === status.email));
      if (!mine || (phase !== "decide" && phase !== "unanswered")) continue;
      add(needsYouKey.overlap(overlap.workspace, overlap.project, overlap.id), {
        kind: "overlap",
        phase: "waiting_for_approval",
        rank: 3,
        title: `Overlap: ${taskName(status, overlap.workspace, overlap.project, session?.task)}`,
        project: projectName(status, overlap.workspace, overlap.project),
        model: "Peer",
        headline: "Overlap needs a decision",
      });
    }
  for (const refusal of refusals) {
    const session = own.find((s) => s.id === refusal.session);
    if (!session) continue;
    add(needsYouKey.stale(status.environmentId, session.id), {
      kind: "stale",
      phase: "waiting_for_input",
      rank: 4,
      title: `Inputs changed: ${taskName(status, session.workspace, session.project, session.task)}`,
      project: projectName(status, session.workspace, session.project),
      model: session.agent ?? "Peer",
      headline: "Agent must update its inputs",
    });
  }
  return result
    .toSorted(
      (a, b) =>
        a.rank - b.rank ||
        (a.since ?? "").localeCompare(b.since ?? "") ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 25);
}

export function nextWake(
  status: PeerHubStatus,
  refusals: ReadonlyArray<{ readonly since: number; readonly nextAt?: number }>,
  now: number,
): number | null {
  const times = refusals.map((r) => r.nextAt ?? r.since + STALE_INPUT_WAIT_MS);
  if (status.signedIn && status.coordination.enabled)
    for (const overlap of status.coordination.overlaps) {
      if (
        overlap.state !== "open" ||
        !overlap.sessions.some((id) =>
          status.coordination.sessions.some(
            (s) => s.id === id && s.local && s.email === status.email,
          ),
        )
      )
        continue;
      if (overlap.askedAt) times.push(Date.parse(overlap.askedAt) + OVERLAP_ASKED_MS);
      else if (overlap.policy === "ask")
        times.push(
          Math.max(
            Date.parse(overlap.updatedAt),
            Date.parse(overlap.filesAt ?? overlap.updatedAt),
            ...overlap.notes.map((n) => Date.parse(n.at)),
          ) + OVERLAP_RECENT_MS,
        );
    }
  const future = times.filter((at) => at > now && Number.isFinite(at));
  return future.length === 0 ? null : Math.min(...future);
}

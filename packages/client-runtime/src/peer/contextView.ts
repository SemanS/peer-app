import type { PeerContextView, PeerHubStatus } from "@t3tools/contracts";
import type { WorkContextNode } from "./work.ts";
import * as Hash from "effect/Hash";

/** Cache invalidation follows source changes, not heartbeat times or another project's activity. */
export function contextViewRevision(
  status: PeerHubStatus | null,
  workspace: string,
  project: string,
): string {
  if (status === null) return "unavailable";
  const inProject = (entry: { workspace: string; project: string }) =>
    entry.workspace === workspace && entry.project === project;
  const place = status.workspaces.find((entry) => entry.slug === workspace);
  const work = place?.projects.find((entry) => entry.project.id === project);
  return String(
    Hash.string(
      JSON.stringify([
        status.environmentId,
        status.hubUrl,
        status.signedIn,
        status.email,
        status.coordination.enabled,
        workspace === "@local"
          ? status.coordination.local
          : [place?.error, place?.role, work?.project.members],
        work?.work.tasks,
        status.coordination.contexts
          .filter(inProject)
          .map((entry) => [entry.scope, entry.version, entry.epoch, entry.keeper]),
        status.coordination.findings.filter(inProject).map((entry) => [entry.id, entry.decision]),
        status.coordination.sessions
          .filter(inProject)
          .map((entry) => [
            entry.id,
            entry.environment,
            entry.runtimeGeneration,
            entry.task,
            entry.status,
          ]),
        status.coordination.advice
          ?.filter((entry) => inProject(entry) && entry.how === "read")
          .map((entry) => [entry.session, entry.scope, entry.why, entry.at]),
      ]),
    ),
  );
}

/** Archived and Local contexts do not require an active work-board node. */
export function contextFromStatus(
  status: PeerHubStatus,
  workspace: string,
  project: string,
  scope: string,
): WorkContextNode | undefined {
  const context = status.coordination.contexts.find(
    (entry) => entry.workspace === workspace && entry.project === project && entry.scope === scope,
  );
  if (context === undefined) return undefined;
  const state = status.workspaces
    .find((entry) => entry.slug === workspace)
    ?.projects.find((entry) => entry.project.id === project);
  const name = (email: string) =>
    state?.project.members.find((member) => member.email === email)?.name ??
    (email === "local" ? "You" : email);
  const keeper = context.keeper;
  return {
    workspace,
    project,
    scope,
    version: context.version,
    gist: context.gist,
    tokens: Math.ceil(context.bytes / 4),
    updatedAt: context.updatedAt,
    updatedBy: context.updatedBy,
    restoredFrom: context.restoredFrom,
    keeper:
      keeper === undefined
        ? undefined
        : {
            person: name(keeper.email),
            mine:
              keeper.environment === status.environmentId &&
              (keeper.email === "local" || keeper.email === status.email),
            session: keeper.session,
            label: status.coordination.sessions.find(
              (entry) => entry.id === keeper.session && entry.environment === keeper.environment,
            )?.label,
            since: keeper.since,
          },
    reports: status.coordination.findings
      .filter(
        (finding) =>
          finding.workspace === workspace &&
          finding.project === project &&
          (finding.task === undefined ? "project" : `task:${finding.task}`) === scope &&
          finding.decision === undefined,
      )
      .map((finding) => ({
        id: finding.id,
        person: name(finding.email),
        text: finding.text,
        at: finding.at,
      })),
  };
}

export const CONTEXT_INPUT_LABELS = {
  complete: "Recorded inputs are current",
  "revalidation-required": "Recorded inputs need revalidation",
  unavailable: "Input evidence is unavailable",
} as const;

export function currentContextSections(view: PeerContextView) {
  return (
    [
      ["goal", "Goal"],
      ["outcome", "Reported outcome"],
      ["attention", "Needs attention"],
      ["next", "Next step"],
    ] as const
  ).flatMap(([key, title]) =>
    view.current[key].length === 0
      ? []
      : [
          {
            key,
            title,
            values: view.current[key].map((value) => ({
              ...value,
              sources: value.sourceRefs.flatMap((id) => {
                const source = view.sources.find((source) => source.id === id);
                return source === undefined
                  ? []
                  : [`${source.scope}${source.revision === null ? "" : ` @ ${source.revision}`}`];
              }),
            })),
          },
        ],
  );
}

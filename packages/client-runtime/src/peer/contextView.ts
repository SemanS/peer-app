import { contextBlockerText, type PeerContextView, type PeerHubStatus } from "@t3tools/contracts";
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
  complete: "Recorded context versions match",
  "revalidation-required": "Recorded context reads need confirmation",
  unavailable: "Context read history is unavailable",
} as const;

/**
 * What the recorded reads say, in words that keep "nothing was recorded" apart from "nothing was
 * read" and "nothing needed reading".
 */
export function contextEvidence(view: PeerContextView): {
  readonly tone: "neutral" | "success" | "warning";
  readonly label: string;
  readonly detail: string;
} {
  const total = view.inputs.coverage.total;
  const reads = `${total} shared ${total === 1 ? "context" : "contexts"}`;
  if (view.inputs.state === "unavailable")
    return {
      tone: "neutral",
      label: "History unavailable",
      detail:
        "Peer cannot confirm this report’s context read history. This does not establish what the agent did or did not read.",
    };
  if (total === 0)
    return {
      tone: "neutral",
      label: "No reads recorded",
      detail:
        "This report has no recorded shared-context reads. Conversation updates do not create read receipts or verify the agent’s result.",
    };
  if (view.inputs.state === "revalidation-required") {
    const changed = view.inputs.required.some(
      (input) => input.currentRevision !== null && input.currentRevision !== input.revision,
    );
    return {
      tone: "warning",
      label: changed ? "Sources changed" : "Needs confirmation",
      detail: changed
        ? `This report records reads of ${reads}. At least one source has a different current version; the agent needs to review the changes.`
        : `This report records reads of ${reads}, but Peer cannot confirm that all remain current. This alone does not establish that a source changed.`,
    };
  }
  return {
    tone: "success",
    label: "Recorded versions match",
    detail: `The recorded versions of ${reads} still match their sources. This does not verify the agent’s result.`,
  };
}

/** Undecided findings the view knows of, or null when the Hub cannot say. */
export function pendingFindingCount(view: PeerContextView): number | null {
  return view.pendingFindings.availability === "unavailable"
    ? null
    : view.pendingFindings.ids.length + view.pendingFindings.coverage.omittedCount;
}

/** A source as people name it: "Project context · v1" rather than "project @ 1". */
export function sourceTitle(source: PeerContextView["sources"][number]): string {
  const name =
    source.scope === "project"
      ? "Project context"
      : source.scope === "project-aggregate"
        ? "Project overview"
        : source.scope.startsWith("task:")
          ? "Task context"
          : source.scope;
  if (source.kind === "task") return source.scope === "project-aggregate" ? "Task list" : "Task";
  return source.revision === null ? name : `${name} · v${source.revision}`;
}

/** Values from the same sources sit under one source line, in the order the view reports them. */
export function currentContextSections(view: PeerContextView) {
  const label = (id: string) => {
    const source = view.sources.find((source) => source.id === id);
    return source === undefined
      ? []
      : [
          {
            id,
            scope: source.scope,
            revision: source.revision,
            label: `${source.scope}${source.revision === null ? "" : ` @ ${source.revision}`}`,
            title: sourceTitle(source),
          },
        ];
  };
  return (
    [
      ["goal", "Goal"],
      ["outcome", "Reported outcome"],
      ["attention", "Needs attention"],
      ["next", "Next step"],
    ] as const
  ).flatMap(([key, title]) => {
    const groups: {
      key: string;
      sources: ReturnType<typeof label>;
      values: PeerContextView["current"][typeof key][number][];
    }[] = [];
    for (const reported of view.current[key]) {
      // Older servers may include explicit no-blocker prose in attention.
      const text = key === "attention" ? contextBlockerText(reported.text) : reported.text;
      if (text === undefined) continue;
      const value = { ...reported, text };
      const refs = value.sourceRefs.join(":");
      const last = groups.at(-1);
      if (last?.key === refs) last.values.push(value);
      else groups.push({ key: refs, sources: value.sourceRefs.flatMap(label), values: [value] });
    }
    return groups.length === 0 ? [] : [{ key, title, groups }];
  });
}

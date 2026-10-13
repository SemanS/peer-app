// @effect-diagnostics preferSchemaOverJson:off - a view is compared with the last one by its JSON.
/**
 * The Hub's ownership views as this computer last read them, one per workspace: what verdicts,
 * notices and the status go by. A view holds each of the person's projects; a read of one project
 * replaces that project alone.
 *
 * @module peerHub/plugins/ownership/client/views
 */
import type { PeerOwnershipProject, PeerOwnershipView } from "@t3tools/contracts";

/** What a session's verdicts and notices go by: the Hub's last view of its project, and who and where. */
export interface Standing {
  readonly project: PeerOwnershipProject;
  /** The signed-in person, in lower case. */
  readonly person: string;
  /** This computer's id, as the Hub knows it. */
  readonly environment: string;
}

export const makeViews = () => {
  const views = new Map<string, PeerOwnershipView>();
  const project = (workspace: string, id: string): PeerOwnershipProject | undefined => {
    const view = views.get(workspace);
    const found =
      view !== undefined && Object.hasOwn(view.projects, id) ? view.projects[id] : undefined;
    return view === undefined || found === undefined
      ? undefined
      : { workspace, project: id, at: view.at, ...found };
  };
  return {
    project,
    /** Keeps a workspace's view (or one project of it); whether what it says of its projects changed. */
    put: (workspace: string, view: PeerOwnershipView, only?: string): boolean => {
      const before = views.get(workspace);
      const next: PeerOwnershipView =
        only === undefined || before === undefined || !Object.hasOwn(view.projects, only)
          ? view
          : { at: view.at, projects: { ...before.projects, [only]: view.projects[only]! } };
      views.set(workspace, next);
      return JSON.stringify(before?.projects) !== JSON.stringify(next.projects);
    },
    /** Forgets one workspace, or every one. */
    drop: (workspace?: string) =>
      workspace === undefined ? views.clear() : views.delete(workspace),
    /** Forgets every workspace but these; how many it forgot. */
    keep: (workspaces: ReadonlyArray<string>) => {
      const gone = [...views.keys()].filter((workspace) => !workspaces.includes(workspace));
      for (const workspace of gone) views.delete(workspace);
      return gone.length;
    },
    all: (): ReadonlyArray<PeerOwnershipProject> =>
      [...views].flatMap(([workspace, view]) =>
        Object.keys(view.projects).flatMap((id) => project(workspace, id) ?? []),
      ),
  };
};

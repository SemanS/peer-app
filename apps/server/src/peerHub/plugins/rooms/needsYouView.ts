import type { PeerHubStatus } from "@t3tools/contracts";

/**
 * The light status a phone follows (`scope: "needs-you"`): the contract's shape, with what its rooms
 * and the task launcher read, so a phone stays on it whatever churns on the computer.
 */
export function needsYouView(status: PeerHubStatus): PeerHubStatus {
  const ids = new Set(
    status.coordination.overlaps.filter((o) => o.state === "open").flatMap((o) => o.sessions),
  );
  return {
    ...status,
    pendingSignIn: null,
    joinable: [],
    domainOffers: [],
    removedFrom: [],
    workspaceRoot: "",
    sharedThreads: [],
    syncing: false,
    toolTrust: undefined,
    mcp: undefined,
    workspaces: status.workspaces.map((workspace) => ({
      ...workspace,
      projects: workspace.projects.map((project) => ({
        ...project,
        tools: [],
        peers: [],
        work: { ...project.work, threads: [] },
      })),
    })),
    agents: {
      herdr: status.agents.herdr,
      list: status.agents.list
        .filter((a) => a.status === "blocked" || a.status === "done")
        .map(({ id, paneId, agent, title, status, workspace, projectId }) => ({
          id,
          paneId,
          agent,
          title,
          status,
          workspace,
          projectId,
        })),
    },
    github: { cli: false, account: null, signIn: null, error: null },
    coordination: {
      ...status.coordination,
      logPath: "",
      advice: [],
      findings: [],
      contexts: [],
      codexHookHomes: undefined,
      sessions: status.coordination.sessions
        .filter((s) => ids.has(s.id))
        .map(({ id, workspace, project, email, environment, label, agent, task, local }) => ({
          id,
          workspace,
          project,
          email,
          environment,
          label,
          agent,
          task,
          local,
          status: "unknown",
          files: [],
          claims: [],
        })),
    },
  };
}

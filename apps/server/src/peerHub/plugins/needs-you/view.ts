import type { PeerHubStatus } from "@t3tools/contracts";

/** Keep the shared contract so older computers and the task launcher use the same data. */
export function needsYouView(status: PeerHubStatus): PeerHubStatus {
  const ids = new Set([
    ...status.coordination.overlaps.filter((o) => o.state === "open").flatMap((o) => o.sessions),
    ...(status.needsYou?.staleInputs.map((s) => s.session) ?? []),
  ]);
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
    announcements: undefined,
    dependencies: undefined,
    mcp: undefined,
    workspaces: status.workspaces.map((workspace) => ({
      ...workspace,
      companyKnowledge: null,
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
      candidates: [],
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

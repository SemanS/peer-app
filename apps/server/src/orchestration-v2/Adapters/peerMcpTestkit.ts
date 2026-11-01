import { ProjectId, type PeerProject, type ThreadId } from "@t3tools/contracts";
import {
  bindThreadProject,
  setHubPolicyState,
  setPluginMcpProviders,
} from "../../peerHub/hubPolicy.ts";

/** A workspace-bound thread, with an active app-only stdio plugin and no T3 HTTP MCP endpoint. */
export function peerMcpFixture(thread: ThreadId, root = "/workspace") {
  const project: PeerProject = {
    id: "app",
    name: "App",
    role: "member",
    members: [],
    repositories: [],
    tools: [],
  };
  const bound = { workspace: { slug: "acme", name: "Acme" }, project, repositoryPath: root };
  setHubPolicyState({
    projects: new Map([["project-mcp", bound]]),
    roots: new Map([[root, bound]]),
  });
  bindThreadProject(thread, ProjectId.make("project-mcp"));
  setPluginMcpProviders([
    (id, harness) => ({
      peer: {
        transport: "stdio",
        command: "/private/coord/bin/peer",
        args: ["mcp"],
        env: { PEER_THREAD: id, PEER_HARNESS: harness },
      },
    }),
  ]);
  return () => {
    setPluginMcpProviders([]);
    setHubPolicyState(null);
  };
}

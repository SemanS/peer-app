import { type PeerProject, ProjectId, ThreadId } from "@t3tools/contracts";
import { afterEach, assert, describe, it } from "@effect/vitest";

import {
  bindThreadProject,
  claudeHubMcpServers,
  codexHubMcpServers,
  hubInstructionsForThread,
  resolveToolValue,
  setHubPolicyState,
  setWorkspaceToolGate,
  setPluginMcpProviders,
  pluginMcpServers,
  type HubPolicyState,
} from "./hubPolicy.ts";

const ACME = { slug: "acme", name: "Acme" };

function project(): PeerProject {
  return {
    id: "kirkwood",
    name: "Kirkwood",
    role: "member",
    members: [{ email: "ana@acme.test", name: "Ana" }],
    repositories: [{ id: "app", url: "git@example.test:app.git", branch: "main" }],
    tools: [
      {
        id: "kontext",
        name: "kontext",
        mcp: { transport: "stdio", command: "kontext", args: ["mcp"], env: {} },
        requires: [],
      },
      {
        id: "atlassian",
        name: "Atlassian",
        mcp: { transport: "sse", url: "https://mcp.example.test/sse", headers: {} },
        requires: [],
      },
      {
        id: "tracker",
        name: "Tracker",
        mcp: {
          transport: "http",
          url: "https://tracker.example.test/mcp",
          headers: { Authorization: "Bearer ${secret:TRACKER_TOKEN}" },
        },
        requires: [],
      },
    ],
  };
}

function state(projects: ReadonlyArray<readonly [string, PeerProject]>): HubPolicyState {
  const bound = new Map(
    projects.map(([projectId, p]) => [
      projectId,
      { workspace: ACME, project: p, repositoryPath: `/work/acme/${p.id}/app` },
    ]),
  );
  return {
    projects: bound,
    roots: new Map([...bound.values()].map((entry) => [entry.repositoryPath, entry])),
  };
}

afterEach(() => {
  setHubPolicyState(null);
  setPluginMcpProviders([]);
  setWorkspaceToolGate(null);
});

describe("agent tools", () => {
  it("fails closed without the gate and never advertises held tools", () => {
    const thread = ThreadId.make("held");
    setHubPolicyState(state([["t3-kw", project()]]));
    bindThreadProject(thread, ProjectId.make("t3-kw"));
    assert.deepEqual(claudeHubMcpServers(thread), {});
    const previous = process.env.TRACKER_TOKEN;
    process.env.TRACKER_TOKEN = "ambient";
    try {
      setWorkspaceToolGate(({ tool }) =>
        tool.id === "kontext" ? { give: false } : { give: true, secrets: new Map() },
      );
      assert.deepEqual(Object.keys(claudeHubMcpServers(thread)), ["atlassian"]);
    } finally {
      if (previous === undefined) delete process.env.TRACKER_TOKEN;
      else process.env.TRACKER_TOKEN = previous;
    }
  });

  it("resolves project and secret placeholders", () => {
    const context = { projectRoot: "/work/kw", secrets: new Map([["TOKEN", "s3cret"]]) };
    assert.equal(resolveToolValue("${project.root}/x", context), "/work/kw/x");
    assert.equal(resolveToolValue("Bearer ${secret:TOKEN}", context), "Bearer s3cret");
    assert.equal(resolveToolValue("${secret:MISSING}", context), "${secret:MISSING}");
    assert.equal(resolveToolValue("${unknown}", context), "${unknown}");
  });

  it("gives a bound thread its project's tools in each harness's format", () => {
    const threadId = ThreadId.make("thread-1");
    setHubPolicyState(state([["t3-kw", project()]]));
    bindThreadProject(threadId, ProjectId.make("t3-kw"));
    setWorkspaceToolGate(() => ({ give: true, secrets: new Map([["TRACKER_TOKEN", "t0ken"]]) }));
    process.env.TRACKER_TOKEN = "ambient";
    try {
      const claude = claudeHubMcpServers(threadId);
      assert.deepEqual(Object.keys(claude), ["kontext", "atlassian", "tracker"]);
      assert.deepEqual(claude.kontext, {
        type: "stdio",
        command: "kontext",
        args: ["mcp"],
        env: {},
      });
      assert.deepEqual(claude.tracker, {
        type: "http",
        url: "https://tracker.example.test/mcp",
        headers: { Authorization: "Bearer t0ken" },
      });
      // Codex has no SSE transport.
      assert.deepEqual(Object.keys(codexHubMcpServers(threadId)), ["kontext", "tracker"]);
      assert.include(hubInstructionsForThread(threadId), 'Acme project "Kirkwood"');
      // A tool of the project is the person's: Peer says nothing about how to use it.
      assert.notInclude(hubInstructionsForThread(threadId), "kontext");
    } finally {
      delete process.env.TRACKER_TOKEN;
    }
  });

  it("gives threads outside workspace projects nothing", () => {
    const threadId = ThreadId.make("thread-3");
    setHubPolicyState(state([["t3-kw", project()]]));
    bindThreadProject(threadId, ProjectId.make("somewhere-else"));
    assert.deepEqual(claudeHubMcpServers(threadId), {});
    assert.equal(hubInstructionsForThread(threadId), "");
  });
});

describe("plugin MCP servers", () => {
  it("gives bound threads active provider contributions only", () => {
    const thread = ThreadId.make("peer-mcp-bound");
    setHubPolicyState(state([["t3-kw", project()]]));
    bindThreadProject(thread, ProjectId.make("t3-kw"));
    setPluginMcpProviders([
      (id, harness) =>
        ["claude", "codex"].includes(harness)
          ? {}
          : {
              peer: {
                transport: "stdio",
                command: "/peer",
                args: ["mcp"],
                env: { PEER_THREAD: id, PEER_HARNESS: harness },
              },
            },
    ]);
    assert.deepStrictEqual(pluginMcpServers(thread, "cursor"), {
      peer: {
        transport: "stdio",
        command: "/peer",
        args: ["mcp"],
        env: { PEER_THREAD: thread, PEER_HARNESS: "cursor" },
      },
    });
    assert.deepStrictEqual(pluginMcpServers(thread, "claudeAgent"), {});
    assert.deepStrictEqual(pluginMcpServers(thread, "codex"), {});
    assert.deepStrictEqual(pluginMcpServers(ThreadId.make("unbound"), "cursor"), {});
    setPluginMcpProviders([]);
    assert.deepStrictEqual(pluginMcpServers(thread, "cursor"), {});
  });
});

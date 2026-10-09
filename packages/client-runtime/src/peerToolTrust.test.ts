import { describe, expect, it } from "@effect/vitest";
import { ProjectId, type PeerProject } from "@t3tools/contracts";
import { toolTrustReview, toolTrustNeedsYouCount, toolTrustPermissions } from "./peerToolTrust.ts";
const local: PeerProject = {
  id: "app",
  name: "App",
  role: "member",
  members: [],
  repositories: [],
  knowledge: { kontext: false, company: false },
  capacity: { personal: "any", personalHarnesses: [] },
  tools: [
    {
      id: "stdio",
      name: "Local",
      requires: [],
      mcp: {
        transport: "stdio",
        command: "kontext",
        args: ["mcp"],
        env: { KONTEXT_DIR: "${project.root}" },
      },
    },
    {
      id: "tracker",
      name: "Tracker",
      requires: [],
      mcp: {
        transport: "http",
        url: "https://tracker.test",
        headers: { Authorization: "hidden ${secret:TOKEN}" },
      },
    },
    {
      id: "events",
      name: "Events",
      requires: [],
      mcp: { transport: "sse", url: "https://events.test", headers: {} },
    },
  ],
};
const status = {
  workspaces: [
    {
      slug: "acme",
      name: "Acme",
      projects: [
        {
          project: local,
          repositories: [
            {
              id: "repo",
              url: "https://repo.test",
              branch: "main",
              path: "/app",
              state: "ready" as const,
              projectId: ProjectId.make("local"),
            },
          ],
        },
      ],
    },
  ],
  toolTrust: {
    workspaces: [
      {
        workspace: "acme",
        appliedBy: "ana",
        appliedAt: "now",
        tools: [
          { tool: "stdio", fingerprint: "fp1", state: "review" as const, projects: ["app"] },
          {
            tool: "tracker",
            fingerprint: "fp2",
            state: "secret" as const,
            projects: ["app"],
            missing: ["TOKEN"],
          },
          { tool: "events", fingerprint: "fp3", state: "off" as const, projects: ["app"] },
        ],
        secrets: [{ name: "TOKEN", source: "missing" as const, environmentSet: true }],
      },
    ],
  },
};
describe("workspace tool review", () => {
  it("shows templates and providers while omitting remote header values", () => {
    const rows = toolTrustReview(status)[0]!.tools;
    expect(rows[0]!.review).toEqual({
      transport: "stdio",
      command: "kontext",
      args: ["mcp"],
      env: [["KONTEXT_DIR", "${project.root}"]],
    });
    expect(rows[1]!.review).toEqual({
      transport: "http",
      url: "https://tracker.test",
      headers: [{ name: "Authorization", secrets: ["TOKEN"] }],
    });
    expect(rows[2]!.providers).toEqual(["Claude"]);
    expect(rows[1]!.providers).toEqual(["Claude", "Codex"]);
    expect(JSON.stringify(rows)).not.toContain("hidden");
    expect(toolTrustReview(status)[0]!.appliedBy).toBe("ana");
  });
  it("counts only waiting definitions used by opened projects and groups identical variants", () => {
    expect(toolTrustNeedsYouCount(status)).toBe(2);
    expect(
      toolTrustNeedsYouCount({
        ...status,
        workspaces: status.workspaces.map((w) => ({
          ...w,
          projects: w.projects.map((p) => ({ ...p, repositories: [] })),
        })),
      }),
    ).toBe(0);
    const shared = {
      ...status,
      workspaces: status.workspaces.map((w) => ({
        ...w,
        projects: [
          ...w.projects,
          { ...w.projects[0]!, project: { ...local, id: "other", name: "Other" } },
        ],
      })),
      toolTrust: {
        workspaces: status.toolTrust.workspaces.map((w) => ({
          ...w,
          tools: w.tools.map((t) => ({ ...t, projects: ["app", "other"] })),
        })),
      },
    };
    expect(toolTrustReview(shared)[0]!.tools).toHaveLength(3);
    expect(toolTrustReview(shared)[0]!.tools[0]!.projects).toEqual(["App", "Other"]);
  });
  it("requires authenticated owner scope to approve and operate scope to turn off", () => {
    expect(
      toolTrustPermissions({ authenticated: true, scopes: ["orchestration:operate"] }),
    ).toEqual({ approve: false, turnOff: true });
    expect(toolTrustPermissions({ authenticated: true, scopes: ["access:write"] })).toEqual({
      approve: true,
      turnOff: false,
    });
    expect(toolTrustPermissions({ authenticated: false, scopes: ["access:write"] }).approve).toBe(
      false,
    );
  });
});

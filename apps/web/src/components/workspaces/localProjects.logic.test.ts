import { describe, expect, it } from "vite-plus/test";
import { selectLocalProjects } from "./localProjects.logic";

const projects = [
  {
    id: "pitchplace",
    environmentId: "here",
    title: "pitchplace",
    workspaceRoot: "/scratch/pitchplace",
  },
  {
    id: "extractor",
    environmentId: "here",
    title: "extractor",
    workspaceRoot: "/scratch/extractor",
  },
  { id: "shared", environmentId: "here", title: "Team", workspaceRoot: "/team" },
  { id: "scratch", environmentId: "here", title: "No project", workspaceRoot: "/scratch" },
  { id: "remote", environmentId: "elsewhere", title: "Remote", workspaceRoot: "/remote" },
];

describe("local projects in Work", () => {
  it("shows registered clones without sharing them and excludes the scratch container", () => {
    expect(
      selectLocalProjects(projects, "here", "/scratch", new Set(["shared"])).map(
        (project) => project.id,
      ),
    ).toEqual(["extractor", "pitchplace"]);
  });
  it("works before signing in to a team and deduplicates identical workspace roots", () => {
    expect(
      selectLocalProjects(
        [...projects, { ...projects[0]!, id: "duplicate" }],
        "here",
        "/scratch",
        new Set(),
      ).map((project) => project.id),
    ).toEqual(["extractor", "pitchplace", "shared"]);
  });
  it("shows no projects for a disconnected environment", () => {
    expect(selectLocalProjects(projects, null, "/scratch", new Set())).toEqual([]);
  });
  it("does not show another registration of an already shared checkout", () => {
    expect(
      selectLocalProjects(
        [...projects, { ...projects[2]!, id: "alias", workspaceRoot: "/team/" }],
        "here",
        "/scratch",
        new Set(["shared"]),
      ).map((project) => project.id),
    ).toEqual(["extractor", "pitchplace"]);
  });
});

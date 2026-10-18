import { describe, expect, it } from "vite-plus/test";
import { selectSubjects, pairsOf } from "./subjects.ts";
const input = {
  workspace: "acme",
  project: "app",
  repository: "api",
  base: "release",
  email: "ana@test",
  environment: "laptop",
  teammates: false,
  local: [],
  remote: [],
  tasks: [],
};
const thread = (branch: string) => ({
  id: branch,
  project: "app",
  repository: "api",
  title: branch,
  status: "working" as const,
  source: "peer" as const,
  branch,
});
describe("forecast subjects", () => {
  it("filters completed and trunk work, deduplicates branches and ranks local before remote", () => {
    const local = [
      ...Array.from({ length: 10 }, (_, i) => thread(`feature/${i}`)),
      thread("feature/0"),
      ...["main", "master", "trunk", "develop", "release", "-unsafe"].map(thread),
    ];
    const result = selectSubjects({ ...input, local });
    expect(result.subjects).toHaveLength(8);
    expect(result.skipped).toBe(2);
    expect(pairsOf(result.subjects)).toHaveLength(28);
    expect(pairsOf(result.subjects)).toEqual(pairsOf(result.subjects));
    const remote = [
      {
        ...thread("feature/remote"),
        email: "bob@test",
        environment: "other",
        seenAt: "2026-10-09",
      },
    ];
    expect(
      selectSubjects({ ...input, local: [thread("feature/a")], remote }).subjects,
    ).toHaveLength(1);
    const selected = selectSubjects({
      ...input,
      teammates: true,
      local: [thread("feature/a")],
      remote,
    }).subjects;
    expect(selected.map((s) => s.where)).toEqual(["here", "origin"]);
    expect(pairsOf(selected)[0]?.b.ref).toBe("refs/peer/forecast/feature/remote");
    expect(pairsOf(selected.map((s) => ({ ...s, where: "origin" as const })))).toEqual([]);
  });
  it("drops done tasks and merged/closed delivery, including the local thread's ledger state", () => {
    const local = [
      { ...thread("feature/a"), task: "done" },
      thread("feature/b"),
      thread("feature/c"),
    ];
    const remote = [
      {
        ...thread("feature/b"),
        delivery: "merged" as const,
        email: input.email,
        environment: input.environment,
        seenAt: "now",
      },
      {
        ...thread("feature/c"),
        delivery: "closed" as const,
        email: input.email,
        environment: input.environment,
        seenAt: "now",
      },
    ];
    expect(
      selectSubjects({
        ...input,
        local,
        remote,
        tasks: [{ id: "done", status: "done" as const, title: "Done" }],
      }).subjects,
    ).toEqual([]);
  });
  it("pairs a teammate's work with another teammate's only for the preview, within the same limits", () => {
    const remote = ["a", "b", "c"].map((name) => ({
      ...thread(`feature/${name}`),
      email: "bob@test",
      environment: "other",
      seenAt: "2026-10-09",
    }));
    const selected = selectSubjects({
      ...input,
      teammates: true,
      local: [thread("feature/mine")],
      remote,
    }).subjects;
    expect(pairsOf(selected)).toHaveLength(3);
    expect(pairsOf(selected, { team: true })).toHaveLength(6);
    expect(pairsOf(selected.filter((s) => s.where === "origin"))).toEqual([]);
    expect(
      pairsOf(
        selected.filter((s) => s.where === "origin"),
        { team: true },
      ),
    ).toHaveLength(3);
    const many = selectSubjects({
      ...input,
      local: Array.from({ length: 10 }, (_, i) => thread(`feature/${i}`)),
    }).subjects;
    expect(pairsOf(many, { team: true })).toHaveLength(28);
  });
});

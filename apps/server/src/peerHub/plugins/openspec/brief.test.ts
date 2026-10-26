// @effect-diagnostics nodeBuiltinImport:off - isolated OpenSpec repository fixtures.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import type { PeerTask } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { PeerSessionView } from "../../core/plugin.ts";
import { briefCommand } from "./brief.ts";

const task = (id: string): PeerTask => ({
  id,
  title: "Feature",
  status: "open",
  createdBy: "ana@team.test",
  createdAt: "now",
  updatedAt: "now",
});
const repository = { id: "repo", url: "url", branch: "main" };

it.effect(
  "discovers changes in an empty project and links only the task returned by creation",
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-brief-plan-"))),
        (root) => Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true })),
      );
      yield* Effect.promise(async () => {
        const dir = NodePath.join(root, "openspec/changes/feature");
        await NodeFSP.mkdir(dir, { recursive: true });
        await NodeFSP.writeFile(
          NodePath.join(dir, "proposal.md"),
          "# Feature\n\n## Why\nA useful feature.",
        );
        await NodeFSP.writeFile(NodePath.join(dir, "tasks.md"), "- [ ] Build it");
      });
      let tasks: ReadonlyArray<PeerTask> = [];
      const links: Array<string> = [];
      const services: Parameters<typeof briefCommand>[0] = {
        state: {
          project: () =>
            Effect.succeed({
              workspace: { slug: "team" },
              project: { id: "app", repositories: [repository] },
            }),
          read: Effect.succeed({ persisted: {} }),
          checkoutPath: () => root,
        } as never,
        work: {
          tasks: () => Effect.sync(() => tasks),
          createTask: () =>
            Effect.sync(() => {
              tasks = [task("other-person"), task("mine")];
              return { createdTask: tasks[1]! };
            }),
        } as never,
        openspec: {
          link: (input: { taskId: string }) =>
            Effect.sync(() => {
              links.push(input.taskId);
              return {};
            }),
        } as never,
      };
      const command = briefCommand(services);
      const session = {
        id: "test-empty-project",
        workspace: "team",
        project: "app",
      } as PeerSessionView;
      const run = (args: ReadonlyArray<string>, selected?: string) =>
        command.run({ session, args, flag: () => selected } as never);
      expect(yield* run(["plan"])).toContain("b1 create");
      expect(yield* run(["apply", "b1"])).toContain("created and linked task id:mine");
      expect(links).toEqual(["mine"]);
      tasks = [];
      expect(yield* run(["plan", "--repository", "repo"], "repo")).toContain("b1 create");
    }).pipe(Effect.scoped),
);

it.effect("asks for a repository when an empty project is ambiguous", () =>
  Effect.gen(function* () {
    const command = briefCommand({
      state: {
        project: () =>
          Effect.succeed({
            project: { repositories: [repository, { ...repository, id: "other" }] },
          }),
      } as never,
      work: { tasks: () => Effect.succeed([]) } as never,
      openspec: {} as never,
    });
    const result = yield* command
      .run({
        session: { id: "ambiguous", workspace: "team", project: "app" },
        args: ["plan"],
        flag: () => undefined,
      } as never)
      .pipe(Effect.result);
    expect(result._tag).toBe("Failure");
    expect(JSON.stringify(result)).toContain("choose a repository");
  }),
);

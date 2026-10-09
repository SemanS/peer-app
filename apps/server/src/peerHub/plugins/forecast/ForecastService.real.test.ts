// @effect-diagnostics nodeBuiltinImport:off - uses only disposable clones and a private bare origin.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { coreLayer, paymentsSeed, seedState } from "../../core/testkit.ts";
import { PeerState } from "../../core/state/PeerState.ts";
import * as VcsProcess from "../../../vcs/VcsProcess.ts";
import { createGit } from "./git.ts";
import { makeForecast } from "./ForecastService.ts";
const git = (cwd: string, ...args: string[]) =>
  NodeChildProcess.execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
describe("forecast real local service", () => {
  it.live(
    "predicts a conflict and a clean pair in two clones, explicitly fetches one teammate branch, and leaves all original objects unchanged",
    () =>
      Effect.gen(function* () {
        const dir = yield* Effect.promise(async () =>
            NodeFSP.realpath(
              await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "forecast-real-")),
            ),
          ),
          source = NodePath.join(dir, "source"),
          origin = NodePath.join(dir, "origin.git"),
          one = NodePath.join(dir, "one"),
          two = NodePath.join(dir, "two");
        yield* Effect.promise(() => NodeFSP.mkdir(source));
        git(source, "init", "-qb", "main");
        const body = (first: string, last: string) => `${first}\n${"same\n".repeat(25)}${last}\n`;
        const commit = () => {
          git(source, "add", ".");
          git(
            source,
            "-c",
            "user.name=Ana",
            "-c",
            "user.email=ana@test",
            "commit",
            "-qm",
            "change",
          );
          return git(source, "rev-parse", "HEAD");
        };
        try {
          yield* Effect.promise(() =>
            NodeFSP.writeFile(NodePath.join(source, "pay.ts"), body("first", "last")),
          );
          const base = commit();
          for (const [name, first, last] of [
            ["feature/a", "A", "last"],
            ["feature/b", "B", "last"],
            ["feature/clean-a", "A", "last"],
            ["feature/clean-b", "first", "B"],
          ]) {
            git(source, "checkout", "-qb", name!, base);
            yield* Effect.promise(() =>
              NodeFSP.writeFile(NodePath.join(source, "pay.ts"), body(first!, last!)),
            );
            commit();
          }
          git(source, "clone", "--bare", "-q", source, origin);
          git(source, "clone", "-q", origin, one);
          git(source, "clone", "-q", origin, two);
          git(one, "branch", "feature/a", "origin/feature/a");
          git(two, "branch", "feature/clean-a", "origin/feature/clean-a");
          const before = [git(one, "count-objects", "-v"), git(two, "count-objects", "-v")];
          yield* Effect.gen(function* () {
            const core = yield* Layer.build(
                coreLayer(yield* seedState(paymentsSeed("https://hub.invalid"))),
              ),
              state = Context.get(core, PeerState);
            yield* state.updatePersisted((p) => ({
              ...p,
              localCheckouts: { "acme/pay/api": one, "acme/pay/other": two },
              workspaces: p.workspaces.map((w) => ({
                ...w,
                manifest:
                  w.manifest === null
                    ? null
                    : {
                        ...w.manifest,
                        projects: w.manifest.projects.map((project) => ({
                          ...project,
                          repositories: [
                            ...project.repositories,
                            { id: "other", url: origin, branch: "main" },
                          ],
                        })),
                      },
              })),
            }));
            const local = (repository: string, branch: string) => ({
              id: branch,
              project: "pay",
              repository,
              branch,
              title: branch,
              status: "working" as const,
              source: "peer" as const,
            });
            yield* state.updateRuntime((s) => ({
              ...s,
              localThreads: new Map([
                [
                  "acme",
                  [
                    local("api", "feature/a"),
                    local("other", "feature/clean-a"),
                    local("other", "feature/clean-b"),
                  ],
                ],
              ]),
              work: new Map([
                [
                  "acme/pay",
                  {
                    areas: [],
                    tasks: [],
                    threads: [
                      {
                        id: "remote",
                        repository: "api",
                        branch: "feature/b",
                        title: "B",
                        status: "working" as const,
                        source: "peer" as const,
                        email: "bob@test",
                        environment: "desktop",
                        seenAt: "2026-10-09T12:00:00Z",
                      },
                    ],
                  },
                ],
              ]),
            }));
            const real = yield* VcsProcess.VcsProcess,
              calls: VcsProcess.VcsProcessInput[] = [];
            const vcs = VcsProcess.VcsProcess.of({
                run: (input) => {
                  calls.push(input);
                  return real.run(input);
                },
              }),
              scratch = NodePath.join(state.hubHome, "coord", "forecast"),
              forecast = yield* makeForecast(state, createGit(vcs, scratch), () => Effect.void);
            yield* forecast.boot;
            yield* forecast.configure({ teammates: true });
            yield* forecast.round();
            expect((yield* forecast.read).pairs).toHaveLength(1);
            expect((yield* forecast.pairs).filter((p) => p.result?.state === "clean")).toHaveLength(
              1,
            );
            expect(calls.filter((c) => c.args.includes("fetch"))).toHaveLength(1);
            expect(yield* Effect.promise(() => NodeFSP.readdir(scratch))).toEqual([]);
            expect([git(one, "count-objects", "-v"), git(two, "count-objects", "-v")]).toEqual(
              before,
            );
          }).pipe(
            Effect.scoped,
            Effect.provide(VcsProcess.layer.pipe(Layer.provideMerge(NodeServices.layer))),
          );
        } finally {
          yield* Effect.promise(() => NodeFSP.rm(dir, { recursive: true, force: true }));
        }
      }),
  );
});

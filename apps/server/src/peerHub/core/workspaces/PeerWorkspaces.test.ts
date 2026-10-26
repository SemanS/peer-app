// @effect-diagnostics nodeBuiltinImport:off - a checkout cloned into a temporary directory.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, describe, it } from "@effect/vitest";
import { ProjectId, type PeerHubStatus, type PeerPluginId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import { vi } from "vite-plus/test";

import * as ProjectService from "../../../project/ProjectService.ts";
import * as PeerHubClient from "../hub/PeerHubClient.ts";
import { bindPlugin, type PeerContributions, type PeerPluginEntry } from "../plugin.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import * as PeerState from "../state/PeerState.ts";
import * as PeerStatus from "../status/PeerStatus.ts";
import {
  bareRepository,
  coreLayer,
  emptyT3,
  meAnswer,
  seedState,
  signedInSeed,
  standInHub,
  type HubAnswer,
} from "../testkit.ts";
import * as PeerAgents from "../coordination/PeerAgents.ts";
import { brokerFixture } from "../broker/testkit.ts";
import * as PeerWorkspaces from "./PeerWorkspaces.ts";

afterEach(() => vi.unstubAllEnvs());

const coordination: PeerHubStatus["coordination"] = {
  enabled: false,
  policy: "coordinate",
  claudeHooks: false,
  logPath: "/tmp/coordination.jsonl",
  sessions: [],
  overlaps: [],
  findings: [],
  contexts: [],
  candidates: [],
};

/** Acme's manifest: a Payments project whose one repository is at `url`. */
const manifest = (url: string) => ({
  version: 2,
  workspace: { slug: "acme", name: "Acme", currency: "EUR" },
  member: { email: "ana@acme.test", name: "Ana", role: "member" },
  knowledge: {},
  projects: [
    {
      id: "pay",
      name: "Payments",
      role: "lead",
      members: [],
      repositories: [{ id: "api", url, branch: "main" }],
      knowledge: { kontext: false, company: false },
      tools: [],
      capacity: { personal: "any", personalHarnesses: [] },
    },
  ],
});

/** A Hub that knows Ana in acme and serves acme's manifest for a repository at `url`. */
const acmeHub =
  (url: string): HubAnswer =>
  (path) =>
    path === "/v1/me"
      ? [200, meAnswer()]
      : path === "/v1/workspaces/acme/manifest"
        ? [200, manifest(url)]
        : path === "/v1/workspaces/acme/work"
          ? [200, { projects: {} }]
          : [200, {}];

/** A plugin that only contributes what `contribute` makes with core in reach. */
const plugin = (
  id: PeerPluginId,
  contribute: Effect.Effect<PeerContributions, never, PeerHubClient.PeerHubClient>,
): PeerPluginEntry =>
  bindPlugin({
    id,
    title: id,
    summary: "A plugin for tests.",
    defaultEnabled: true,
    layer: Layer.empty,
    make: contribute,
  });

/** A project open on this computer, as T3 knows it. */
interface LocalProject {
  readonly id: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
}

/**
 * Core signed in to a stand-in Hub for a repository at `url`, its checkouts under `root`, with
 * `local` the projects open on this computer.
 */
const started = (
  url: string,
  options: {
    readonly plugins?: ReadonlyArray<PeerPluginEntry>;
    readonly root?: string;
    readonly local?: ReadonlyArray<LocalProject>;
    readonly answer?: HubAnswer;
  } = {},
) =>
  Effect.gen(function* () {
    if (options.root !== undefined) vi.stubEnv("PEER_WORKSPACE", options.root);
    const hub = yield* standInHub({ current: options.answer ?? acmeHub(url) });
    const opened: Array<string> = [];
    const local = options.local ?? [];
    const t3 = Layer.merge(
      emptyT3,
      Layer.mock(ProjectService.ProjectService)({
        getById: (id) =>
          Effect.succeed(Option.fromNullishOr(local.find((p) => p.id === id)) as never),
        getByWorkspaceRoot: (root) =>
          Effect.succeed(
            Option.fromNullishOr(local.find((p) => p.workspaceRoot === root)) as never,
          ),
        bootstrap: (input) =>
          Effect.sync(() => {
            opened.push(input.workspaceRoot);
            return { project: {} as never, created: true };
          }),
      }),
    );
    const core = yield* Layer.build(
      coreLayer(yield* seedState(signedInSeed(hub.url)), {
        session: "phs_test",
        plugins: options.plugins ?? [],
        t3,
      }),
    );
    return yield* Effect.gen(function* () {
      yield* (yield* PeerStatus.PeerStatus).coordinationFrom(() => Effect.succeed(coordination));
      yield* PeerPlugins.startPlugins;
      return {
        hub,
        opened,
        workspaces: yield* PeerWorkspaces.PeerWorkspaces,
        agents: yield* PeerAgents.PeerAgents,
        state: yield* PeerState.PeerState,
        client: yield* PeerHubClient.PeerHubClient,
      };
    }).pipe(Effect.provide(core));
  });

describe("Peer workspaces", () => {
  it.effect("reads advertised editions and keeps older or unavailable editions unknown", () =>
    Effect.gen(function* () {
      const url = "https://git.example.test/acme/api.git";
      for (const mode of ["current", "older", "unavailable"] as const) {
        const { workspaces, state, hub } = yield* started(url, {
          answer: (path, ...args) =>
            path === "/v1/me"
              ? [200, { ...meAnswer(), features: mode === "older" ? {} : { editions: 1 } }]
              : path === "/v1/workspaces/acme/edition"
                ? mode === "unavailable"
                  ? [503, { error: "Unavailable" }]
                  : [200, { id: "free", memberLimit: 2, members: 1, interactionLimit: null }]
                : acmeHub(url)(path, ...args),
        });
        yield* workspaces.sync;
        const workspace = (yield* state.read).persisted.workspaces[0];
        assert.strictEqual(workspace?.manifest?.projects[0]?.id, "pay");
        assert.strictEqual(workspace?.edition?.id, mode === "current" ? "free" : undefined);
        assert.strictEqual(
          hub.calls.some((call) => call.url?.endsWith("/edition")),
          mode !== "older",
        );
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("forget local workspace data even while its plugin is inactive", () =>
    Effect.gen(function* () {
      const heard = yield* Queue.unbounded<string>();
      const { workspaces, state } = yield* started("https://git.example.test/acme/api.git", {
        plugins: [
          plugin(
            "tool-trust",
            Effect.succeed({
              workspaceCleanup: (event) => Queue.offer(heard, event.kind).pipe(Effect.asVoid),
              lifecycle: (event) => Queue.offer(heard, `active ${event.kind}`).pipe(Effect.asVoid),
            }),
          ),
        ],
      });
      yield* state.updatePersisted((persisted) => ({
        ...persisted,
        plugins: { "tool-trust": false },
      }));
      yield* workspaces.signOut;
      assert.strictEqual(yield* Queue.size(heard), 1);
      assert.deepStrictEqual(yield* Queue.takeAll(heard), ["signing-out"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("invite with the role chosen, a member when none is", () =>
    Effect.gen(function* () {
      const { workspaces, hub } = yield* started("https://git.example.test/acme/api.git");
      yield* workspaces.invite({ workspace: "acme", email: "bob@acme.test", role: "admin" });
      yield* workspaces.invite({ workspace: "acme", email: "cal@acme.test" });
      assert.deepStrictEqual(
        hub.calls
          .filter((call) => call.method === "POST" && call.url === "/v1/workspaces/acme/invites")
          .map((call) => call.body),
        ['{"email":"bob@acme.test","role":"admin"}', '{"email":"cal@acme.test","role":"member"}'],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "keeps failed invitation delivery in the successful creation result and exposes resend recovery",
    () =>
      Effect.gen(function* () {
        let delivery = { state: "failed", error: "SMTP unavailable" };
        const invitation = () => ({
          email: "bob@acme.test",
          role: "member",
          status: "pending",
          delivery,
        });
        const { workspaces } = yield* started("https://git.example.test/acme/api.git", {
          answer: (path) =>
            path.endsWith("/resend")
              ? [200, { ...invitation(), delivery: (delivery = { state: "sent", error: "" }) }]
              : path === "/v1/workspaces/acme/invites"
                ? [201, { ...invitation(), invitations: [invitation()] }]
                : acmeHub("https://git.example.test/acme/api.git")(path),
        });
        const result = yield* workspaces.invite({ workspace: "acme", email: "bob@acme.test" });
        assert.deepStrictEqual(result.delivery, { state: "failed", error: "SMTP unavailable" });
        const listed = yield* workspaces.invitations({ workspace: "acme" });
        assert.strictEqual(listed?.invitations[0]?.delivery?.state, "failed");
        yield* workspaces.resendInvite({ workspace: "acme", email: "bob@acme.test" });
        assert.strictEqual(
          (yield* workspaces.invitations({ workspace: "acme" }))?.invitations[0]?.delivery?.state,
          "sent",
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("list what was founded for the person, and accept it as its owner", () =>
    Effect.gen(function* () {
      const url = "https://git.example.test/acme/api.git";
      const founding = {
        slug: "vocabulift",
        name: "Vocabulift",
        initiatedBy: "op@example.test",
        initiatedAt: "2026-10-20T00:00:00Z",
        expiresAt: "2026-11-03T00:00:00Z",
        expired: false,
      };
      const { workspaces, state, hub } = yield* started(url, {
        answer: (path, ...args) =>
          path === "/v1/me"
            ? [
                200,
                {
                  ...meAnswer(),
                  hubAdmin: true,
                  foundings: [founding, { slug: "../x", name: "X" }],
                },
              ]
            : path === "/v1/foundings/vocabulift/accept"
              ? [201, { workspace: { slug: "vocabulift" }, founding: { state: "claimed" } }]
              : acmeHub(url)(path, ...args),
      });
      const status = yield* workspaces.sync;
      assert.deepStrictEqual(status.foundings, [founding]);
      assert.strictEqual(status.hubAdmin, true);
      yield* workspaces.acceptFounding({ slug: "Vocabulift" });
      assert.isTrue(
        hub.calls.some(
          (call) => call.method === "POST" && call.url === "/v1/foundings/vocabulift/accept",
        ),
      );
      // Accepting syncs, so the new organization is read at once.
      assert.strictEqual(hub.calls.filter((call) => call.url === "/v1/me").length, 2);
      const signedOut = yield* workspaces.signOut;
      assert.deepStrictEqual(signedOut.foundings, []);
      assert.isUndefined(signedOut.hubAdmin);
      assert.isUndefined((yield* state.read).persisted.foundings);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("read an older Hub's missing invitation routes as unknown, and say so on resend", () =>
    Effect.gen(function* () {
      const url = "https://git.example.test/acme/api.git";
      const { workspaces } = yield* started(url, {
        answer: (path, ...args) =>
          path.startsWith("/v1/workspaces/acme/invites/bob%40acme.test/resend")
            ? [404, { error: { code: "not_found", message: "no such route" } }]
            : path.startsWith("/v1/workspaces/acme/invites")
              ? [405, {}]
              : acmeHub(url)(path, ...args),
      });
      const input = { workspace: "acme", email: "bob@acme.test" };
      assert.isNull(yield* workspaces.invitations({ workspace: "acme" }));
      assert.isNull(yield* workspaces.invitePreview(input));
      const resent = yield* workspaces.resendInvite(input).pipe(Effect.result);
      assert.isTrue(Result.isFailure(resent));
      if (Result.isFailure(resent)) assert.include(resent.failure.detail, "Update Peer Hub");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("explain a full organization in words that say who can raise its capacity", () =>
    Effect.gen(function* () {
      const url = "https://git.example.test/acme/api.git";
      const { workspaces } = yield* started(url, {
        answer: (path, ...args) =>
          path === "/v1/workspaces/beta/join"
            ? [
                403,
                {
                  error: {
                    code: "team_capacity_required",
                    message: "the workspace has 2 members, its limit",
                    details: { memberLimit: 2 },
                  },
                },
              ]
            : acmeHub(url)(path, ...args),
      });
      const joined = yield* workspaces.joinWorkspace({ workspace: "beta" }).pipe(Effect.result);
      assert.isTrue(Result.isFailure(joined));
      if (Result.isFailure(joined)) {
        assert.strictEqual(joined.failure.code, "team_capacity_required");
        assert.include(joined.failure.detail, "limit of 2 members");
        assert.include(joined.failure.detail, "Hub's administrator");
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("tell plugins of each sync, with the workspaces it read", () =>
    Effect.gen(function* () {
      const heard = yield* Queue.unbounded<string>();
      const { workspaces, state } = yield* started("https://git.example.test/acme/api.git", {
        plugins: [
          plugin(
            "capacity",
            Effect.succeed({
              lifecycle: (event) =>
                Queue.offer(
                  heard,
                  event.kind === "synced"
                    ? `synced ${event.workspaces.map((w) => w.manifest?.projects[0]?.id).join()}`
                    : event.kind,
                ).pipe(Effect.asVoid),
            }),
          ),
        ],
      });
      yield* workspaces.sync;
      assert.deepStrictEqual(yield* Queue.takeAll(heard), ["synced pay"]);
      assert.strictEqual(
        (yield* state.read).persisted.workspaces[0]?.manifest?.projects[0]?.id,
        "pay",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("tell plugins of signing out while the Hub session still holds", () =>
    Effect.gen(function* () {
      const heard = yield* Queue.unbounded<string>();
      const { workspaces, client, hub } = yield* started("https://git.example.test/acme/api.git", {
        plugins: [
          plugin(
            "capacity",
            Effect.gen(function* () {
              const client = yield* PeerHubClient.PeerHubClient;
              return {
                lifecycle: (event) =>
                  Effect.gen(function* () {
                    const session = yield* client.storedSession;
                    yield* Queue.offer(
                      heard,
                      `${event.kind} ${Option.isSome(session) ? "with" : "without"} a session`,
                    );
                  }),
              };
            }),
          ),
        ],
      });
      yield* workspaces.signOut;
      assert.deepStrictEqual(yield* Queue.takeAll(heard), ["signing-out with a session"]);
      assert.isTrue(Option.isNone(yield* client.storedSession));
      assert.isTrue(hub.calls.some((call) => call.url === "/v1/auth/signout"));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("clone with plain git when no git host owns the address", () =>
    Effect.gen(function* () {
      const { dir, origin } = yield* bareRepository;
      const root = NodePath.join(dir, "Peer");
      const { workspaces, opened } = yield* started(origin, { root });
      yield* workspaces.sync;
      yield* workspaces.openProject({ workspace: "acme", projectId: "pay" });
      const checkout = NodePath.join(root, "acme", "pay", "api");
      assert.strictEqual(
        NodeFS.readFileSync(NodePath.join(checkout, "README.md"), "utf8"),
        "Payments\n",
      );
      assert.deepStrictEqual(opened, [checkout]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "bind a checkout that is open here to a project, so opening it does not clone it again",
    () =>
      Effect.gen(function* () {
        const { dir, origin } = yield* bareRepository;
        const mine = NodePath.join(dir, "mine");
        NodeChildProcess.execFileSync("git", ["clone", "--quiet", origin, mine], {
          stdio: "ignore",
        });
        const root = NodePath.join(dir, "Peer");
        const local = ProjectId.make("t3-mine");
        const { workspaces, state, opened } = yield* started(origin, {
          root,
          local: [{ id: local, title: "Mine", workspaceRoot: mine }],
        });
        // The project was just created from the settings, so this computer has not fetched it yet.
        yield* workspaces.bindCheckout({
          workspace: "acme",
          projectId: "pay",
          repositoryId: "api",
          localProjectId: local,
        });
        assert.deepStrictEqual((yield* state.read).persisted.localCheckouts, {
          "acme/pay/api": mine,
        });

        const synced = yield* workspaces.sync;
        const repository = synced.workspaces[0]?.projects[0]?.repositories[0];
        assert.deepStrictEqual(
          [repository?.path, repository?.state, repository?.projectId],
          [mine, "ready", local],
        );
        yield* workspaces.openProject({ workspace: "acme", projectId: "pay" });
        assert.isFalse(NodeFS.existsSync(NodePath.join(root, "acme", "pay", "api")));
        assert.deepStrictEqual(opened, []);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "refuses sharing and rebinding before changing Hub state while an agent is active",
    () =>
      Effect.gen(function* () {
        const { dir, origin } = yield* bareRepository;
        const mine = NodePath.join(dir, "mine");
        NodeChildProcess.execFileSync("git", ["clone", "--quiet", origin, mine], {
          stdio: "ignore",
        });
        NodeChildProcess.execFileSync("git", [
          "-C",
          mine,
          "remote",
          "set-url",
          "origin",
          "https://git.example.test/acme/api.git",
        ]);
        const local = ProjectId.make("t3-mine");
        const { workspaces, agents, state, hub } = yield* started(origin, {
          local: [{ id: local, title: "Mine", workspaceRoot: mine }],
        });
        const fixture = yield* Effect.acquireRelease(
          Effect.promise(() =>
            brokerFixture(() => ({
              placeOf: async () => ({ workspace: "@local", project: "local", root: mine }),
            })),
          ),
          (fixture) => Effect.promise(() => fixture.dispose()),
        );
        yield* Effect.promise(() => fixture.register("one"));
        yield* agents.attach(fixture.broker);
        for (const change of [
          workspaces.shareProject({ workspace: "acme", projectId: local }),
          workspaces.bindCheckout({
            workspace: "acme",
            projectId: "pay",
            repositoryId: "api",
            localProjectId: local,
          }),
        ]) {
          const failure = yield* change.pipe(Effect.flip);
          assert.isTrue(failure.refused);
          assert.include(failure.detail, "End the active agent runtimes");
        }
        assert.isFalse(
          hub.calls.some((call) => call.method === "POST" && call.url?.includes("/projects")),
        );
        assert.deepStrictEqual((yield* state.read).persisted.localCheckouts, undefined);
        fixture.broker.sessions.clear();
        yield* workspaces.bindCheckout({
          workspace: "acme",
          projectId: "pay",
          repositoryId: "api",
          localProjectId: local,
        });
        yield* Effect.promise(() => fixture.register("two"));
        const unshare = yield* workspaces
          .unshareProject({ workspace: "acme", projectId: "pay" })
          .pipe(Effect.flip);
        assert.isTrue(unshare.refused);
        assert.deepStrictEqual((yield* state.read).persisted.localCheckouts, {
          "acme/pay/api": mine,
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("bind the latest checkout chosen, and refuse what is not one here", () =>
    Effect.gen(function* () {
      const { dir, origin } = yield* bareRepository;
      const clone = (name: string) => {
        const path = NodePath.join(dir, name);
        NodeChildProcess.execFileSync("git", ["clone", "--quiet", origin, path], {
          stdio: "ignore",
        });
        return path;
      };
      const [first, second] = [clone("first"), clone("second")];
      const bare = NodePath.join(dir, "not-git");
      NodeFS.mkdirSync(bare);
      const { workspaces, state } = yield* started(origin, {
        local: [
          { id: ProjectId.make("t3-first"), title: "First", workspaceRoot: first },
          { id: ProjectId.make("t3-second"), title: "Second", workspaceRoot: second },
          { id: ProjectId.make("t3-bare"), title: "Bare", workspaceRoot: bare },
        ],
      });
      const bind = (input: {
        workspace?: string;
        projectId?: string;
        repositoryId?: string;
        local: string;
      }) =>
        workspaces
          .bindCheckout({
            workspace: input.workspace ?? "acme",
            projectId: input.projectId ?? "pay",
            repositoryId: input.repositoryId ?? "api",
            localProjectId: ProjectId.make(input.local),
          })
          .pipe(Effect.result);
      const checkouts = Effect.map(state.read, ({ persisted }) => persisted.localCheckouts);

      assert.isTrue(Result.isSuccess(yield* bind({ local: "t3-first" })));
      assert.isTrue(Result.isSuccess(yield* bind({ local: "t3-second" })));
      assert.deepStrictEqual(yield* checkouts, { "acme/pay/api": second });

      for (const [input, said] of [
        [
          { workspace: "elsewhere", local: "t3-first" },
          'not a member of the workspace "elsewhere"',
        ],
        [{ projectId: "../pay", local: "t3-first" }, "no usable id"],
        [{ repositoryId: "Api", local: "t3-first" }, "no usable id"],
        [{ local: "t3-gone" }, "not on this computer"],
        [{ local: "t3-bare" }, "Bare is not a git checkout"],
      ] as const) {
        const refused = yield* bind(input);
        assert.isTrue(Result.isFailure(refused) && refused.failure.detail.includes(said), said);
      }
      // None of the refusals changed what was bound.
      assert.deepStrictEqual(yield* checkouts, { "acme/pay/api": second });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("clone through the git host that owns the address, and say why it failed", () =>
    Effect.gen(function* () {
      const { dir, origin } = yield* bareRepository;
      const root = NodePath.join(dir, "Peer");
      const configured: Array<string> = [];
      const source = { current: origin };
      const gitHost = plugin(
        "github",
        Effect.succeed({
          gitHost: {
            owns: (url) => url.startsWith("https://git.example.test/"),
            address: () => null,
            clone: () =>
              Effect.succeed({
                url: source.current,
                args: ["-c", "core.autocrlf=false"],
                configure: (checkout) => Effect.sync(() => void configured.push(checkout)),
              }),
            explain: () => ({ message: "Sign in to git.example.test first.", signIn: true }),
            pullRequests: () => undefined,
          },
        }),
      );
      const { workspaces, state, opened } = yield* started(
        "https://git.example.test/acme/api.git",
        { root, plugins: [gitHost] },
      );
      yield* workspaces.sync;
      const checkout = NodePath.join(root, "acme", "pay", "api");

      source.current = NodePath.join(dir, "missing.git");
      yield* workspaces.openProject({ workspace: "acme", projectId: "pay" });
      assert.deepStrictEqual((yield* state.read).checkouts.get(checkout), {
        state: "error",
        error: "Sign in to git.example.test first.",
        gitHubSignIn: true,
      });

      source.current = origin;
      yield* workspaces.openProject({ workspace: "acme", projectId: "pay" });
      assert.isTrue(NodeFS.existsSync(NodePath.join(checkout, "README.md")));
      assert.deepStrictEqual(configured, [checkout]);
      assert.deepStrictEqual(opened, [checkout]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

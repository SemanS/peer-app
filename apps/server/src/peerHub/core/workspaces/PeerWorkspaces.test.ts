// @effect-diagnostics nodeBuiltinImport:off - a checkout cloned into a temporary directory.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, describe, it } from "@effect/vitest";
import type { PeerHubStatus, PeerPluginId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
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

/** Core signed in to a stand-in Hub for a repository at `url`, its checkouts under `root`. */
const started = (
  url: string,
  options: { readonly plugins?: ReadonlyArray<PeerPluginEntry>; readonly root?: string } = {},
) =>
  Effect.gen(function* () {
    if (options.root !== undefined) vi.stubEnv("PEER_WORKSPACE", options.root);
    const hub = yield* standInHub({ current: acmeHub(url) });
    const opened: Array<string> = [];
    const t3 = Layer.merge(
      emptyT3,
      Layer.mock(ProjectService.ProjectService)({
        getByWorkspaceRoot: () => Effect.succeed(Option.none()),
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
        state: yield* PeerState.PeerState,
        client: yield* PeerHubClient.PeerHubClient,
      };
    }).pipe(Effect.provide(core));
  });

describe("Peer workspaces", () => {
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

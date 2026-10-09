// @effect-diagnostics nodeBuiltinImport:off - isolated store and bound provider policy integration.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId, type PeerProject } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import {
  bindThreadProject,
  claudeHubMcpServers,
  codexHubMcpServers,
  setHubPolicyState,
  setWorkspaceToolGate,
  hubInstructionsForThread,
} from "../../hubPolicy.ts";
import { makeTrustStore } from "./trustStore.ts";
import { definition } from "./definition.ts";
import { activateToolTrust, ToolTrustPlugin } from "./index.ts";
import { coreLayer, seedState, signedInSeed, standInHub } from "../../core/testkit.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import * as PeerWorkspaces from "../../core/workspaces/PeerWorkspaces.ts";
import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const project: PeerProject = {
  id: "app",
  name: "App",
  role: "member",
  members: [],
  repositories: [],
  knowledge: { kontext: false, company: false },
  capacity: { personal: "any", personalHarnesses: [] },
  tools: [
    {
      id: "tracker",
      name: "Tracker",
      requires: [],
      mcp: {
        transport: "http",
        url: "https://tracker.test/mcp",
        headers: { Authorization: "${secret:TRACKER_TOKEN}" },
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
const coordination = {
  enabled: false,
  policy: "coordinate" as const,
  claudeHooks: false,
  logPath: "/isolated",
  sessions: [],
  overlaps: [],
  findings: [],
  contexts: [],
  candidates: [],
};
const trustedCore = Effect.gen(function* () {
  const hub = yield* standInHub({
    current: () => [401, { error: { code: "unauthenticated", message: "Expired" } }],
  });
  const base = yield* seedState(signedInSeed(hub.url));
  const tool = project.tools[0]!;
  const checked = definition(tool);
  const json = yield* encodeJson({
    version: 1,
    workspaces: {
      acme: {
        tools: {
          tracker: {
            on: { fingerprints: [checked.fingerprint], approved: checked.canonical, at: "before" },
          },
        },
        secrets: { TRACKER_TOKEN: "stored" },
      },
    },
  });
  yield* Effect.promise(() =>
    NodeFSP.writeFile(NodePath.join(base, "userdata", "peer-tool-trust.json"), json),
  );
  const core = yield* Layer.build(
    coreLayer(base, { session: "phs_test", plugins: [ToolTrustPlugin] }),
  );
  return yield* Effect.gen(function* () {
    const state = yield* PeerState.PeerState;
    const status = yield* PeerStatus.PeerStatus;
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const workspaces = yield* PeerWorkspaces.PeerWorkspaces;
    yield* secrets.set(
      "peer-tool-secret--acme--TRACKER_TOKEN",
      new TextEncoder().encode("private"),
    );
    yield* status.coordinationFrom(() => Effect.succeed(coordination));
    const member = {
      ...state.current().persisted.workspaces[0]!,
      manifest: {
        version: 2 as const,
        workspace: { slug: "acme", name: "Acme", currency: "EUR" as const },
        member: { email: "ana@acme.test", name: "Ana", role: "member" as const },
        knowledge: {},
        projects: [{ ...project, tools: [tool] }],
      },
    };
    yield* state.updatePersisted((p) => ({ ...p, workspaces: [member] }));
    yield* PeerPlugins.startPlugins;
    expect((yield* status.publish).toolTrust?.workspaces[0]?.tools).toEqual([]);
    return { state, status, secrets, workspaces, member, tool };
  }).pipe(Effect.provide(core));
});
afterEach(() => {
  setWorkspaceToolGate(null);
  setHubPolicyState(null);
});
describe("workspace gate through provider policy", () => {
  it.effect("forgets approvals and secrets after session expiry, including while disabled", () =>
    Effect.gen(function* () {
      for (const enabled of [true, false]) {
        const f = yield* trustedCore;
        yield* f.state.updatePersisted((p) => ({ ...p, plugins: { "tool-trust": enabled } }));
        expect((yield* Effect.result(f.workspaces.sync))._tag).toBe("Failure");
        yield* f.state.updatePersisted((p) => ({
          ...p,
          email: "ana@acme.test",
          workspaces: [f.member],
          plugins: { "tool-trust": true },
        }));
        const rejoined = yield* f.status.publish;
        expect(rejoined.toolTrust?.workspaces[0]?.tools[0]?.state).toBe("review");
        expect(Option.isNone(yield* f.secrets.get("peer-tool-secret--acme--TRACKER_TOKEN"))).toBe(
          true,
        );
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect("never publishes a fingerprint with a different workspace tool template", () =>
    Effect.gen(function* () {
      const f = yield* trustedCore;
      const entered = yield* Deferred.make<void>();
      const resume = yield* Deferred.make<void>();
      let first = true;
      yield* f.status.coordinationFrom(() =>
        Effect.gen(function* () {
          if (first) {
            first = false;
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(resume);
          }
          return coordination;
        }),
      );
      const pending = yield* f.status.publish.pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      const changed = {
        ...f.tool,
        mcp: { transport: "stdio" as const, command: "new-command", args: [], env: {} },
      };
      yield* f.state.updatePersisted((p) => ({
        ...p,
        workspaces: [
          {
            ...f.member,
            manifest: { ...f.member.manifest, projects: [{ ...project, tools: [changed] }] },
          },
        ],
      }));
      yield* Deferred.succeed(resume, undefined);
      const published = yield* Fiber.join(pending);
      expect(published.workspaces[0]!.projects[0]!.project.tools[0]!.mcp).toEqual(changed.mcp);
      expect(published.toolTrust?.workspaces[0]?.tools[0]?.fingerprint).toBe(
        definition(changed).fingerprint,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect("forgets actual plugin approvals on disabled sign-out before rejoining", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({ current: () => [200, {}] });
      const base = yield* seedState(signedInSeed(hub.url));
      const tool = {
        ...project.tools[0]!,
        mcp: { transport: "stdio" as const, command: "tracker", args: [], env: {} },
      };
      const checked = definition(tool);
      const json = yield* encodeJson({
        version: 1,
        workspaces: {
          acme: {
            tools: {
              tracker: {
                on: {
                  fingerprints: [checked.fingerprint],
                  approved: checked.canonical,
                  at: "before",
                },
              },
            },
            secrets: {},
          },
        },
      });
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(base, "userdata", "peer-tool-trust.json"), json),
      );
      const core = yield* Layer.build(
        coreLayer(base, { session: "phs_test", plugins: [ToolTrustPlugin] }),
      );
      yield* Effect.gen(function* () {
        const state = yield* PeerState.PeerState;
        const status = yield* PeerStatus.PeerStatus;
        yield* status.coordinationFrom(() =>
          Effect.succeed({
            enabled: false,
            policy: "coordinate",
            claudeHooks: false,
            logPath: "/isolated",
            sessions: [],
            overlaps: [],
            findings: [],
            contexts: [],
            candidates: [],
          }),
        );
        const member = {
          ...state.current().persisted.workspaces[0]!,
          manifest: {
            version: 2 as const,
            workspace: { slug: "acme", name: "Acme", currency: "EUR" as const },
            member: { email: "ana@acme.test", name: "Ana", role: "member" as const },
            knowledge: {},
            projects: [{ ...project, tools: [tool] }],
          },
        };
        yield* state.updatePersisted((p) => ({ ...p, workspaces: [member] }));
        yield* PeerPlugins.startPlugins;
        const before = yield* status.publish;
        expect(before.toolTrust?.workspaces[0]?.tools).toEqual([]);
        yield* state.updatePersisted((p) => ({ ...p, plugins: { "tool-trust": false } }));
        yield* (yield* PeerWorkspaces.PeerWorkspaces).signOut;
        yield* state.updatePersisted((p) => ({
          ...p,
          workspaces: [member],
          plugins: { "tool-trust": true },
        }));
        const rejoined = yield* status.publish;
        expect(rejoined.toolTrust?.workspaces[0]?.tools[0]?.state).toBe("review");
      }).pipe(Effect.provide(core));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("gates approval, secrets, effective changes, revocation and plugin stop", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* Effect.acquireRelease(
          Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-gate-"))),
          (dir) => Effect.promise(() => NodeFSP.rm(dir, { recursive: true, force: true })),
        );
        const values = new Map<string, Uint8Array>();
        let current = project;
        const store = yield* makeTrustStore({
          stateDir: dir,
          workspaces: () => [
            {
              slug: "acme",
              manifest: {
                workspace: { slug: "acme", name: "Acme", currency: "EUR" },
                projects: [current],
              },
            },
          ],
          secrets: {
            get: (name) => Effect.sync(() => Option.fromNullishOr(values.get(name))),
            set: (name, value) =>
              Effect.sync(() => {
                values.set(name, value);
              }),
            remove: (name) =>
              Effect.sync(() => {
                values.delete(name);
              }),
          },
        });
        const thread = ThreadId.make("tool-trust-thread");
        bindThreadProject(thread, ProjectId.make("local"));
        const publish = () =>
          setHubPolicyState({
            projects: new Map([
              [
                "local",
                {
                  workspace: { slug: "acme", name: "Acme" },
                  project: current,
                  repositoryPath: "/isolated",
                },
              ],
            ]),
            roots: new Map(),
            sharedInstances: new Map(),
            knowledgePaths: new Map(),
          });
        publish();
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* activateToolTrust(store);
            expect(claudeHubMcpServers(thread)).toEqual({});
            yield* store.approve({
              items: current.tools.map((tool) => ({
                workspace: "acme",
                tool: tool.id,
                fingerprint: definition(tool).fingerprint,
              })),
            });
            yield* store.setSecret({
              workspace: "acme",
              name: "TRACKER_TOKEN",
              source: { kind: "value", value: "private" },
            });
            expect(claudeHubMcpServers(thread).tracker).toEqual({
              type: "http",
              url: "https://tracker.test/mcp",
              headers: { Authorization: "private" },
            });
            expect(codexHubMcpServers(thread).events).toBeUndefined();
            expect(claudeHubMcpServers(thread).events).toBeDefined();
            expect(hubInstructionsForThread(thread)).not.toContain("private");
            current = {
              ...current,
              tools: [
                {
                  ...current.tools[0]!,
                  mcp: { transport: "stdio", command: "tracker", args: ["changed"], env: {} },
                },
                current.tools[1]!,
              ],
            };
            publish();
            expect(claudeHubMcpServers(thread).tracker).toBeUndefined();
            yield* store.approve({
              items: [
                {
                  workspace: "acme",
                  tool: "tracker",
                  fingerprint: definition(current.tools[0]!).fingerprint,
                },
              ],
            });
            expect(claudeHubMcpServers(thread).tracker).toBeDefined();
            yield* store.turnOff({ items: [{ workspace: "acme", tool: "tracker" }] });
            expect(claudeHubMcpServers(thread).tracker).toBeUndefined();
          }),
        );
        expect(claudeHubMcpServers(thread)).toEqual({});
      }),
    ),
  );
});

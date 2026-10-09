// @effect-diagnostics nodeBuiltinImport:off - isolated store and bound provider policy integration.
import * as FS from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId, type PeerProject } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
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
import { activateToolTrust } from "./index.ts";
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
afterEach(() => {
  setWorkspaceToolGate(null);
  setHubPolicyState(null);
});
describe("workspace gate through provider policy", () => {
  it.effect("gates approval, secrets, effective changes, revocation and plugin stop", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* Effect.acquireRelease(
          Effect.promise(() => FS.mkdtemp(Path.join(OS.tmpdir(), "peer-gate-"))),
          (dir) => Effect.promise(() => FS.rm(dir, { recursive: true, force: true })),
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

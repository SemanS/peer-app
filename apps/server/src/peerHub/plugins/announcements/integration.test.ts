// @effect-diagnostics nodeBuiltinImport:off - isolated broker, native stand-in Hub and fixture state.
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Layer from "effect/Layer";
import {
  type PeerHubError,
  type PeerAnnouncement,
  type PeerAnnouncementPostInput,
  type PeerAnnouncementWithdrawInput,
} from "@t3tools/contracts";
import { coreLayer, paymentsSeed, seedState, standInHub } from "../../core/testkit.ts";
import { PeerState } from "../../core/state/PeerState.ts";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import { PeerStatus } from "../../core/status/PeerStatus.ts";
import { PeerPlugins, startPlugins } from "../../core/plugins/PeerPlugins.ts";
import { brokerFixture, pluginsOf } from "../../core/broker/testkit.ts";
import { AnnouncementsPlugin } from "./index.ts";

const row: PeerAnnouncement = {
  id: "a1b2c3",
  project: "app",
  text: "CI is red",
  wake: true,
  author: { kind: "person", email: "ana@acme.test" },
  createdAt: "2026-10-09T08:00:00Z",
  expiresAt: "2099-10-10T08:00:00Z",
};
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
type Calls = Record<
  string,
  (
    input: PeerAnnouncementPostInput | PeerAnnouncementWithdrawInput | { readonly wake: boolean },
  ) => Effect.Effect<unknown, PeerHubError>
>;
describe("announcements through the real plugin and broker", () => {
  it.effect(
    "offers two Claude sessions and Codex once, verifies only Mod input, wakes idle sessions, acknowledges, withdraws and keeps cached notices offline",
    () =>
      Effect.gen(function* () {
        let rows: PeerAnnouncement[] = [row];
        let offline = false;
        let method = () => "";
        const hub = yield* standInHub({
          current: (url) => {
            if (offline) return [503, {}];
            if (url.endsWith("/sync"))
              return [200, { at: row.createdAt, announcements: rows, delivered: [], rejected: [] }];
            if (method() === "DELETE") {
              rows = rows.map((entry) =>
                entry.id === row.id
                  ? { ...entry, withdrawnAt: row.createdAt, status: "withdrawn" }
                  : entry,
              );
              return [200, { withdrawn: [row.id] }];
            }
            if (method() === "POST") {
              const posted = { ...row, id: "d4e5f6", text: "Deployment is ready" };
              rows.push(posted);
              return [200, posted];
            }
            return [200, { at: row.createdAt, announcements: rows }];
          },
        });
        method = () => hub.calls.at(-1)?.method ?? "";
        const core = yield* Layer.build(
          coreLayer(yield* seedState(paymentsSeed(hub.url)), {
            session: "phs_test",
            plugins: [AnnouncementsPlugin],
          }),
        );
        const state = yield* PeerState.pipe(Effect.provide(core));
        yield* state.updatePersisted((p) => ({
          ...p,
          workspaces: p.workspaces.map((w) => ({
            ...w,
            manifest: w.manifest && {
              ...w.manifest,
              projects: w.manifest.projects.map((p) => ({ ...p, id: "app" })),
            },
          })),
        }));
        const status = yield* PeerStatus.pipe(Effect.provide(core));
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
        const plugins = yield* PeerPlugins.pipe(Effect.provide(core));
        const fixture = yield* Effect.acquireRelease(
          Effect.promise(() => brokerFixture(() => pluginsOf(plugins))),
          (f) => Effect.promise(f.dispose),
        );
        const agents = yield* PeerAgents.pipe(Effect.provide(core));
        yield* agents.attach(fixture.broker);
        yield* startPlugins.pipe(Effect.provide(core));
        const contribution = (yield* plugins.active)[0]!.contributions;
        const rpc = contribution.rpc!.handlers({
          effect: (_name, effect) => effect,
          stream: (_name, stream) => stream,
        }) as Calls;
        const hook = (id: string, agent = "claude", event = "UserPromptSubmit", extra = {}) =>
          fixture.broker.hook(
            { session_id: id, cwd: fixture.root, hook_event_name: event, prompt: "Go", ...extra },
            { "x-peer-agent": agent, "x-peer-adapter": agent === "claude" ? "mod" : "hooks" },
          );
        for (const [id, agent] of [
          ["one", "claude"],
          ["two", "claude"],
          ["three", "codex"],
        ] as const) {
          const offered = yield* Effect.promise(() =>
            hook(id, agent, "SessionStart", { source: "startup" }),
          );
          expect(json(offered)).toContain(row.text);
          expect(json(yield* Effect.promise(() => hook(id, agent)))).not.toContain(row.text);
        }
        const one = fixture.broker.sessions.get("claude:one")!;
        const receipt = [...one.deliveries.keys()][0]!;
        yield* Effect.promise(() => fixture.broker.start());
        const prove = (id: string) =>
          new Promise<number>((resolve, reject) => {
            const request = NodeHttp.request(
              {
                socketPath: NodePath.join(fixture.root, "peer.sock"),
                path: "/delivery",
                method: "POST",
                headers: { "content-type": "application/json", "x-peer-adapter": "mod" },
              },
              (response) => {
                response.resume();
                response.on("end", () => resolve(response.statusCode!));
                response.on("error", reject);
              },
            );
            request.on("error", reject);
            request.end(json({ session_id: "one", id, evidence: "model-input" }));
          });
        expect(yield* Effect.promise(() => prove("unknown"))).toBe(400);
        expect(yield* Effect.promise(() => prove(receipt))).toBe(204);

        expect(
          yield* Effect.promise(() =>
            fixture.broker.runCli("announcements", ["ack", "a1b2"], {
              "x-peer-session": "claude:one",
            }),
          ),
        ).toContain("Acknowledged");
        yield* Effect.promise(() =>
          expect(
            fixture.broker.runCli("announcements", ["ack", "nope"], {
              "x-peer-session": "claude:one",
            }),
          ).rejects.toThrow("withdrawn, expired, unknown"),
        );
        yield* rpc["peer.announcements.post"]!({
          workspace: "acme",
          project: "app",
          text: "Deployment is ready",
          wake: true,
        });
        one.status = "idle";
        yield* rpc["peer.announcements.setWake"]!({ wake: false });
        expect(
          yield* Effect.promise(async () =>
            fixture.broker.wakingNews(one, await fixture.broker.plugins()),
          ),
        ).toBeNull();
        yield* rpc["peer.announcements.setWake"]!({ wake: true });
        const codex = fixture.broker.sessions.get("codex:three")!;
        codex.status = "blocked";
        expect(
          yield* Effect.promise(async () =>
            fixture.broker.wakingNews(codex, await fixture.broker.plugins()),
          ),
        ).toBeNull();
        codex.status = "idle";
        yield* Effect.promise(async () => fixture.broker.wakeCodex(await fixture.broker.plugins()));
        expect(json(yield* Effect.promise(() => hook("three", "codex")))).toContain(
          "Deployment is ready",
        );
        expect(json(yield* Effect.promise(() => hook("three", "codex")))).not.toContain(
          "Deployment is ready",
        );

        expect(
          yield* Effect.promise(() =>
            fixture.broker.wait(
              { session_id: "one", cwd: fixture.root },
              { "x-peer-adapter": "mod" },
            ),
          ),
        ).toContain("Deployment is ready");
        yield* rpc["peer.announcements.withdraw"]!({
          workspace: "acme",
          project: "app",
          id: row.id,
        });
        expect(json(yield* Effect.promise(() => hook("one")))).toContain("withdrawn");
        expect(json(yield* Effect.promise(() => hook("one")))).not.toContain("withdrawn");
        offline = true;
        expect(
          yield* Effect.promise(() =>
            fixture.broker.runCli("announcements", [], { "x-peer-session": "claude:two" }),
          ),
        ).toContain("Deployment is ready");
        offline = false;
        yield* Effect.promise(() => hook("one", "claude", "SessionEnd"));
        const sent = hub.calls
          .filter((call) => call.url?.endsWith("/sync"))
          .map((call) => call.body)
          .join("\n");
        expect(sent).toContain('"state":"acknowledged"');
        expect(sent).not.toMatch(/"session":"codex:three","state":"modelInput"/);
        yield* plugins.setPlugin({ id: "announcements", enabled: false });
        expect(yield* plugins.active).toHaveLength(0);
        expect((yield* status.publish).announcements).toBeUndefined();
        expect(json(yield* Effect.promise(() => hook("two")))).not.toContain("Deployment is ready");
        yield* Effect.promise(() =>
          expect(
            fixture.broker.runCli("announcements", [], { "x-peer-session": "claude:two" }),
          ).rejects.toThrow("turned off"),
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

// @effect-diagnostics nodeBuiltinImport:off - inspect the isolated broker log after its own queue drains.
import * as NodeFSP from "node:fs/promises";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { coreLayer, seedState, signedInSeed, standInHub } from "../../core/testkit.ts";
import { PeerState } from "../../core/state/PeerState.ts";
import { PeerStatus } from "../../core/status/PeerStatus.ts";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import { brokerFixture } from "../../core/broker/testkit.ts";
import { NO_PLUGINS } from "../../core/broker/host.ts";
import { PeerResources, layer } from "./service.ts";
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const hold = {
  project: "app",
  kind: "resource" as const,
  name: "deploy",
  holder: { session: "claude:one", email: "ana@acme.test", environment: "ana-laptop" },
  intent: "deploying",
  expiresAt: "2099-10-09T12:30:00Z",
};
const project = {
  id: "app",
  name: "App",
  role: "member" as const,
  members: [],
  repositories: [],
  knowledge: { kontext: false, company: false },
  tools: [],
  capacity: { personal: "any" as const, personalHarnesses: [] },
};
describe("resource service on the environment Hub session", () => {
  it.effect(
    "releases an exact Hub-confirmed pattern before its configuration arrives without capturing file or private scopes",
    () =>
      Effect.gen(function* () {
        const pattern = { ...hold, kind: "pattern" as const, name: "migrations/**" };
        let otherHolder = false;
        const hub = yield* standInHub({
          current: (url) =>
            url.endsWith("/release")
              ? [
                  200,
                  {
                    released: !otherHolder,
                    resource: otherHolder
                      ? {
                          ...pattern,
                          holder: {
                            ...pattern.holder,
                            session: "claude:other",
                            email: "bob@acme.test",
                          },
                        }
                      : pattern,
                    ...(otherHolder ? { reason: "held_by_other" } : {}),
                    at: "2026-10-09T12:00:00Z",
                  },
                ]
              : [200, { held: [], patterns: {}, at: "2026-10-09T12:00:00Z" }],
        });
        const core = yield* Layer.build(
          coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "phs_test" }),
        );
        const state = yield* PeerState.pipe(Effect.provide(core));
        yield* state.updatePersisted((p) => ({
          ...p,
          workspaces: p.workspaces.map((w) => ({
            ...w,
            manifest: {
              version: 2,
              workspace: { slug: "acme", name: "Acme", currency: "EUR" },
              member: { email: "ana@acme.test", name: "Ana", role: "member" },
              knowledge: {},
              projects: [project],
            },
          })),
        }));
        yield* (yield* PeerStatus.pipe(Effect.provide(core))).coordinationFrom(() =>
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
        let service: PeerResources["Service"] | undefined;
        const fixture = yield* Effect.acquireRelease(
          Effect.promise(() =>
            brokerFixture(() => ({
              plugins: async () =>
                service === undefined
                  ? NO_PLUGINS
                  : {
                      ...NO_PLUGINS,
                      active: [
                        {
                          id: "resources",
                          title: "Resources",
                          contributions: {
                            claimScheme: {
                              prefix: "resource:",
                              flags: ["--ttl" as const],
                              help: [],
                              validate: service.validate,
                              recognizesRelease: service.canRelease,
                              run: service.command,
                            },
                          },
                        },
                      ],
                    },
            })),
          ),
          (f) => Effect.promise(f.dispose),
        );
        yield* Effect.promise(() => fixture.register("one"));
        yield* (yield* PeerAgents.pipe(Effect.provide(core))).attach(fixture.broker);
        const resources = yield* PeerResources.pipe(Effect.provide(layer), Effect.provide(core));
        service = resources;
        const session = fixture.broker.sessionViews()[0]!;
        yield* resources.refresh("acme");
        expect(resources.policyFor(session, "migrations/001.sql", "notify")).toBe("notify");
        expect(resources.canRelease(session, pattern.name)).toBe(false);
        const answer = {
          policy: "notify" as const,
          policySource: "project" as const,
          verdicts: [
            {
              path: "migrations/001.sql",
              verdict: "clear" as const,
              with: [],
              overlaps: [],
              pattern: pattern.name,
              policy: "exclusive" as const,
              hold: { ...pattern.holder, expiresAt: pattern.expiresAt },
            },
          ],
          overlaps: [],
          at: "2026-10-09T12:00:00Z",
        };
        yield* resources.intentResult(session, answer);
        expect(resources.canRelease(session, pattern.name)).toBe(true);
        expect(resources.canRelease(session, "migrations/001.sql")).toBe(false);
        expect(resources.canRelease(session, "src/pricing.ts")).toBe(false);
        expect(resources.canRelease({ ...session, project: "private" }, pattern.name)).toBe(false);
        expect(resources.canRelease({ ...session, workspace: "other" }, pattern.name)).toBe(false);
        expect(resources.status().held).toHaveLength(1);
        const headers = { "x-peer-session": session.id };
        expect(
          yield* Effect.promise(() => fixture.broker.runCli("release", [pattern.name], headers)),
        ).toBe("Released migrations/**.");
        expect(resources.status().held).toEqual([]);
        const releaseCalls = hub.calls.filter((c) => c.url?.endsWith("/release"));
        expect(releaseCalls).toHaveLength(1);
        expect(decode(releaseCalls[0]!.body)).toMatchObject({
          environment: "ana-laptop",
          session: session.id,
          target: pattern.name,
        });
        otherHolder = true;
        yield* resources.intentResult(session, {
          ...answer,
          verdicts: [
            {
              ...answer.verdicts[0]!,
              verdict: "held",
              hold: {
                ...pattern.holder,
                session: "claude:other",
                email: "bob@acme.test",
                expiresAt: pattern.expiresAt,
              },
            },
          ],
        });
        expect(resources.canRelease(session, pattern.name)).toBe(true);
        yield* Effect.promise(async () => {
          await expect(
            fixture.broker.runCli("release", [pattern.name], headers),
          ).rejects.toMatchObject({ outcome: "refused" });
        });
        expect(resources.status().held[0]?.holder.session).toBe("claude:other");
        expect(hub.calls.filter((c) => c.url?.endsWith("/release"))).toHaveLength(2);
        yield* state.updatePersisted((p) => ({ ...p, workspaces: [] }));
        expect(resources.canRelease(session, pattern.name)).toBe(false);
        expect(resources.status().held).toEqual([]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "claims, refuses another holder, releases without a stale ping, and keeps failure state honest",
    () =>
      Effect.gen(function* () {
        let held = false,
          verdict = "clear",
          offline = false,
          unsupported = false,
          forbidden = false,
          loseReply = true;
        const hub = yield* standInHub({
          current: (url) =>
            forbidden
              ? [403, { error: "forbidden", message: "Only a holder, lead or admin can release." }]
              : unsupported
                ? [404, {}]
                : offline
                  ? [503, {}]
                  : url.endsWith("/claim")
                    ? [200, { verdict, resource: hold, overlaps: [], at: "2026-10-09T12:00:00Z" }]
                    : url.endsWith("/release")
                      ? [200, { released: true, resource: hold, at: "2026-10-09T12:00:00Z" }]
                      : [
                          200,
                          {
                            held: held ? [hold] : [],
                            patterns: { app: [{ pattern: "migrations/**", policy: "exclusive" }] },
                            at: "2026-10-09T12:00:00Z",
                          },
                        ],
        });
        hub.server.prependListener("request", (request, response) => {
          if (loseReply && request.url?.endsWith("/claim")) {
            loseReply = false;
            request.on("end", () => response.destroy());
          }
        });
        const core = yield* Layer.build(
          coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "phs_test" }),
        );
        const state = yield* PeerState.pipe(Effect.provide(core));
        yield* (yield* PeerStatus.pipe(Effect.provide(core))).coordinationFrom(() =>
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
        yield* state.updatePersisted((p) => ({
          ...p,
          workspaces: p.workspaces.map((w) => ({
            ...w,
            manifest: {
              version: 2,
              workspace: { slug: "acme", name: "Acme", currency: "EUR" },
              member: { email: "ana@acme.test", name: "Ana", role: "member" },
              knowledge: {},
              projects: [project],
            },
          })),
        }));
        const fixture = yield* Effect.acquireRelease(
          Effect.promise(() => brokerFixture()),
          (f) => Effect.promise(f.dispose),
        );
        yield* Effect.promise(() => fixture.register("one"));
        yield* (yield* PeerAgents.pipe(Effect.provide(core))).attach(fixture.broker);
        const service = yield* PeerResources.pipe(Effect.provide(layer), Effect.provide(core));
        const session = fixture.broker.sessionViews()[0]!;
        const input = {
          session,
          args: ["resource:DEPLOY", "--ttl", "30m", "--intent", "deploying"],
          plain: ["resource:DEPLOY"],
          text: "resource:DEPLOY",
          flag: (f: string) => (f === "--ttl" ? "30m" : f === "--intent" ? "deploying" : undefined),
          cwd: undefined,
        };
        yield* service.refresh("acme");
        expect(service.policyFor(session, "migrations/001.sql", "notify")).toBe("exclusive");
        expect(yield* service.command("claim", input)).toContain("Held resource:deploy");
        expect(service.status().held[0]?.name).toBe("deploy");
        const body = decode(hub.calls.find((c) => c.url?.endsWith("/claim"))!.body) as Record<
          string,
          unknown
        >;
        expect(body).toMatchObject({
          name: "deploy",
          session: "claude:one",
          environment: "ana-laptop",
          ttlSeconds: 1800,
          intent: "deploying",
        });
        expect(body.op).toBeTypeOf("string");
        const sent = hub.calls.filter((c) => c.url?.endsWith("/claim"));
        expect(sent).toHaveLength(2);
        expect(decode(sent[1]!.body)).toMatchObject({ op: body.op });
        expect(sent[0]?.authorization).toBe("Bearer phs_test");
        expect(yield* service.block(session)).toContain("yours");
        expect(yield* service.block(session)).toContain("resource:deploy");
        const start = {
          session,
          event: "session-start" as const,
          source: "startup",
          remainingMs: 1200,
        };
        expect(yield* service.start(start)).toContain("resource:deploy");
        expect(yield* service.start({ ...start, source: "resume" })).toBeNull();
        expect(yield* service.start({ ...start, source: "compact" })).toContain("resource:deploy");
        yield* service.intentResult(session, {
          policy: "notify",
          policySource: "project",
          verdicts: [
            {
              path: "migrations/001.sql",
              verdict: "clear",
              with: [],
              overlaps: [],
              pattern: "migrations/**",
              policy: "exclusive",
              hold: { ...hold.holder, expiresAt: hold.expiresAt },
            },
          ],
          overlaps: [],
          at: "2026-10-09T12:00:00Z",
        });
        expect(service.canRelease(session, "migrations/002.sql")).toBe(true);
        expect(service.canRelease(session, "migrations/**")).toBe(true);
        expect(service.status().held.some((h) => h.kind === "pattern")).toBe(true);
        yield* service.releasePerson({
          workspace: "acme",
          project: "app",
          target: "resource:deploy",
          op: "person-release",
        });
        const person = decode(hub.calls.at(-1)!.body) as Record<string, unknown>;
        expect(person).toEqual({ target: "resource:deploy", op: "person-release" });
        forbidden = true;
        expect(
          yield* Effect.flip(
            service.releasePerson({ workspace: "acme", project: "app", target: "resource:deploy" }),
          ),
        ).toMatchObject({ refused: true });
        forbidden = false;
        yield* service.refresh("acme");
        verdict = "held";
        expect(yield* Effect.flip(service.command("claim", input))).toMatchObject({
          outcome: "refused",
        });
        expect(
          yield* service.command("release", {
            ...input,
            args: [],
            plain: [],
            flag: () => undefined,
          }),
        ).toContain("Released resource:deploy");
        expect(service.status().held).toEqual([]);
        offline = true;
        expect(yield* Effect.flip(service.command("claim", input))).toMatchObject({
          outcome: "uncertain",
        });
        expect(service.status().held).toEqual([]);
        offline = false;
        unsupported = true;
        yield* service.refresh("acme");
        expect(yield* Effect.flip(service.command("claim", input))).toMatchObject({
          outcome: "refused",
        });
        held = true;
        unsupported = false;
        yield* service.cleanup([]);
        yield* service.refresh("acme");
        expect(service.status().held).toEqual([]);
        yield* service.cleanup(["acme"]);
        yield* service.refresh("acme");
        expect(service.status().held).toHaveLength(1);
        yield* service.step({ session, event: "prompt", remainingMs: 1000 });
        held = false;
        yield* service.refresh("acme");
        expect(yield* service.step({ session, event: "prompt", remainingMs: 1000 })).toContain(
          "no longer held",
        );
        expect(yield* service.step({ session, event: "prompt", remainingMs: 1000 })).toBeNull();
        yield* Effect.promise(() => fixture.broker.host.log.idle());
        const log = yield* Effect.promise(() => NodeFSP.readFile(fixture.debugPath, "utf8"));
        for (const event of [
          "resource.claim",
          "resource.refused",
          "resource.release",
          "resource.lost",
        ])
          expect(log).toContain('"event":"' + event + '"');
        yield* service.cleanup([]);
        expect(yield* service.block(session)).toBeNull();
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

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
        yield* service.cleanup([]);
        expect(yield* service.block(session)).toBeNull();
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

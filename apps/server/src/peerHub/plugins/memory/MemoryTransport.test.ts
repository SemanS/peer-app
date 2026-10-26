import { describe, expect, it } from "@effect/vitest";
import { PeerMemoryCommandResult } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as Memory from "./MemoryTransport.ts";

const identity: Memory.MemoryIdentity = {
  hubUrl: "https://hub.test",
  email: "ana@acme.test",
  token: "hub-test-token",
  environmentId: "test",
};
const manifest = {
  version: 2,
  workspace: { slug: "acme", name: "Acme", currency: "EUR" },
  member: { email: identity.email, name: "Ana", role: "member" },
  knowledge: {},
  projects: [],
};
const layer = (
  email = identity.email,
  refusal?: { readonly status: number; readonly code: string },
) =>
  Memory.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          Memory.MemoryAuth,
          Memory.MemoryAuth.of({
            identity: Effect.succeed(identity),
            repository: () =>
              Effect.fail(
                new Memory.MemoryError({
                  code: "invalid",
                  detail: "No configured knowledge repository.",
                }),
              ),
          }),
        ),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                refusal === undefined
                  ? Response.json({ ...manifest, member: { ...manifest.member, email } })
                  : Response.json(
                      { error: { code: refusal.code, message: "Refused" } },
                      { status: refusal.status },
                    ),
              ),
            ),
          ),
        ),
      ),
    ),
  );

describe("company memory membership authorization", () => {
  it.effect.each([
    [409, "memory_disabled", "disabled"],
    [409, "version_conflict", "conflict"],
    [403, "forbidden", "not_found"],
  ] as const)("preserves the HTTP %s %s refusal classification", ([status, code, expected]) =>
    Effect.gen(function* () {
      const memory = yield* Memory.MemoryTransport;
      const error = yield* memory
        .request(
          identity,
          { workspace: "acme", project: "app" },
          "POST",
          "/commands",
          PeerMemoryCommandResult,
          {},
        )
        .pipe(Effect.flip);
      expect(error.code).toBe(expected);
    }).pipe(Effect.provide(layer(identity.email, { status, code }))),
  );

  it.effect("authorizes company graph reads without a configured knowledge checkout", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.MemoryTransport;
      yield* memory.authorize(identity, { workspace: "acme", project: "company" });
      const denied = yield* memory
        .authorize(identity, { workspace: "acme", project: "unavailable-project" })
        .pipe(Effect.flip);
      expect(denied.code).toBe("not_found");
      const wrongWorkspace = yield* memory
        .authorize(identity, { workspace: "other", project: "company" })
        .pipe(Effect.flip);
      expect(wrongWorkspace.code).toBe("not_found");
    }).pipe(Effect.provide(layer())),
  );

  it.effect("fails closed if today's manifest belongs to another verified person", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.MemoryTransport;
      const denied = yield* memory
        .authorize(identity, { workspace: "acme", project: "company" })
        .pipe(Effect.flip);
      expect(denied.code).toBe("not_found");
    }).pipe(Effect.provide(layer("bob@acme.test"))),
  );
});

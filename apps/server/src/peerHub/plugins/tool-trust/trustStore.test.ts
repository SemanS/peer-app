// @effect-diagnostics nodeBuiltinImport:off - temporary isolated persistence tests.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { it, describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { PeerToolTrustStatus, type PeerTool } from "@t3tools/contracts";
import { SecretStoreRemoveError } from "../../../auth/ServerSecretStore.ts";
import { makeTrustStore } from "./trustStore.ts";
import { definition } from "./definition.ts";
const encodeStatus = Schema.encodeEffect(Schema.fromJsonString(PeerToolTrustStatus));
const tracker: PeerTool = {
  id: "tracker",
  name: "Tracker",
  requires: [],
  mcp: {
    transport: "http",
    url: "https://example.test",
    headers: { Authorization: "Bearer ${secret:TRACKER_TOKEN}" },
  },
};
const workspace = (slug = "acme", tool = tracker) => ({
  slug,
  manifest: {
    workspace: { slug, name: slug, currency: "EUR" as const, appliedBy: "ana", appliedAt: "now" },
    projects: [
      {
        id: "app",
        name: "App",
        role: "member" as const,
        members: [],
        repositories: [],
        knowledge: { kontext: false, company: false },
        capacity: { personal: "any" as const, personalHarnesses: [] },
        tools: [tool],
      },
    ],
  },
});
const fixture = Effect.gen(function* () {
  const dir = yield* Effect.acquireRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-trust-"))),
    (dir) => Effect.promise(() => NodeFSP.rm(dir, { recursive: true, force: true })),
  );
  const values = new Map<string, Uint8Array>();
  let workspaces = [workspace()];
  const env: Record<string, string | undefined> = { TRACKER_TOKEN: "ambient" };
  const secrets = {
    get: (name: string) => Effect.sync(() => Option.fromNullishOr(values.get(name))),
    set: (name: string, value: Uint8Array) =>
      Effect.sync(() => {
        values.set(name, value);
      }),
    remove: (name: string) =>
      Effect.sync(() => {
        values.delete(name);
      }),
  };
  const options = { stateDir: dir, secrets, workspaces: () => workspaces, environment: env };
  const store = yield* makeTrustStore(options);
  return {
    dir,
    values,
    env,
    store,
    options,
    replace: (next: typeof workspaces) => {
      workspaces = next;
    },
    approve: () =>
      store.approve({
        items: [
          {
            workspace: "acme",
            tool: "tracker",
            fingerprint: definition(workspaces[0]!.manifest!.projects[0]!.tools[0]!).fingerprint,
          },
        ],
      }),
    decide: () =>
      store.decide({
        workspace: "acme",
        project: "app",
        tool: workspaces[0]!.manifest!.projects[0]!.tools[0]!,
      }),
  };
});
describe("local tool trust store", () => {
  it.effect("refuses an approved definition from a stale provider policy snapshot", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.approve();
        yield* f.store.setSecret({
          workspace: "acme",
          name: "TRACKER_TOKEN",
          source: { kind: "value", value: "private" },
        });
        expect(f.store.decide({ workspace: "acme", project: "app", tool: tracker }).give).toBe(
          true,
        );
        f.replace([
          workspace("acme", {
            ...tracker,
            mcp: { transport: "stdio", command: "changed", args: [], env: {} },
          }),
        ]);
        expect(f.store.decide({ workspace: "acme", project: "app", tool: tracker }).give).toBe(
          false,
        );
        expect(
          f.store.decide({ workspace: "acme", project: "removed-project", tool: tracker }).give,
        ).toBe(false);
      }),
    ),
  );
  it.effect("holds legacy lowercase references even when the Hub can apply them", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.approve();
        yield* f.store.setSecret({
          workspace: "acme",
          name: "TRACKER_TOKEN",
          source: { kind: "environment" },
        });
        let reads = 0;
        Object.defineProperty(f.env, "tracker_token", {
          get: () => {
            reads++;
            return "unallowed";
          },
        });
        f.replace([
          workspace("acme", {
            ...tracker,
            mcp: {
              transport: "http",
              url: "https://example.test",
              headers: { Authorization: "Bearer ${secret:tracker_token}" },
            },
          }),
        ]);
        expect(f.store.status().workspaces[0]!.tools[0]!.state).toBe("invalid");
        expect((yield* Effect.result(f.approve()))._tag).toBe("Failure");
        expect(f.decide().give).toBe(false);
        expect(reads).toBe(0);
      }),
    ),
  );
  it.effect("failed removal remains closed across immediate rejoining and can retry", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.approve();
        yield* f.store.setSecret({
          workspace: "acme",
          name: "TRACKER_TOKEN",
          source: { kind: "value", value: "private" },
        });
        let fail = true;
        const store = yield* makeTrustStore({
          ...f.options,
          secrets: {
            ...f.options.secrets,
            remove: (name) =>
              fail
                ? Effect.fail(new SecretStoreRemoveError({ resource: "test", cause: "refused" }))
                : f.options.secrets.remove(name),
          },
        });
        f.replace([]);
        expect((yield* Effect.result(store.forgetAbsent()))._tag).toBe("Failure");
        f.replace([workspace()]);
        expect(store.decide({ workspace: "acme", project: "app", tool: tracker }).give).toBe(false);
        fail = false;
        yield* store.forgetAbsent();
        expect(store.status().workspaces[0]!.tools[0]!.state).toBe("review");
        expect(f.values.size).toBe(0);
      }),
    ),
  );
  it.effect("failed forgetting of an allowed variable never falls back to it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.approve();
        yield* f.store.setSecret({
          workspace: "acme",
          name: "TRACKER_TOKEN",
          source: { kind: "environment" },
        });
        const store = yield* makeTrustStore({
          ...f.options,
          secrets: {
            ...f.options.secrets,
            remove: () =>
              Effect.fail(new SecretStoreRemoveError({ resource: "test", cause: "refused" })),
          },
        });
        expect(store.decide({ workspace: "acme", project: "app", tool: tracker }).give).toBe(true);
        expect(
          (yield* Effect.result(
            store.setSecret({ workspace: "acme", name: "TRACKER_TOKEN", source: { kind: "none" } }),
          ))._tag,
        ).toBe("Failure");
        expect(store.decide({ workspace: "acme", project: "app", tool: tracker }).give).toBe(false);
      }),
    ),
  );

  it.effect("starts empty, persists privately and reloads approvals and stored secrets", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        expect(f.decide().give).toBe(false);
        yield* f.approve();
        expect(f.store.status().workspaces[0]!.tools[0]!.state).toBe("secret");
        yield* f.store.setSecret({
          workspace: "acme",
          name: "TRACKER_TOKEN",
          source: { kind: "value", value: "private" },
        });
        expect(f.decide()).toEqual({
          give: true,
          secrets: new Map([["TRACKER_TOKEN", "private"]]),
        });
        expect(
          (yield* Effect.promise(() => NodeFSP.stat(NodePath.join(f.dir, "peer-tool-trust.json"))))
            .mode & 0o777,
        ).toBe(0o600);
        const reloaded = yield* makeTrustStore(f.options);
        expect(reloaded.decide({ workspace: "acme", project: "app", tool: tracker }).give).toBe(
          true,
        );
        const serialized = yield* encodeStatus(reloaded.status());
        expect(serialized).not.toContain("private");
        expect(serialized).not.toContain("ambient");
      }),
    ),
  );
  it.effect("quarantines unknown and unreadable versions", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(f.dir, "peer-tool-trust.json"), '{"version":99}'),
        );
        const store = yield* makeTrustStore(f.options);
        expect(store.status().error).toBeDefined();
        expect(store.decide({ workspace: "acme", project: "app", tool: tracker }).give).toBe(false);
        expect(
          (yield* Effect.promise(() => NodeFSP.readdir(f.dir))).some((name) =>
            name.includes(".unreadable-"),
          ),
        ).toBe(true);
      }),
    ),
  );
  it.effect(
    "never reads a variable until allowed, isolates workspaces, and refuses bad values",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* fixture;
          let reads = 0;
          Object.defineProperty(f.env, "TRACKER_TOKEN", {
            configurable: true,
            enumerable: true,
            get: () => {
              reads++;
              return "ambient";
            },
          });
          yield* f.approve();
          f.decide();
          f.store.status();
          expect(reads).toBe(0);
          yield* f.store.setSecret({
            workspace: "acme",
            name: "TRACKER_TOKEN",
            source: { kind: "environment" },
          });
          expect(f.decide().give).toBe(true);
          expect(reads).toBeGreaterThan(0);
          f.replace([workspace(), workspace("other")]);
          yield* f.store.approve({
            items: [
              { workspace: "other", tool: "tracker", fingerprint: definition(tracker).fingerprint },
            ],
          });
          expect(f.store.decide({ workspace: "other", project: "app", tool: tracker }).give).toBe(
            false,
          );
          Object.defineProperty(f.env, "TRACKER_TOKEN", { value: undefined, writable: true });
          expect(f.decide().give).toBe(false);
          f.env.TRACKER_TOKEN = "bad\nvalue";
          expect(f.decide().give).toBe(false);
          const result = yield* Effect.result(
            f.store.setSecret({
              workspace: "acme",
              name: "TRACKER_TOKEN",
              source: { kind: "value", value: "bad\rvalue" },
            }),
          );
          expect(result._tag).toBe("Failure");
        }),
      ),
  );
  it.effect("refuses stale batches atomically, is idempotent, and keeps off after changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const fp = definition(tracker).fingerprint;
        const stale = yield* Effect.result(
          f.store.approve({
            items: [
              { workspace: "acme", tool: "tracker", fingerprint: fp },
              { workspace: "acme", tool: "other", fingerprint: "old" },
            ],
          }),
        );
        expect(stale._tag).toBe("Failure");
        expect(f.store.status().workspaces[0]!.tools[0]!.state).toBe("review");
        yield* f.approve();
        const contents = yield* Effect.promise(() =>
          NodeFSP.readFile(NodePath.join(f.dir, "peer-tool-trust.json"), "utf8"),
        );
        yield* f.approve();
        expect(
          yield* Effect.promise(() =>
            NodeFSP.readFile(NodePath.join(f.dir, "peer-tool-trust.json"), "utf8"),
          ),
        ).toBe(contents);
        yield* f.store.turnOff({ items: [{ workspace: "acme", tool: "tracker" }] });
        f.replace([
          workspace("acme", {
            ...tracker,
            mcp: { ...tracker.mcp, transport: "http", url: "https://new.test", headers: {} },
          }),
        ]);
        expect(f.store.status().workspaces[0]!.tools[0]!.state).toBe("off");
        yield* f.approve();
        expect(f.decide().give).toBe(true);
      }),
    ),
  );
  it.effect("forgets only departed workspaces, then all on sign-out", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        f.replace([workspace(), workspace("other")]);
        for (const slug of ["acme", "other"])
          yield* f.store.setSecret({
            workspace: slug,
            name: "TRACKER_TOKEN",
            source: { kind: "value", value: slug },
          });
        yield* f.approve();
        f.replace([workspace("other")]);
        yield* f.store.forgetAbsent();
        expect(f.values.has("peer-tool-secret--acme--TRACKER_TOKEN")).toBe(false);
        expect(f.values.has("peer-tool-secret--other--TRACKER_TOKEN")).toBe(true);
        f.replace([]);
        yield* f.store.forgetAbsent();
        expect(f.values.size).toBe(0);
        f.replace([workspace()]);
        expect(f.store.status().workspaces[0]!.tools[0]!.state).toBe("review");
      }),
    ),
  );
});

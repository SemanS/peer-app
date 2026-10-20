import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { vi } from "vite-plus/test";

import { resolveClaudePeerHookHomes } from "./claudeHookHomes.ts";

afterEach(() => vi.unstubAllEnvs());

it.effect("uses the drivers' home precedence and excludes disabled and unrelated instances", () =>
  Effect.gen(function* () {
    vi.stubEnv("CLAUDE_CONFIG_DIR", "/ambient");
    const home = yield* HostProcess.HomeDirectory;
    const path = yield* Path.Path;
    const homes = yield* resolveClaudePeerHookHomes(
      {
        [ProviderInstanceId.make("claude-direct")]: {
          driver: ProviderDriverKind.make("claude"),
          config: { homePath: "~/claude-direct" },
          environment: [{ name: "CLAUDE_CONFIG_DIR", value: "/ignored", sensitive: false }],
        },
        [ProviderInstanceId.make("claude-env")]: {
          driver: ProviderDriverKind.make("claude"),
          environment: [{ name: "CLAUDE_CONFIG_DIR", value: "~/claude-env", sensitive: false }],
        },
        [ProviderInstanceId.make("claude-default")]: { driver: ProviderDriverKind.make("claude") },
        [ProviderInstanceId.make("claude-disabled")]: {
          driver: ProviderDriverKind.make("claude"),
          enabled: false,
          config: { homePath: "/disabled" },
        },
        [ProviderInstanceId.make("codex")]: { driver: ProviderDriverKind.make("codex") },
      },
      "/ambient",
    );
    assert.deepStrictEqual(homes, [
      "/ambient",
      path.join(home, "claude-direct"),
      path.join(home, "claude-env"),
    ]);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("deduplicates matching homes without expanding inherited shell syntax", () =>
  Effect.gen(function* () {
    vi.stubEnv("CLAUDE_CONFIG_DIR", "~/literal");
    const path = yield* Path.Path;
    const homes = yield* resolveClaudePeerHookHomes(
      {
        [ProviderInstanceId.make("claude-a")]: {
          driver: ProviderDriverKind.make("claude"),
          config: { homePath: "/ambient" },
        },
        [ProviderInstanceId.make("claude-b")]: {
          driver: ProviderDriverKind.make("claude"),
          config: { homePath: "/ambient" },
        },
        [ProviderInstanceId.make("claude-inherited")]: {
          driver: ProviderDriverKind.make("claude"),
        },
      },
      "/ambient",
    );
    assert.deepStrictEqual(homes, ["/ambient", path.resolve("~/literal")]);
  }).pipe(Effect.provide(NodeServices.layer)),
);

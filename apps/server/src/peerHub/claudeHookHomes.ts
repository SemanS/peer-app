import {
  ClaudeSettings,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  resolveProviderInstanceEnabled,
} from "@t3tools/contracts";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { resolveClaudeHomePath } from "../provider/Drivers/ClaudeHome.ts";

const decodeClaudeSettings = Schema.decodeUnknownSync(ClaudeSettings);

export const resolveClaudePeerHookHomes = Effect.fn("resolveClaudePeerHookHomes")(function* (
  instances: Readonly<Record<ProviderInstanceId, ProviderInstanceConfig>>,
  ambientHome: string,
) {
  const path = yield* Path.Path;
  const homes = new Set([path.resolve(ambientHome)]);
  for (const instance of Object.values(instances)) {
    if (instance.driver !== "claude" || !resolveProviderInstanceEnabled(instance)) continue;
    const config = decodeClaudeSettings(instance.config ?? {});
    const environment = yield* mergeProviderInstanceEnvironment(instance.environment);
    homes.add(yield* resolveClaudeHomePath(config, environment));
  }
  return [...homes];
});

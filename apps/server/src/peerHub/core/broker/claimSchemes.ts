import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { PeerCommandInput, PeerContributions } from "../plugin.ts";
import type { PeerBrokerPlugins } from "./host.ts";
import type { CoordinationBroker } from "./Broker.ts";
import { CliError, hubFailure, usage, uncertain } from "./cliContract.ts";
type Scheme = NonNullable<PeerContributions["claimScheme"]>;
export const claimSchemes = (plugins: PeerBrokerPlugins) =>
  plugins.active.flatMap(({ contributions }) =>
    contributions.claimScheme ? [contributions.claimScheme] : [],
  );

/** Splits only after every scheme and every ordinary path has been validated, before mutation. */
export function claimTargets(
  command: "claim" | "release",
  schemes: ReadonlyArray<Scheme>,
  input: PeerCommandInput,
  relative: (path: string) => string | null,
) {
  for (const scheme of schemes) scheme.validate(command, input);
  const delegated = new Map<Scheme, string[]>();
  const files: string[] = [];
  for (const path of input.plain) {
    const prefixed = schemes.find((s) => path.startsWith(s.prefix));
    if (prefixed) {
      const targets = delegated.get(prefixed) ?? [];
      targets.push(path);
      delegated.set(prefixed, targets);
      continue;
    }
    const normalized = /^[a-z][a-z0-9-]*:/.test(path) ? null : relative(path);
    if (normalized === null)
      throw usage(
        "name files or directories (ending in /) inside this repository, or an enabled claim scheme",
        "run peer claim src/pay.ts or enable the plugin for the target scheme.",
      );
    const scheme =
      command === "release"
        ? schemes.find(
            (s) =>
              s.recognizesRelease(input.session, path) ||
              s.recognizesRelease(input.session, normalized),
          )
        : undefined;
    if (scheme) {
      const targets = delegated.get(scheme) ?? [];
      targets.push(scheme.recognizesRelease(input.session, path) ? path : normalized);
      delegated.set(scheme, targets);
      continue;
    }
    files.push(path.endsWith("/") && !normalized.endsWith("/") ? `${normalized}/` : normalized);
  }
  if (command === "claim" && input.plain.length === 0)
    throw usage("name at least one claim target", "run peer claim src/pay.ts.");
  if (command === "release" && input.plain.length === 0)
    for (const scheme of schemes) delegated.set(scheme, []);
  return { files, delegated };
}

export async function runClaimSchemes(
  broker: CoordinationBroker,
  command: "claim" | "release",
  input: PeerCommandInput,
  targets: ReadonlyMap<Scheme, ReadonlyArray<string>>,
) {
  const lines: string[] = [];
  for (const [scheme, plain] of targets) {
    const result = await broker.host.run(Effect.result(scheme.run(command, { ...input, plain })), {
      signal: broker.stopping.signal,
    });
    if (Result.isFailure(result)) {
      if (lines.length)
        throw uncertain(
          command,
          "An earlier target may already have changed. Run peer status before retrying.",
        );
      const failure = result.failure;
      if (failure instanceof CliError) throw failure;
      throw hubFailure(failure, command, "run peer status and retry when the requirement is met.");
    }
    if (result.success) lines.push(result.success);
  }
  return lines;
}

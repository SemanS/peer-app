import type { PeerProjectPolicy } from "@t3tools/contracts";
import type { PeerBrokerPlugins } from "./host.ts";
import type { PeerSessionView } from "../plugin.ts";
import { unverifiedAnswer, type SessionMemory } from "../coordination/edits.ts";
export function fallbackAnswers(
  plugins: PeerBrokerPlugins,
  session: PeerSessionView | undefined,
  files: ReadonlyArray<string>,
  base: PeerProjectPolicy,
  memory: SessionMemory,
) {
  const groups = new Map<PeerProjectPolicy, string[]>();
  for (const file of files) {
    const policy =
      session === undefined
        ? base
        : plugins.active.reduce(
            (current, { contributions }) =>
              contributions.fallbackPolicy?.(session, file, base) ?? current,
            base,
          );
    const group = groups.get(policy) ?? [];
    group.push(file);
    groups.set(policy, group);
  }
  return [...groups].map(([policy, paths]) => ({
    file: paths[0]!,
    files: paths,
    policy,
    answer: unverifiedAnswer({ policy, files: paths, memory }),
  }));
}

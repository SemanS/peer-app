import { WS_METHODS, type EnvironmentId, type PeerOpenSpecReadInput } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { request } from "../rpc/client.ts";
import { createEnvironmentQueryAtomFamily } from "../state/runtime.ts";

export function createOpenSpecEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const read = createEnvironmentQueryAtomFamily(runtime, {
    label: "environment-data:peer.openspec.read",
    staleTimeMs: 0,
    idleTtlMs: 0,
    execute: ({ person: _person, ...input }: PeerOpenSpecReadInput & { person: string }) =>
      request(WS_METHODS.peerOpenSpecRead, input),
  });
  return {
    read: (target: {
      readonly environmentId: EnvironmentId;
      readonly person: string;
      readonly input: PeerOpenSpecReadInput;
    }) =>
      read({
        environmentId: target.environmentId,
        input: { ...target.input, person: target.person },
      }),
  };
}

/** A compact source excerpt; callers keep the complete proposal available separately. */
export function openSpecGoal(proposal: string): string {
  const lines = proposal.replace(/\r\n?/g, "\n").trim().split("\n");
  const why = lines.findIndex((line) => /^#{1,6}\s+Why\s*#*\s*$/i.test(line));
  const body = why < 0 ? lines : lines.slice(why + 1);
  const nextHeading = why < 0 ? -1 : body.findIndex((line) => /^#{1,6}\s+/.test(line));
  const section = (nextHeading < 0 ? body : body.slice(0, nextHeading))
    .join("\n")
    .replace(/^(?:\s*#{1,6}[^\n]*\n)+/, "")
    .trim();
  const excerpt = why < 0 ? (section.split(/\n\s*\n/)[0] ?? "") : section;
  return excerpt.length > 1_200 ? `${excerpt.slice(0, 1_199).trimEnd()}…` : excerpt;
}

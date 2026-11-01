import type { PeerProjectPolicy } from "@t3tools/contracts";
import { unverifiedAnswer, type SessionMemory } from "../coordination/edits.ts";

/** What applies to `files` while the Hub gives no verdict: the policy, for all of them at once. */
export function fallbackAnswers(
  files: ReadonlyArray<string>,
  policy: PeerProjectPolicy,
  memory: SessionMemory,
) {
  return files.length === 0
    ? []
    : [
        {
          file: files[0]!,
          files,
          policy,
          answer: unverifiedAnswer({ policy, files, memory }),
        },
      ];
}

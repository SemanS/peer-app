import { PeerHubError, type PeerDigest, type PeerDigestInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
export const digestGet =
  (
    belongs: (workspace: string, project: string) => boolean,
    fetch: (input: PeerDigestInput) => Effect.Effect<PeerDigest | null, PeerHubError>,
  ) =>
  (input: PeerDigestInput) =>
    belongs(input.workspace, input.project)
      ? fetch(input)
      : Effect.fail(new PeerHubError({ detail: "This project is not in a workspace of yours." }));

/**
 * The settle plugin's one Hub call: a person-less note on an overlap, core's existing route. The
 * Hub admits a note without a session as the signed-in person's, which a handover is: their Peer
 * says so. `op` makes a repeated handover one note.
 *
 * @module peerHub/plugins/settle/hub
 */
import * as Schema from "effect/Schema";

import type * as PeerHubClient from "../../core/hub/PeerHubClient.ts";

const segment = encodeURIComponent;
const Noted = Schema.Struct({ id: Schema.String });

export const settleHub = (client: PeerHubClient.PeerHubClient["Service"]) => ({
  handover: (input: {
    readonly workspace: string;
    readonly project: string;
    readonly overlap: string;
    readonly text: string;
    readonly op: string;
  }) =>
    client.request(Noted, {
      workspace: input.workspace,
      path: `/coord/${segment(input.project)}/${segment(input.overlap)}/notes`,
      method: "POST",
      body: { text: input.text, op: input.op },
      timeoutMs: 5_000,
    }),
});

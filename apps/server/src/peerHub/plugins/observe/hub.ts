/**
 * Observe's Hub endpoints (the Hub's `observe` feature): a colleague's shared thread as the Hub
 * relays it, and the views this computer sends of its own shared threads while someone watches.
 *
 * @module peerHub/plugins/observe/hub
 */
import { PeerAgentView } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type * as PeerHubClient from "../../core/hub/PeerHubClient.ts";

const decodeView = Schema.decodeUnknownOption(Schema.fromJsonString(PeerAgentView));
const Watchers = Schema.Struct({ watchers: Schema.Number });

const threadPath = (environment: string, thread: string) =>
  `/observe/${encodeURIComponent(environment)}/${encodeURIComponent(thread)}`;

/** The endpoints, called on the signed-in session. */
export const observeHub = (client: PeerHubClient.PeerHubClient["Service"]) => ({
  /**
   * A colleague's shared thread as the Hub relays it while you watch: each view its owner's Peer
   * sends. Ends when the Hub closes the stream; fails when the thread is not shared with you (any
   * more).
   */
  relay: (workspace: string, environment: string, thread: string) =>
    client
      .stream({
        workspace,
        path: threadPath(environment, thread),
        texts: {
          notFound: "That thread is not shared with you, or no longer runs.",
          refused: (status) => `The hub refused to relay that thread (HTTP ${status}).`,
          silent: "The relayed thread went silent.",
          broken: "The relayed thread broke off.",
        },
      })
      .pipe(
        Stream.filter((event) => event.event === "view"),
        Stream.map((event) => Option.getOrUndefined(decodeView(event.data))),
        Stream.filter((view): view is PeerAgentView => view !== undefined),
      ),

  /** Sends a view of one of this environment's shared threads to whoever watches it; how many do. */
  publish: (workspace: string, environment: string, thread: string, view: PeerAgentView) =>
    client
      .request(Watchers, {
        workspace,
        path: threadPath(environment, thread),
        method: "PUT",
        body: view,
      })
      .pipe(Effect.map((answer) => answer.watchers)),
});

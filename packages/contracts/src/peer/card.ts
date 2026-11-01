import * as Schema from "effect/Schema";

/**
 * Peer's card plugin: what a person's agents read when they start, in that person's own words (where
 * their memory is, what may be shared, whether they may be interrupted). Peer passes it on and knows
 * nothing about the tools it names. It stays on the person's computer, and needs no Hub.
 */
export const PEER_CARD_PLUGIN = {
  id: "card",
  title: "Your card",
  summary: "Tell your agents how you work, in your own words.",
  defaultEnabled: true,
} as const;

export const PEER_CARD_MAX = 1_000;

export const PeerCard = Schema.Struct({
  text: Schema.String,
  /** Their yes in advance: a colleague's words may wake their idle agent. They start none. */
  teammatesMayWake: Schema.Boolean,
});
export type PeerCard = typeof PeerCard.Type;

export const PEER_EMPTY_CARD: PeerCard = { text: "", teammatesMayWake: false };

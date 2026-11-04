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
  /** Their yes in advance, on until they turn it off: a colleague's words may wake their idle agent. They start none. */
  teammatesMayWake: Schema.Boolean,
});
export type PeerCard = typeof PeerCard.Type;

// A person who never saved a card wakes for colleagues, the way agent relays deliver (Hub
// docs/compliance.md 1a); they turn it off on the card.
export const PEER_EMPTY_CARD: PeerCard = { text: "", teammatesMayWake: true };

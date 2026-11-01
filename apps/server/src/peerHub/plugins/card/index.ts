/**
 * The card plugin: a person's own words, which their agents read when they start. Peer passes them
 * on as its person's, unfenced, and holds no opinion on the tools they name. It works without a Hub.
 *
 * @module peerHub/plugins/card
 */
import {
  CardRpcGroup,
  PEER_CARD_MAX,
  PEER_CARD_METHODS as methods,
  PEER_CARD_PLUGIN,
  type PeerCard,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { bindPlugin, cardData, cardOf, type PeerContributions } from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";

export const NO_CARD = "Your person has no card yet.";

/** A person's card as their own agent reads it: their words, so not fenced as a teammate's are. */
export const cardText = (text: string) => `Your person's card, in their own words:\n${text}`;

export const CardPlugin = bindPlugin({
  ...PEER_CARD_PLUGIN,
  id: "card",
  commandNames: ["card"],
  layer: Layer.empty,
  make: Effect.gen(function* () {
    const state = yield* PeerState.PeerState;
    const save = Effect.fn("PeerCard.save")(function* (card: PeerCard) {
      const kept = { ...card, text: card.text.trim().slice(0, PEER_CARD_MAX) };
      yield* cardData(state)
        .update(() => kept)
        .pipe(state.lock.withPermits(1));
      return kept;
    });
    return {
      commands: [
        {
          name: "card",
          usage: "card",
          summary:
            "read your person's card: where their memory is, what may be shared, how to reach them",
          run: () =>
            Effect.map(cardOf(state), ({ text }) => (text === "" ? NO_CARD : cardText(text))),
        },
      ],
      agentTools: [
        {
          name: "peer_card",
          description:
            "Read your person's card: where their memory is, what may be shared and how to reach them.",
          command: "card",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          arguments: () => [],
        },
      ],
      hooks: {
        priority: "first",
        sessionStart: () =>
          Effect.map(cardOf(state), ({ text }) => (text === "" ? null : cardText(text))),
      },
      rpc: {
        group: CardRpcGroup,
        handlers: (wrap) =>
          CardRpcGroup.of({
            [methods.peerCardRead]: () => wrap.effect(methods.peerCardRead, cardOf(state)),
            [methods.peerCardSave]: (input) => wrap.effect(methods.peerCardSave, save(input)),
          }),
      },
    } satisfies PeerContributions;
  }),
});

/**
 * A person's card, kept in the card plugin's state. The rooms plugin reads its yes in advance here.
 *
 * @module peerHub/core/state/card
 */
import { PEER_EMPTY_CARD, PeerCard } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type * as PeerState from "./PeerState.ts";

export const cardData = (state: PeerState.PeerState["Service"]) =>
  state.pluginData("card", PeerCard);

export const cardOf = (state: PeerState.PeerState["Service"]) =>
  Effect.map(
    cardData(state).read,
    Option.getOrElse(() => PEER_EMPTY_CARD),
  );

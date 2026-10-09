/**
 * herdr as the herdr plugin talks to it: through the socket where herdr's server listens now
 * (`herdr.ts`, `start.ts`). Tests put a stand-in in its place, so none talks to a real herdr.
 *
 * @module peerHub/plugins/herdr/client/HerdrClient
 */
import * as Context from "effect/Context";

import {
  focusHerdrAgent,
  followHerdrAgents,
  listHerdrAgents,
  notifyHerdr,
  promptHerdrAgent,
  readHerdrAgent,
  wakeHerdrAgent,
  type HerdrAgent,
  type HerdrFollower,
  type HerdrRead,
  type HerdrWakeResult,
} from "./herdr.ts";
import { startHerdrAgent, type StartedHerdrAgent, type StartHerdrAgentInput } from "./start.ts";

/** herdr as the plugin uses it; each call rejects as its protocol function does. */
export interface HerdrClientShape {
  /** Follows herdr's agents (`followHerdrAgents`); `onChange` says to read them again. */
  readonly follow: (onChange: () => void, retryMs: number) => HerdrFollower;
  /** The agents herdr runs now, or null when no herdr server listens here. */
  readonly list: () => Promise<ReadonlyArray<HerdrAgent> | null>;
  /** The end of an agent's terminal. */
  readonly read: (paneId: string) => Promise<HerdrRead>;
  /** Types a prompt into an agent (by its live name or its pane) and sends it. */
  readonly prompt: (target: string, text: string) => Promise<void>;
  /** Wakes an idle agent with `text`, once herdr confirms it is still the one expected. */
  readonly wake: (expected: HerdrAgent, text: string) => Promise<HerdrWakeResult>;
  /** Brings an agent's pane forward in herdr. */
  readonly focus: (paneId: string) => Promise<void>;
  /** A notification where people here run their agents. */
  readonly notify: (title: string, body: string) => Promise<void>;
  /** Starts an agent in a pane of Peer's own herdr workspace. */
  readonly start: (input: StartHerdrAgentInput) => Promise<StartedHerdrAgent>;
}

/** herdr on this computer, at the socket its environment names when each call is made. */
export class HerdrClient extends Context.Reference<HerdrClientShape>(
  "t3/peerHub/plugins/herdr/client/HerdrClient",
  {
    defaultValue: () => ({
      follow: (onChange, retryMs) => followHerdrAgents({ onChange, retryMs }),
      list: () => listHerdrAgents(),
      read: (paneId) => readHerdrAgent(paneId),
      prompt: (target, text) => promptHerdrAgent(target, text),
      wake: (expected, text) => wakeHerdrAgent(expected, text),
      focus: (paneId) => focusHerdrAgent(paneId),
      notify: (title, body) => notifyHerdr(title, body),
      start: (input) => startHerdrAgent(input),
    }),
  },
) {}

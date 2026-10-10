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

/**
 * herdr as the plugin uses it; each call rejects as its protocol function does. A call goes to the
 * socket it is given as its last argument, and otherwise to the one the environment names.
 */
export interface HerdrClientShape {
  /**
   * Follows herdr's agents (`followHerdrAgents`); `onChange` says to read them again. A function
   * for the socket is asked at each read, so the follower moves with a herdr that changes.
   */
  readonly follow: (
    onChange: () => void,
    retryMs: number,
    socketPath?: string | (() => string),
  ) => HerdrFollower;
  /** The agents herdr runs now, or null when no herdr server listens here. */
  readonly list: (socketPath?: string) => Promise<ReadonlyArray<HerdrAgent> | null>;
  /** The end of an agent's terminal. */
  readonly read: (paneId: string, socketPath?: string) => Promise<HerdrRead>;
  /** Types a prompt into an agent (by its live name or its pane) and sends it. */
  readonly prompt: (target: string, text: string, socketPath?: string) => Promise<void>;
  /** Wakes an idle agent with `text`, once herdr confirms it is still the one expected. */
  readonly wake: (
    expected: HerdrAgent,
    text: string,
    socketPath?: string,
  ) => Promise<HerdrWakeResult>;
  /** Brings an agent's pane forward in herdr. */
  readonly focus: (paneId: string, socketPath?: string) => Promise<void>;
  /** A notification where people here run their agents. */
  readonly notify: (title: string, body: string, socketPath?: string) => Promise<void>;
  /** Starts an agent in a pane of Peer's own herdr workspace. */
  readonly start: (input: StartHerdrAgentInput, socketPath?: string) => Promise<StartedHerdrAgent>;
}

/** herdr on this computer, at the socket its environment names when each call is made. */
export class HerdrClient extends Context.Reference<HerdrClientShape>(
  "t3/peerHub/plugins/herdr/client/HerdrClient",
  {
    defaultValue: () => ({
      follow: (onChange, retryMs, socketPath) =>
        followHerdrAgents({
          onChange,
          retryMs,
          ...(socketPath === undefined ? {} : { socketPath }),
        }),
      list: (socketPath) => listHerdrAgents(socketPath),
      read: (paneId, socketPath) => readHerdrAgent(paneId, undefined, socketPath),
      prompt: (target, text, socketPath) => promptHerdrAgent(target, text, socketPath),
      wake: (expected, text, socketPath) => wakeHerdrAgent(expected, text, socketPath),
      focus: (paneId, socketPath) => focusHerdrAgent(paneId, socketPath),
      notify: (title, body, socketPath) => notifyHerdr(title, body, socketPath),
      start: (input, socketPath) =>
        startHerdrAgent(input, socketPath === undefined ? {} : { socketPath }),
    }),
  },
) {}

/**
 * `client` with every call going to the socket `socketPath()` names when the call is made, unless
 * the call names one. The follower is given the function, so it moves with a herdr that changes.
 */
export function boundHerdrClient(
  client: HerdrClientShape,
  socketPath: () => string,
): HerdrClientShape {
  return {
    follow: (onChange, retryMs, socket) => client.follow(onChange, retryMs, socket ?? socketPath),
    list: (socket) => client.list(socket ?? socketPath()),
    read: (paneId, socket) => client.read(paneId, socket ?? socketPath()),
    prompt: (target, text, socket) => client.prompt(target, text, socket ?? socketPath()),
    wake: (expected, text, socket) => client.wake(expected, text, socket ?? socketPath()),
    focus: (paneId, socket) => client.focus(paneId, socket ?? socketPath()),
    notify: (title, body, socket) => client.notify(title, body, socket ?? socketPath()),
    start: (input, socket) => client.start(input, socket ?? socketPath()),
  };
}

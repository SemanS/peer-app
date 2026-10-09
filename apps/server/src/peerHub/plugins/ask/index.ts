/**
 * The ask plugin: `peer ask <task> "<question>"`, a conversation with the agents at work on a task
 * an agent's own depends on, through the overlap the Hub opens between them. While it runs, it drops
 * a question once its conversation settles. It needs no Hub feature of its own; a Hub without task
 * claims opens no conversation, and the command says so.
 *
 * @module peerHub/plugins/ask
 */
import * as Effect from "effect/Effect";

import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import { clip } from "../../peerText.ts";
import * as Ask from "./Ask.ts";

export const AskPlugin = bindPlugin({
  id: "ask",
  title: "Ask",
  summary: "Let an agent ask the agents at work on a task its own depends on.",
  defaultEnabled: true,
  layer: Ask.layer,
  make: Effect.gen(function* () {
    const ask = yield* Ask.Ask;
    return {
      commands: [
        {
          name: "ask",
          usage: 'ask <task> "<question>"',
          summary: "the agents at work on a task yours depends on (they answer as a note)",
          run: ({ session, plain }) => {
            const [handle, ...rest] = plain;
            const question = clip(rest.join(" "), 600);
            return handle === undefined || question === ""
              ? Effect.succeed(
                  `peer: say which task and what to ask, e.g. peer ask VL1 "Where do you keep the speaker names?"`,
                )
              : ask.ask(session, handle, question);
          },
        },
      ],
      run: ask.follow,
    } satisfies PeerContributions;
  }),
});

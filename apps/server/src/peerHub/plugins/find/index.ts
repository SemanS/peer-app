/**
 * The find plugin: `peer find "<what you will do>"`, a model's word on which of the project's other
 * works and `.ai` entries bear on what an agent is about to do, when the agent cannot tell from its
 * index. It reads the `.ai` entries the index has. It needs no Hub feature.
 *
 * @module peerHub/plugins/find
 */
import * as Effect from "effect/Effect";

import { bindPlugin, usage, type PeerContributions } from "../../core/plugin.ts";
import * as Find from "./Find.ts";

export const FindPlugin = bindPlugin({
  id: "find",
  title: "Find",
  summary:
    "Let an agent ask a model which of the project's work and knowledge bear on its next step.",
  defaultEnabled: true,
  layer: Find.layer,
  make: Effect.gen(function* () {
    const find = yield* Find.Find;
    return {
      commands: [
        {
          name: "find",
          usage: 'find "<what you will do>"',
          summary: "a model looks for what bears on it, when you cannot tell",
          // A model looks.
          waitSeconds: 150,
          run: ({ session, text }) =>
            text === ""
              ? Effect.fail(
                  usage(
                    "say what you are about to do",
                    'run peer find "show each speaker\'s talk time as a bar".',
                  ),
                )
              : find.find(session, text),
        },
      ],
    } satisfies PeerContributions;
  }),
});

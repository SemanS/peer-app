/**
 * `peer memory` and `peer remember`: an agent's own reads and writes of its project's memory, as
 * the session its hooks reported. A write the Hub cannot take yet is kept on this computer and
 * answered `pending_local`; a failure answers the status the `peer` shim turns into its outcome:
 * 400 for a malformed call, 409 when nothing was done, 500 when the disk failed.
 *
 * @module peerHub/plugins/memory/commands
 */
import * as Effect from "effect/Effect";

import type * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import { PeerCommandError, type PeerCommand, type PeerCommandInput } from "../../core/plugin.ts";
import type * as MemoryCli from "./MemoryCli.ts";
import { memorySessionOf } from "./MemoryRuntime.ts";
import type { MemoryError } from "./MemoryTransport.ts";

/** How long a command waits for the Hub to learn the session's runtime generation. */
const SYNC_BUDGET_MS = 5000;

/** A memory failure as the `peer` shim reports it, in one line. */
export const commandFailure = (error: MemoryError) =>
  new PeerCommandError({
    status: error.code === "invalid" ? 400 : error.code === "local" ? 500 : 409,
    message:
      error.code === "unavailable"
        ? `peer: ${error.detail} Nothing changed; try again once the Hub answers.`
        : `peer: ${error.detail}`,
  });

export const memoryCommands = (services: {
  readonly cli: MemoryCli.MemoryCli["Service"];
  /** `PeerAgents.sync`: reports a workspace's sessions, waiting at most a budget. */
  readonly sync: PeerAgents.PeerAgents["Service"]["sync"];
  readonly environmentId: string;
}): ReadonlyArray<PeerCommand> => {
  const run =
    (command: "memory" | "remember") =>
    ({ session, args }: PeerCommandInput) =>
      // The Hub learns the session's runtime generation before a write names it.
      services
        .sync(session.workspace, SYNC_BUDGET_MS)
        .pipe(
          Effect.andThen(
            services.cli.run(memorySessionOf(session, services.environmentId), command, args),
          ),
          Effect.mapError(commandFailure),
        );
  return [
    {
      name: "memory",
      usage: "memory <search|read|project|notice|...>",
      summary: "your project's durable shared memory; peer memory help lists what it does",
      run: run("memory"),
    },
    {
      name: "remember",
      usage: 'remember --claim "<finding>" [--evidence <path:line>]',
      summary: "a durable finding for your project's memory",
      run: run("remember"),
    },
  ];
};

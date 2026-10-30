/**
 * What `peer room say`'s words mean: an anchor and the people it names.
 *
 * @module peerHub/plugins/rooms/client/parse
 */
import type { PeerRoomAnchor } from "@t3tools/contracts";

import { usage } from "../../../core/plugin.ts";

export const FORM =
  'peer room | peer room <n> | peer room say "<text>" [--reply <n>] [--to <person>]... [--at <path>:<line>]';

/** `--at <path>:<line>`. */
export function anchorOf(at: string | undefined): PeerRoomAnchor | undefined {
  if (at === undefined) return undefined;
  const found = /^(.+):([1-9]\d*)(?:-([1-9]\d*))?$/.exec(at);
  if (found === null) throw usage("--at takes <path>:<line>", `run ${FORM}.`);
  return {
    path: found[1]!,
    line: Number(found[2]),
    side: "new",
    ...(found[3] === undefined ? {} : { endLine: Number(found[3]) }),
  };
}

/** A person named by address, or by the name their project knows them by. */
export function personOf(members: ReadonlyArray<{ email: string; name: string }>, named: string) {
  const wanted = named.trim().toLowerCase().replace(/^@/, "");
  const found = members.filter(
    (member) =>
      member.email.toLowerCase() === wanted ||
      member.email.split("@")[0]?.toLowerCase() === wanted ||
      member.name.toLowerCase() === wanted ||
      member.name.toLowerCase().split(/\s+/)[0] === wanted,
  );
  if (found.length !== 1)
    throw usage(
      found.length === 0
        ? `nobody on this project is called ${named.slice(0, 60)}`
        : `${named.slice(0, 60)} names several people on this project`,
      "name them by their address.",
    );
  return found[0]!.email;
}

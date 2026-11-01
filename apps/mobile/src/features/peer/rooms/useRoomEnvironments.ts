import { useAtomValue } from "@effect/atom-react";
import type { PeerHubStatus } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Option from "effect/Option";

import { serverEnvironment } from "../../../state/server";
import { workspaceConnections } from "../../../state/workspace";
import type { RoomEnvironment } from "./rooms.logic";

const last = new Map<string, PeerHubStatus>();

/** One light status subscription per known computer, keeping its last snapshot while it is away. */
const environmentsAtom = Atom.make((get): ReadonlyArray<RoomEnvironment> => {
  const known = get(workspaceConnections.environmentsAtom);
  const ids = new Set(known.map((environment) => String(environment.environmentId)));
  for (const id of last.keys()) if (!ids.has(id)) last.delete(id);
  return known.map((environment) => {
    const result = get(
      serverEnvironment.peerHubLive({
        environmentId: environment.environmentId,
        input: { scope: "needs-you" },
      }),
    );
    const value = Option.getOrNull(AsyncResult.value(result));
    if (value) last.set(environment.environmentId, value);
    return {
      environmentId: environment.environmentId,
      label: environment.environmentLabel,
      connected: environment.connectionState === "connected",
      status: value ?? last.get(environment.environmentId) ?? null,
    };
  });
});

/** Each known computer with the status it last gave: what the room list and Home read. */
export const useRoomEnvironments = () => useAtomValue(environmentsAtom);

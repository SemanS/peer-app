import { useAtomValue } from "@effect/atom-react";
import type { RoomAction, RoomPlace } from "@t3tools/client-runtime/peer/rooms";
import type { EnvironmentId, PeerRoomMessage } from "@t3tools/contracts";
import { useCallback } from "react";

import * as Dialog from "../../../components/ui/Dialog";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { declineInput, roomCommandEnd, type RoomCommandEnd } from "./rooms.logic";

const commands = { reportFailure: false };

/**
 * Pass on, Decline, Withdraw and Try again, wherever they are offered. `expect` is the state the
 * person saw, so a delivery that moved meanwhile is refused rather than moved again. Try again is a
 * `pass`, and the Hub allows it for a failed or lost start.
 */
export function useRoomMoves(environmentId: EnvironmentId) {
  const pass = useAtomCommand(serverEnvironment.peerRooms.pass, commands);
  const decline = useAtomCommand(serverEnvironment.peerRooms.decline, commands);
  const withdraw = useAtomCommand(serverEnvironment.peerRooms.withdraw, commands);
  const allowed = useAtomValue(serverEnvironment.peerRooms.pass.permissionAtom(environmentId));

  const move = useCallback(
    async (
      place: RoomPlace,
      seq: number,
      action: Exclude<RoomAction, "decline">,
      expect: string,
    ): Promise<RoomCommandEnd<PeerRoomMessage>> =>
      roomCommandEnd(
        action === "withdraw"
          ? await withdraw({ environmentId, input: { ...place, seq } })
          : await pass({ environmentId, input: { ...place, seq, expect } }),
      ),
    [environmentId, pass, withdraw],
  );

  /** Asks for an optional reason, then declines; the reason is visible in the room. */
  const askDecline = useCallback(
    (
      place: RoomPlace,
      seq: number,
      expect: string,
      onStart: () => void,
      onEnd: (end: RoomCommandEnd<PeerRoomMessage>) => void,
    ) =>
      Dialog.prompt({
        title: "Reason for declining (optional)",
        initialValue: "",
        confirmText: "Decline",
        onConfirm: (reason) => {
          onStart();
          void decline({ environmentId, input: declineInput(place, seq, reason, expect) }).then(
            (result) => onEnd(roomCommandEnd(result)),
          );
        },
      }),
    [decline, environmentId],
  );

  return { allowed, move, askDecline };
}

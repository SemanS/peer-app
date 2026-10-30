import { useAtomValue } from "@effect/atom-react";
import type { RoomPlace } from "@t3tools/client-runtime/peer/rooms";
import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";

import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Switch } from "../../ui/switch";
import type { ReachRow } from "./room.logic";
import { moveNote } from "./useRoom";

/**
 * The owner's switch per open run: whether the team may ask this agent directly. It is off by
 * default, and only a run on the project's shared capacity offers it.
 */
export function RoomReach({
  environmentId,
  place,
  rows,
  onChanged,
}: {
  readonly environmentId: EnvironmentId;
  readonly place: RoomPlace;
  readonly rows: ReadonlyArray<ReachRow>;
  readonly onChanged: () => void;
}) {
  const setReach = useAtomCommand(serverEnvironment.peerRooms.setReach, { reportFailure: false });
  const allowed = useAtomValue(serverEnvironment.peerRooms.setReach.permissionAtom(environmentId));
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (rows.length === 0 || !allowed) return null;
  const change = async (row: ReachRow, team: boolean) => {
    setBusy(row.run);
    setNote(null);
    const result = await setReach({
      environmentId,
      input: {
        workspace: place.workspace,
        project: place.project,
        run: row.run,
        reach: team ? "team" : "own",
      },
    });
    setBusy(null);
    setNote(moveNote(result));
    onChanged();
  };
  return (
    <div className="flex shrink-0 flex-col gap-1 border-b border-border/60 px-4 py-2 sm:px-6">
      {rows.map((row) => (
        <div key={row.run} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <label className="flex min-w-0 items-center gap-2 text-xs text-foreground">
            <Switch
              size="sm"
              checked={row.team}
              disabled={busy === row.run || row.capacity !== "shared"}
              onCheckedChange={(checked) => void change(row, checked)}
            />
            <span className="min-w-0">
              Team can ask your agent <span className="font-mono">{row.agent}</span>
            </span>
          </label>
          {row.unavailable === undefined ? null : (
            <span className="text-xs text-muted-foreground">{row.unavailable}</span>
          )}
        </div>
      ))}
      {note === null ? null : (
        <p role="status" className="text-xs text-warning-foreground">
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * The plugin's status slice, read on every publish: what waits on the person, clipped, and each
 * room's newest sequence.
 *
 * @module peerHub/plugins/rooms/client/status
 */
import {
  PEER_ROOMS_STATUS_LIMITS as LIMITS,
  type PeerRoomInbox,
  type PeerRoomInboxItem,
  type PeerRoomNeed,
  type PeerRoomsStatus,
} from "@t3tools/contracts";

import { clip } from "../../../peerText.ts";

const needOf = (workspace: string, item: PeerRoomInboxItem): PeerRoomNeed => ({
  workspace,
  project: item.project,
  task: item.task,
  seq: item.message.seq,
  author: item.message.author.email,
  ...(item.message.author.run === undefined ? {} : { agent: true }),
  text: clip(item.message.text, LIMITS.text),
  at: item.message.at,
});

export function statusOf(read: ReadonlyMap<string, PeerRoomInbox>): PeerRoomsStatus {
  const all = [...read];
  const needs = (list: (inbox: PeerRoomInbox) => ReadonlyArray<PeerRoomInboxItem>) =>
    all
      .flatMap(([workspace, inbox]) => list(inbox).map((item) => needOf(workspace, item)))
      .slice(0, LIMITS.items);
  return {
    waiting: needs((inbox) => inbox.waiting),
    mentions: needs((inbox) => inbox.mentions),
    seqs: Object.fromEntries(all.map(([workspace, inbox]) => [workspace, inbox.seqs])),
  };
}

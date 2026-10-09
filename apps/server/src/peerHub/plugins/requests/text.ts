import { peerRequestOutcome, type PeerAgentRequest } from "@t3tools/contracts";
import { plain } from "../../peerText.ts";
export const REQUEST_USAGE =
  'request <email> "<prompt>" [--title "<title>"] [--op <stable-id>] | request list | request withdraw <id>';
export const refusedNext = "Tell your person; repeating this command will not help.";
export const uncertainNext = (op: string) =>
  `Repeat the same command with --op ${op}; the same operation never sends twice.`;
export function sentText(row: PeerAgentRequest, op: string) {
  const id = plain(row.id, 180),
    recipient = plain(row.recipient, 180);
  if (row.replayed === true || row.status !== "pending")
    return `Operation ${op} was already used: request ${id} to ${recipient} is ${peerRequestOutcome(row)}.\nNothing new was sent. A new --op sends another request.`;
  return `Request sent to ${recipient}: "${plain(row.title, 120)}".\nId ${id}. Operation ${op}.\nIt waits in their Needs you until they accept or dismiss it${row.expiresAt === undefined ? "" : `, and expires on ${plain(row.expiresAt, 40)}`}.\nWithdraw it with: peer request withdraw ${id}.`;
}
export function listText(project: string, rows: ReadonlyArray<PeerAgentRequest>) {
  return `Your requests on ${plain(project, 180)}, pending first:\n${rows.length === 0 ? "None." : rows.map((row) => `${plain(row.id, 180)}  ${plain(row.recipient, 180)}  ${peerRequestOutcome(row)}${row.status === "pending" && row.expiresAt !== undefined ? `, expires ${plain(row.expiresAt, 40)}` : row.status !== "pending" ? ` ${plain(row.updatedAt, 40)}` : ""}  "${plain(row.title, 120)}"`).join("\n")}`;
}
export const withdrawnText = (row: PeerAgentRequest) =>
  `Withdrew ${plain(row.id, 180)} to ${plain(row.recipient, 180)}. It left their Needs you; its task stays on the board.`;

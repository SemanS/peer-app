import type { PeerMobilePlugin } from "../slotTypes";

/**
 * A task's room on the phone: the list of rooms from Home and a Room screen. The composer writes to
 * the team or the person's own agent. There is no diff here, so an anchored message shows
 * `path:line` as text.
 */
export const roomsMobilePlugin: PeerMobilePlugin = { id: "rooms" };

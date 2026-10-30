/**
 * Peer's own version (`0.1.<commits on top of upstream>`), stamped into the bundle at build time
 * through `PEER_VERSION`; a dev checkout has none.
 *
 * @module cli/peerVersion
 */
declare const __PEER_VERSION__: string | undefined;

export const peerVersion = (): string | undefined =>
  typeof __PEER_VERSION__ === "undefined" || __PEER_VERSION__ === "" ? undefined : __PEER_VERSION__;

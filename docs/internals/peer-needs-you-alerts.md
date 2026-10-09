# Peer Phone alerts

Connect identifies an activity update by its state and timestamp. Keep `updatedAt` stable throughout one decision episode, including restart and relink. The local [publisher and ledger](../../apps/server/src/peerHub/plugins/needs-you/publisher.ts) retain the phase and its original timestamp; replacing it with the current time would notify the same device again.

The existing Connect transport accepts a thread-shaped link, so synthetic Peer alerts use `/threads/<environment>/<id>`. The mobile resolver must rewrite those exact synthetic ids before normal thread navigation. Real thread ids and thread sub-routes still use the ordinary resolver. See the [identity contract](../../packages/contracts/src/peer/needs-you.ts) and [mobile resolver](../../apps/mobile/src/features/peer/needs-you/needsYouLinking.ts).

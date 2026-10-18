import { createPeerChangesAtoms } from "@t3tools/client-runtime/peer/changes";

import { connectionAtomRuntime } from "../../../connection/runtime";

/**
 * The changes plugin's atoms on this app's connection runtime. They are not part of
 * `serverEnvironment` yet, and nothing here needs them to be: a project's view is read by its own
 * subscription, so a second copy beside the shared one costs nothing.
 */
export const peerChanges = createPeerChangesAtoms(connectionAtomRuntime);

import { createPeerDependencyAtoms } from "./dependencies.ts";
import type { Atom } from "effect/unstable/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import { createAnnouncementsEnvironmentAtoms } from "./announcements.ts";
import { createPeerAuditAtoms } from "./audit.ts";
import { createPeerToolTrustAtoms } from "../peerToolTrust.ts";
import { createPeerCapacityAtoms } from "./capacity.ts";
import { createPeerGitHubAtoms } from "./github.ts";
import { createPeerHerdrAtoms } from "./herdr.ts";
import { createPeerKnowledgeAtoms } from "./knowledge.ts";
import { createPeerMemoryAtoms } from "./memory.ts";
import { createPeerObserveAtoms } from "./observe.ts";
import { createPeerRequestsAtoms } from "./requests.ts";

/**
 * The atoms of Peer's plugins, spread into the server atoms under the names they always had. A
 * plugin's atoms live in `peer/<id>.ts`, so adding one takes a line here and none in `state/server.ts`.
 */
export function createPeerPluginAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    peerAnnouncements: createAnnouncementsEnvironmentAtoms(runtime),
    ...createPeerHerdrAtoms(runtime),
    ...createPeerDependencyAtoms(runtime),
    ...createPeerGitHubAtoms(runtime),
    ...createPeerCapacityAtoms(runtime),
    ...createPeerRequestsAtoms(runtime),
    ...createPeerObserveAtoms(runtime),
    ...createPeerKnowledgeAtoms(runtime),
    ...createPeerMemoryAtoms(runtime),
    ...createPeerAuditAtoms(runtime),
    ...createPeerToolTrustAtoms(runtime),
  };
}

import { createPeerChangesAtoms } from "./changes.ts";
import { createPeerJujutsuAtoms } from "./jujutsu.ts";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import { createResourcesEnvironmentAtoms } from "./resources.ts";
import { createPeerAuditAtoms } from "./audit.ts";
import { createPeerToolTrustAtoms } from "../peerToolTrust.ts";
import { createPeerCapacityAtoms } from "./capacity.ts";
import { createPeerGitHubAtoms } from "./github.ts";
import { createPeerHerdrAtoms } from "./herdr.ts";
import { createPeerObserveAtoms } from "./observe.ts";
import { createPeerCardAtoms } from "./card.ts";
import { createPeerRoomsAtoms } from "./rooms.ts";
import { createPeerRunsAtoms } from "./runs.ts";
import { createPeerSettingsAtoms } from "./settings.ts";

/**
 * The atoms of Peer's plugins, spread into the server atoms under the names they always had. A
 * plugin's atoms live in `peer/<id>.ts`, so adding one takes a line here and none in `state/server.ts`.
 */
export function createPeerPluginAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    peerResources: createResourcesEnvironmentAtoms(runtime),
    ...createPeerHerdrAtoms(runtime),
    ...createPeerJujutsuAtoms(runtime),
    ...createPeerChangesAtoms(runtime),
    ...createPeerGitHubAtoms(runtime),
    ...createPeerCapacityAtoms(runtime),
    ...createPeerObserveAtoms(runtime),
    ...createPeerAuditAtoms(runtime),
    ...createPeerToolTrustAtoms(runtime),
    peerRooms: createPeerRoomsAtoms(runtime),
    peerCard: createPeerCardAtoms(runtime),
    ...createPeerRunsAtoms(runtime),
    peerSettings: createPeerSettingsAtoms(runtime),
  };
}

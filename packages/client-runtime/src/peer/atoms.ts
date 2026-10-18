import { createDigestEnvironmentAtoms } from "./digest.ts";
import { createRecipesEnvironmentAtoms } from "./recipes.ts";
import { createPeerMetricsAtoms } from "./metrics.ts";
import { createPeerImpactAtoms } from "./impact.ts";
import { createPeerPlansAtoms } from "./plans.ts";
import { createPeerAgreementsAtoms } from "./agreements.ts";
import { createPeerHandoffAtoms } from "./handoff.ts";
import { createPeerForecastAtoms } from "../peerForecast.ts";
import { createPeerDependencyAtoms } from "./dependencies.ts";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import { createResourcesEnvironmentAtoms } from "./resources.ts";
import { createAnnouncementsEnvironmentAtoms } from "./announcements.ts";
import { createPeerAuditAtoms } from "./audit.ts";
import { createPeerToolTrustAtoms } from "../peerToolTrust.ts";
import { createPeerCapacityAtoms } from "./capacity.ts";
import { createPeerGitHubAtoms } from "./github.ts";
import { createPeerHerdrAtoms } from "./herdr.ts";
import { createPeerJujutsuAtoms } from "./jujutsu.ts";
import { createPeerKnowledgeAtoms } from "./knowledge.ts";
import { createPeerMemoryAtoms } from "./memory.ts";
import { createPeerObserveAtoms } from "./observe.ts";
import { createOwnershipEnvironmentAtoms } from "./ownership.ts";
import { createPeerRequestsAtoms } from "./requests.ts";
import { createPeerSettingsAtoms } from "./settings.ts";

/**
 * The atoms of Peer's plugins, spread into the server atoms under the names they always had. A
 * plugin's atoms live in `peer/<id>.ts`, so adding one takes a line here and none in `state/server.ts`.
 */
export function createPeerPluginAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    peerDigest: createDigestEnvironmentAtoms(runtime),
    peerRecipes: createRecipesEnvironmentAtoms(runtime),
    ...createPeerMetricsAtoms(runtime),
    peerResources: createResourcesEnvironmentAtoms(runtime),
    ...createPeerForecastAtoms(runtime),
    peerAnnouncements: createAnnouncementsEnvironmentAtoms(runtime),
    ...createPeerHerdrAtoms(runtime),
    ...createPeerJujutsuAtoms(runtime),
    ...createPeerDependencyAtoms(runtime),
    ...createPeerHandoffAtoms(runtime),
    ...createPeerImpactAtoms(runtime),
    ...createPeerPlansAtoms(runtime),
    ...createPeerAgreementsAtoms(runtime),
    ...createPeerGitHubAtoms(runtime),
    ...createPeerCapacityAtoms(runtime),
    ...createPeerRequestsAtoms(runtime),
    ...createPeerObserveAtoms(runtime),
    ...createPeerKnowledgeAtoms(runtime),
    ...createPeerMemoryAtoms(runtime),
    ...createPeerAuditAtoms(runtime),
    ...createPeerToolTrustAtoms(runtime),
    peerOwnership: createOwnershipEnvironmentAtoms(runtime),
    peerSettings: createPeerSettingsAtoms(runtime),
  };
}

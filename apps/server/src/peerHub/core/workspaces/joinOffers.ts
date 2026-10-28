import type { PeerDomainOffer, PeerJoinableWorkspace } from "@t3tools/contracts";
import type { HubMe } from "../hub/hubApi.ts";
import { safeId } from "../state/PeerState.ts";

/** Older Hubs list every domain match as joinable. Ambiguous matches require a person to decide. */
export function splitJoinable(me: HubMe, left: ReadonlySet<string>) {
  const domains = me.joinable.filter((w) => w.joinReason === "domain");
  const ambiguous = domains.length > 1;
  const joinable: PeerJoinableWorkspace[] = me.joinable
    .filter((w) => safeId(w.slug) && (!ambiguous || w.joinReason !== "domain"))
    .map((w) => ({
      slug: w.slug,
      name: w.name,
      allowedDomains: w.allowedDomains,
      reason: w.joinReason,
      ...(w.projects === undefined ? {} : { projects: w.projects }),
      ...(w.task === undefined ? {} : { task: w.task }),
    }));
  const offers: PeerDomainOffer[] = (me.domainOffers ?? []).filter((w) => safeId(w.slug));
  if (ambiguous) {
    const domain = me.email.split("@")[1] ?? "";
    for (const w of domains)
      if (safeId(w.slug) && !offers.some((o) => o.slug === w.slug))
        offers.push({ slug: w.slug, name: w.name, domain });
  }
  return {
    joinable,
    offers,
    autoJoin: joinable.filter((w) => w.reason === "domain" && !left.has(w.slug)),
  };
}

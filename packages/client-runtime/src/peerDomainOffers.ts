import type { PeerDomainOffer, PeerDomainState } from "@t3tools/contracts";

/** All clients explain the same membership decision before asking the Hub to join. */
export function describeOffer(offer: PeerDomainOffer) {
  const summary = offer.holder
    ? `${offer.name} lists @${offer.domain}, but ${offer.holder.name} holds it${offer.holder.verified ? " and proved it through DNS" : ""}.`
    : `${offer.name} lists @${offer.domain}, but no workspace holds that domain yet.`;
  const provenance = [
    offer.createdBy ? `Created by ${offer.createdBy}` : "",
    offer.createdAt ? `on ${offer.createdAt}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    title: `Join ${offer.name}?`,
    summary,
    message: `${summary}${provenance ? ` ${provenance}.` : ""} Its admins decide which projects, tools and shared capacity you get. Its members see the work you report on its projects. Join ${offer.name}?`,
  };
}
export function domainStateLabel(state: PeerDomainState, domain: string) {
  return `@${domain}: ${state === "verified" ? "verified through DNS" : state === "claimed" ? "claimed" : "listed only"}`;
}

import * as Schema from "effect/Schema";

/** Read-only account facts. Only the Hub operator grants capacity; clients do not decide entitlements. */
export const PeerHubEdition = Schema.Struct({
  id: Schema.String,
  memberLimit: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  members: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  /** Null means no interaction quota. */
  interactionLimit: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type PeerHubEdition = typeof PeerHubEdition.Type;

export function editionLabel(edition: PeerHubEdition | undefined): string {
  if (edition === undefined) return "Edition unknown · this Hub has not provided capacity details";
  const name = edition.id === "free" ? "Free" : edition.id === "team" ? "Team" : edition.id;
  return `${name} · ${edition.members}/${edition.memberLimit} people · ${edition.interactionLimit === null ? "unlimited interactions" : `${edition.interactionLimit} interactions`}`;
}

import type { PeerPlanRelation, PeerPlanSide, PeerPlansView } from "@t3tools/contracts";
import { toldDigest } from "../../../core/plugin.ts";

/** Whose side of a relation an agent is: its session as the Hub knows it, and its computer. */
export interface Reader {
  readonly session: string;
  readonly email: string;
  readonly environment: string;
}

/** A relation as one side hears it: the Hub's `use` is `uses-their-change` to the user, `changes-their-use` to the changer. */
export type Kind = "uses-their-change" | "changes-their-use" | "same-change";

/** Whether a side is the reader's own session. */
export const ours = (side: PeerPlanSide, reader: Reader) =>
  side.session === reader.session &&
  side.email === reader.email &&
  side.environment === reader.environment;

/** How a relation reads from `reader`'s side and who is on the other; null when the reader is on neither. */
export function orient(
  relation: PeerPlanRelation,
  reader: Reader,
): { readonly kind: Kind; readonly other: PeerPlanSide } | null {
  const user = ours(relation.a, reader);
  if (!user && !ours(relation.b, reader)) return null;
  const kind =
    relation.kind === "same-change"
      ? "same-change"
      : user
        ? "uses-their-change"
        : "changes-their-use";
  return { kind, other: user ? relation.b : relation.a };
}

/** The relations of a view that name `reader`'s session in `project`. */
export const naming = (view: PeerPlansView | undefined, reader: Reader, project: string) =>
  (view?.relations ?? []).filter(
    (relation) => relation.project === project && orient(relation, reader) !== null,
  );

/**
 * What a session is told of a relation once: the relation, its contract line and how certain it is
 * and whether it was observed. A relation that changes in one of those is told again.
 */
export const toldKey = (relation: PeerPlanRelation) =>
  toldDigest(
    [relation.id, relation.contract ?? "", relation.certain, relation.observed].join("\u0000"),
  );

/** The relations a session was not told of, or told of in other words: `told` is the set of its keys. */
export const untold = (told: ReadonlySet<string>, relations: ReadonlyArray<PeerPlanRelation>) =>
  relations.filter((relation) => !told.has(toldKey(relation)));

export const mark = (told: Set<string>, relations: ReadonlyArray<PeerPlanRelation>) => {
  for (const relation of relations) told.add(toldKey(relation));
};

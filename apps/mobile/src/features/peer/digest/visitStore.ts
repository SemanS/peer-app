import {
  createActivityVisits,
  decodeVisit,
  createVisitStore,
  HEARTBEAT_MS,
  type VisitRecord,
} from "@t3tools/client-runtime/peer-digest";
export const readMobileVisit = decodeVisit;
export function makeMobileVisits(storage: {
  read: (email: string) => string | null;
  write: (email: string, value: string) => void;
}) {
  return createActivityVisits(createVisitStore(storage), HEARTBEAT_MS);
}
export type { VisitRecord };

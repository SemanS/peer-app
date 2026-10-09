import type { PeerMobilePlugin } from "../slotTypes";
import { AuditLogSection } from "./AuditLogSection";
export const auditMobilePlugin: PeerMobilePlugin = {
  id: "audit",
  workspaceSections: [{ place: "end", Component: AuditLogSection }],
};

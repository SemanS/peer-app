import type { PeerWebPlugin } from "../slots.types";
import { AuditLog } from "./AuditLog";
export const auditWebPlugin: PeerWebPlugin = { id: "audit", workspaceSettings: AuditLog };

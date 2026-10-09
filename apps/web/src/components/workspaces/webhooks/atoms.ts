import { createWebhooksEnvironmentAtoms } from "@t3tools/client-runtime/peer/webhooks";
import { connectionAtomRuntime } from "../../../connection/runtime";
export const webhookAtoms = createWebhooksEnvironmentAtoms(connectionAtomRuntime);

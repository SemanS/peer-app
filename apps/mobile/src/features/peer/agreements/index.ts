import type { PeerMobilePlugin } from "../slotTypes";
import { agreementSignals } from "./agreements.logic";
import { PeerTaskAgreements } from "./PeerTaskAgreements";

/**
 * Agreements on the phone: what the agents of two tasks agreed when they settled an overlap. An
 * agreement that fell due on a task where no agent is live shows as a signal on the project, since
 * Needs you is built in core and a plugin does not edit it; the phone sends no notification for
 * it. The task's list, with Close and Reopen, is a section of the selected task.
 */
export const agreementsMobilePlugin: PeerMobilePlugin = {
  id: "agreements",
  projectSignals: agreementSignals,
  taskSections: PeerTaskAgreements,
};

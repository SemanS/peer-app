import type { PeerWebPlugin } from "../slots.types";
import { agreementFact, agreementSignals, dueForMeCount } from "./agreements.logic";
import { AgreementsNeedsYou } from "./AgreementsNeedsYou";
import { AgreementsSection } from "./AgreementsSection";

/**
 * Agreements: what the agents of two tasks agreed when they settled an overlap, kept for the tasks.
 * An agreement that fell due on a task no agent works on waits in the person's Needs you; a task's
 * context page lists its agreements, with Close and Reopen; the Team page gets one fact on a task's
 * row and a signal for each agreement due with nobody to hear it. Agreements never stop an edit,
 * a merge or a person.
 */
export const agreementsWebPlugin: PeerWebPlugin = {
  id: "agreements",
  needsYou: { count: dueForMeCount, Component: AgreementsNeedsYou },
  taskContext: AgreementsSection,
  teamTaskFacts: agreementFact,
  teamSignals: agreementSignals,
};

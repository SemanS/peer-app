import { SETTLE_RESUME_DEFAULT, type PeerHubStatus } from "@t3tools/contracts";

export const RESUME_ROW = {
  title: "Resume an ended agent to settle its overlaps",
  description:
    "Resumes only your own agents on this computer, once; otherwise the overlap is yours to close.",
} as const;

/** The switch's state: what the plugin reports, else its default while it has not reported yet. */
export function resumeEnabled(status: Pick<PeerHubStatus, "settle">): boolean {
  return status.settle?.resume ?? SETTLE_RESUME_DEFAULT;
}

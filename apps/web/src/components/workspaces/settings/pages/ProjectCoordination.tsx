import { ComingInThisChange } from "../PeerSettingsPage";

/** A project's Coordination tab: the policy its agents follow, and its path rules. */
export function ProjectCoordination() {
  return (
    <>
      <h2 className="sr-only">Coordination</h2>
      <ComingInThisChange>
        the project’s coordination policy and path rules, and which rule decides for a path
      </ComingInThisChange>
    </>
  );
}

import { ComingInThisChange } from "../PeerSettingsPage";

/** A project's History tab: each change to its settings, who made it and why. */
export function ProjectHistory() {
  return (
    <>
      <h2 className="sr-only">History</h2>
      <ComingInThisChange>
        every change to the project’s settings, who made it and why, with a way to revert it
      </ComingInThisChange>
    </>
  );
}

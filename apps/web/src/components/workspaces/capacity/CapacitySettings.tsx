import { SettingsRow } from "../../settings/settingsLayout";

/** Settings → Workspaces: how shared capacity differs from the person's own subscriptions. */
export function CapacitySettings() {
  return (
    <SettingsRow
      title="How capacity works"
      description="Your own subscriptions stay on this machine and only run your own work. A workspace’s shared capacity is its API pool, billed to one project with your allocation."
    />
  );
}

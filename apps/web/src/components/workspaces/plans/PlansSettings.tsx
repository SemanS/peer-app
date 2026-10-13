import { SettingsRow, useRelativeTimeTick } from "../../settings/settingsLayout";
import type { PeerSlotProps } from "../slots.types";
import { PLANS_SUMMARY, plansSettingsState } from "./plans.logic";

/**
 * What Plans is doing on this computer, under Coordination & plugins: what it is for, what it
 * holds and what the Hub says while it is on, what being inactive means while it is not. The
 * switch and the reason it is off (turned off, forced off by the operator, an older Hub) are the
 * plugin list's, so this row has neither.
 */
export function PlansSettings({ status }: PeerSlotProps) {
  const now = useRelativeTimeTick(60_000);
  const plugin = status.plugins?.find((candidate) => candidate.id === "plans");
  if (plugin === undefined) return null;
  return (
    <SettingsRow
      title="Plans"
      description={PLANS_SUMMARY}
      status={plansSettingsState(plugin, status.plans, now)}
    />
  );
}

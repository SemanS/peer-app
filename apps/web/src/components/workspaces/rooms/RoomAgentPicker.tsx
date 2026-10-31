import type { EnvironmentId } from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import { memo } from "react";

import { useEnvironmentSettings } from "../../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../../providerInstances";
import { useEnvironmentProviders } from "../../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../../state/server";
import { ProviderModelPicker } from "../../chat/ProviderModelPicker";
import { getTriggerDisplayModelLabel } from "../../chat/providerIconUtils";
import { Button } from "../../ui/button";
import { harnessOfDriver, roomAgentEntries, type RoomAgentChoice } from "./room.logic";

/** The To row's +: which of the person's agents and models Your agent starts on. */
export const RoomAgentPicker = memo(function RoomAgentPicker({
  environmentId,
  personalHarnesses,
  choice,
  disabled,
  onChoose,
  onClear,
}: {
  readonly environmentId: EnvironmentId;
  readonly personalHarnesses: ReadonlyArray<string>;
  readonly choice: RoomAgentChoice | undefined;
  readonly disabled: boolean;
  readonly onChoose: (agent: RoomAgentChoice) => void;
  readonly onClear: () => void;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const providers = useEnvironmentProviders().get(environmentId) ?? EMPTY_SERVER_PROVIDERS;
  const entries = roomAgentEntries(
    sortProviderInstanceEntries(
      applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings, null),
    ),
    personalHarnesses,
  );
  const active =
    entries.find((entry) => harnessOfDriver(entry.driverKind) === choice?.harness) ?? entries[0];
  if (active === undefined) return null;
  const model = choice?.model ?? active.models[0]?.slug ?? "";
  const options = getCustomModelOptionsByInstance(settings, providers, active.instanceId, model);
  return (
    <>
      <ProviderModelPicker
        environmentId={environmentId}
        activeInstanceId={active.instanceId}
        model={model}
        lockedProvider={null}
        instanceEntries={entries}
        modelOptionsByInstance={options}
        size="xs"
        disabled={disabled}
        triggerAriaLabel="Choose your agent and model"
        {...(choice === undefined ? { triggerLabel: "+" } : {})}
        onInstanceModelChange={(instanceId, slug) => {
          const entry = entries.find((candidate) => candidate.instanceId === instanceId);
          const harness = entry === undefined ? null : harnessOfDriver(entry.driverKind);
          if (entry === undefined || harness === null) return;
          const picked = options.get(instanceId)?.find((option) => option.slug === slug);
          onChoose({
            harness,
            model: slug,
            label: picked === undefined ? slug : getTriggerDisplayModelLabel(picked),
          });
        }}
      />
      {choice === undefined ? null : (
        <Button
          type="button"
          size="icon-micro"
          variant="ghost-muted"
          aria-label="Use your default agent"
          disabled={disabled}
          onClick={onClear}
        >
          <XIcon aria-hidden />
        </Button>
      )}
    </>
  );
});

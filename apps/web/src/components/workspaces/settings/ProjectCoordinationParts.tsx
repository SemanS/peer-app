/**
 * The policy list of a project's Coordination page (design artboard 11). It draws what
 * `projectCoordination.logic` works out and hands every edit back to the page, which writes it to
 * the draft.
 */
import { useId } from "react";

import { cn } from "../../../lib/utils";
import { Radio, RadioGroup } from "../../ui/radio-group";
import { NotSaved } from "./CapacityCoordinationParts";
import { POLICY_CHOICES, isPolicyChoice, type PolicyChoice } from "./projectCoordination.logic";

/**
 * The project's policy as a list to pick from. A row that cannot be picked says why, and the whole
 * list is disabled for whoever does not set the policy. `value` is null for a policy this app does
 * not know, which no row shows as chosen.
 */
export function PolicyList({
  project,
  value,
  disabled,
  changed,
  onChange,
}: {
  readonly project: string;
  readonly value: PolicyChoice | null;
  readonly disabled: boolean;
  readonly changed: boolean;
  readonly onChange: (choice: PolicyChoice) => void;
}) {
  const idBase = useId();
  return (
    <RadioGroup
      aria-label={`Policy for ${project}`}
      value={value ?? ""}
      disabled={disabled}
      onValueChange={(next) => {
        if (isPolicyChoice(next)) onChange(next);
      }}
    >
      <div className="overflow-hidden rounded-xl border bg-card">
        {POLICY_CHOICES.map((choice) => (
          <label
            key={choice.value}
            className={cn(
              "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 border-b px-3.5 py-2.5 last:border-b-0 sm:grid-cols-[auto_9.5rem_minmax(0,1fr)]",
              disabled ? "cursor-not-allowed" : "cursor-pointer",
            )}
          >
            <Radio
              value={choice.value}
              aria-labelledby={`${idBase}-${choice.value}-title`}
              aria-describedby={`${idBase}-${choice.value}-description`}
            />
            <span
              id={`${idBase}-${choice.value}-title`}
              className="flex flex-wrap items-center gap-2 text-sm font-medium"
            >
              {choice.title}
              {changed && value === choice.value ? <NotSaved /> : null}
            </span>
            <span
              id={`${idBase}-${choice.value}-description`}
              className="col-start-2 text-xs text-muted-foreground sm:col-start-auto"
            >
              {choice.description}
            </span>
          </label>
        ))}
      </div>
    </RadioGroup>
  );
}

import { useMemo } from "react";

import { Radio, RadioGroup } from "../ui/radio-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  catchUpChoices,
  windowLabel,
  zoneLabel,
  zoneNames,
  zoneOffsetLabel,
  type NextRunPreview,
} from "./scheduleTime.logic";

/** The select value for "the computer's own zone"; no zone's own name looks like this. */
const COMPUTER = "__computer__";

/** Every zone the browser names, with its offset. Built when the list opens, not with the form. */
function ZoneItems({ saved, now }: { readonly saved: string; readonly now: number }) {
  const zones = useMemo(
    () => zoneNames(saved).map((zone) => ({ zone, label: zoneOffsetLabel(zone, now) })),
    [saved, now],
  );
  return zones.map(({ zone, label }) => (
    <SelectItem key={zone} hideIndicator value={zone}>
      {label}
    </SelectItem>
  ));
}

/**
 * The zone a fixed-time schedule runs in. The first choice is the computer's own, which the task
 * then follows if the computer changes zone; any other is the task's for good.
 */
export function TimeZoneSelect({
  id,
  value,
  saved,
  computerZone,
  now,
  disabled,
  onChange,
}: {
  readonly id: string;
  /** The chosen zone, or "" for the computer's own. */
  readonly value: string;
  /** The zone the task was saved with, kept in the list even if the browser does not name it. */
  readonly saved: string;
  readonly computerZone: string;
  readonly now: number;
  readonly disabled: boolean;
  readonly onChange: (zone: string) => void;
}) {
  const computer = `${zoneLabel(computerZone, now)} · this computer`;
  return (
    <Select
      value={value === "" ? COMPUTER : value}
      disabled={disabled}
      onValueChange={(next) => onChange(typeof next !== "string" || next === COMPUTER ? "" : next)}
    >
      <SelectTrigger id={id} size="sm" aria-label="Time zone">
        <SelectValue>{value === "" ? computer : zoneLabel(value, now)}</SelectValue>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        <SelectItem hideIndicator value={COMPUTER}>
          {computer}
        </SelectItem>
        <ZoneItems saved={saved} now={now} />
      </SelectPopup>
    </Select>
  );
}

/** When the schedule runs next, in the zone it runs in, so a time is never read in the wrong one. */
export function NextRunBox({ preview }: { readonly preview: NextRunPreview | null }) {
  return (
    <div className="space-y-0.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-sm">
      <p className="text-xs text-muted-foreground">Next run</p>
      {preview === null ? (
        <p className="text-muted-foreground">Pick a time to see when it runs.</p>
      ) : (
        <>
          <p className="font-medium">{preview.next}</p>
          <p className="text-muted-foreground">{preview.following}</p>
          <p className="text-xs text-muted-foreground">{preview.note}</p>
        </>
      )}
    </div>
  );
}

/**
 * What happens to a run the computer was asleep or off for: run once when it wakes if that is soon
 * enough after the scheduled time, or skip it. Said under the choice: it runs only on this
 * computer, never on a teammate's.
 */
export function MissedRunField({
  rule,
  catchUpMs,
  environmentLabel,
  disabled,
  onRuleChange,
  onCatchUpChange,
}: {
  readonly rule: "catch_up" | "skip";
  readonly catchUpMs: number;
  /** The computer the task runs on, as the person named it. */
  readonly environmentLabel: string;
  readonly disabled: boolean;
  readonly onRuleChange: (rule: "catch_up" | "skip") => void;
  readonly onCatchUpChange: (ms: number) => void;
}) {
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="mb-2 text-sm font-medium">
        If this computer is asleep or off at that time
      </legend>
      <RadioGroup
        aria-label="If this computer is asleep or off at that time"
        value={rule}
        onValueChange={(next) => {
          if (next === "catch_up" || next === "skip") onRuleChange(next);
        }}
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            <Radio value="catch_up" />
            Run when it wakes, if that is within
          </label>
          <div className="w-32">
            <Select
              value={String(catchUpMs)}
              disabled={disabled || rule !== "catch_up"}
              onValueChange={(next) => {
                const ms = Number(next);
                if (Number.isFinite(ms)) onCatchUpChange(ms);
              }}
            >
              <SelectTrigger size="sm" aria-label="Catch-up window">
                <SelectValue>{windowLabel(catchUpMs)}</SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {catchUpChoices(catchUpMs).map((ms) => (
                  <SelectItem key={ms} hideIndicator value={String(ms)}>
                    {windowLabel(ms)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Radio value="skip" />
          Skip that run
        </label>
      </RadioGroup>
      <p className="text-xs text-muted-foreground">
        {`Scheduled tasks run only on ${environmentLabel}, never on a teammate's computer.`}
      </p>
    </fieldset>
  );
}

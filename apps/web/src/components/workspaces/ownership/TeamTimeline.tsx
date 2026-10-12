import { useState } from "react";

import { InlineButton } from "../../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { PeerCard, PeerSectionLabel } from "../PeerPageHeader";
import {
  NO_FILTER,
  TIMELINE_DAYS,
  TIMELINE_PAGE,
  filterTimeline,
  type TimelineChoices,
  type TimelineFilter,
  type TimelineRow,
} from "./teamTimeline.logic";
import { PersonAvatar } from "./TeamParts";

/** The value of each filter's first choice, which leaves the filter out. */
const ANYONE = "all";

/** What the history is doing: on its way, read, or could not be read. */
export type TimelineLoad =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "loaded" };

/**
 * Who decided what, from the project's coordination history of the last 30 days: task moves and
 * handoffs, merged pull requests, owner changes, owner's calls and their decisions, settled
 * overlaps, each with the person behind it. It narrows by area, task and person. A history that
 * cannot be read says so and leaves the rest of the page as it is.
 */
export function TeamTimeline({
  rows,
  choices,
  load,
}: {
  readonly rows: ReadonlyArray<TimelineRow>;
  readonly choices: TimelineChoices;
  readonly load: TimelineLoad;
}) {
  const [filter, setFilter] = useState<TimelineFilter>(NO_FILTER);
  const [shown, setShown] = useState(TIMELINE_PAGE);
  const narrowed = filterTimeline(rows, filter);
  const set = (next: Partial<TimelineFilter>) => {
    setFilter({ ...filter, ...next });
    setShown(TIMELINE_PAGE);
  };
  return (
    <section aria-label="Who decided what" className="flex flex-col gap-2.5">
      <PeerSectionLabel>Who decided what</PeerSectionLabel>
      <div className="flex flex-wrap gap-2">
        <FilterSelect
          label="Area"
          all="All areas"
          value={filter.area}
          choices={choices.areas.map((area) => ({ value: area, label: area }))}
          onChange={(area) => set({ area })}
        />
        <FilterSelect
          label="Task"
          all="All tasks"
          value={filter.task}
          choices={choices.tasks.map((task) => ({ value: task.id, label: task.label }))}
          onChange={(task) => set({ task })}
        />
        <FilterSelect
          label="Person"
          all="Everyone"
          value={filter.person}
          choices={choices.people.map((person) => ({ value: person.email, label: person.name }))}
          onChange={(person) => set({ person })}
        />
      </div>
      {load.kind === "failed" ? (
        <p role="alert" className="text-sm text-muted-foreground">
          The history could not be read. {load.message}
        </p>
      ) : null}
      {load.kind === "loading" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading the history…
        </p>
      ) : narrowed.length === 0 ? (
        load.kind === "failed" ? null : (
          <PeerCard>
            <p className="text-sm text-muted-foreground">
              {rows.length === 0
                ? `Nothing happened in the last ${TIMELINE_DAYS} days.`
                : "Nothing here matches that filter."}
            </p>
          </PeerCard>
        )
      ) : (
        <>
          <ol className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
            {narrowed.slice(0, shown).map((row) => (
              <li key={row.id} className="flex items-start gap-2.5 px-4 py-2.5">
                <PersonAvatar
                  name={row.person?.name ?? "–"}
                  mine={row.person?.mine ?? false}
                  size="sm"
                />
                <span className="min-w-0 flex-1 text-sm break-words text-foreground">
                  {row.what}
                </span>
                <time
                  dateTime={row.at}
                  className="shrink-0 text-xs whitespace-nowrap text-muted-foreground"
                >
                  {row.when}
                </time>
              </li>
            ))}
          </ol>
          {narrowed.length > shown ? (
            <div className="flex">
              <InlineButton tone="muted" onClick={() => setShown(shown + TIMELINE_PAGE)}>
                Show older
              </InlineButton>
            </div>
          ) : null}
        </>
      )}
      <p className="text-xs text-muted-foreground">
        From the project's coordination history, last {TIMELINE_DAYS} days.
      </p>
    </section>
  );
}

/** One filter: its label over a picker whose first choice leaves it out. */
function FilterSelect({
  label,
  all,
  value,
  choices,
  onChange,
}: {
  readonly label: string;
  readonly all: string;
  readonly value: string | null;
  readonly choices: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly onChange: (value: string | null) => void;
}) {
  const items = [{ value: ANYONE, label: all }, ...choices];
  // A choice that has no entry any more stays chosen, under its own words, until it is changed.
  const known = items.some((item) => item.value === (value ?? ANYONE));
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Select
        value={value ?? ANYONE}
        items={known ? items : [...items, { value: value ?? ANYONE, label: value ?? all }]}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next === ANYONE ? null : next);
        }}
      >
        <SelectTrigger size="sm" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </label>
  );
}

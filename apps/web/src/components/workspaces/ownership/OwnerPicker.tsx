import { cn } from "../../../lib/utils";
import { Input } from "../../ui/input";
import { Radio, RadioGroup } from "../../ui/radio-group";
import { PeerStackedField } from "../PeerDialog";
import type { OwnerCandidate } from "./ownership.logic";

/** The row that takes the owner away; no address looks like it. */
export const NO_OWNER = "no-owner";

/** A person's initial in a quiet circle, the way the sidebar marks people. */
function Initial({ name, quiet = false }: { readonly name: string; readonly quiet?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        quiet ? "bg-muted text-muted-foreground" : "bg-primary/12 text-foreground",
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function Row({
  value,
  picked,
  mark,
  title,
  line,
}: {
  readonly value: string;
  readonly picked: boolean;
  readonly mark: string;
  readonly title: string;
  readonly line: string | undefined;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-2.5 border-b px-3 py-1.5 last:border-b-0 hover:bg-accent/50",
        picked && "bg-accent",
      )}
    >
      <Radio value={value} />
      <Initial name={mark} quiet={value === NO_OWNER} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{title}</span>
        {line === undefined ? null : (
          <span className="truncate text-xs text-muted-foreground">{line}</span>
        )}
      </span>
    </label>
  );
}

/**
 * A search field over the project's members, and the members it leaves as rows to pick one from.
 * Set owner offers "No owner" first; Hand over offers only people. `describe` writes the line under
 * a person's name.
 */
export function OwnerPicker({
  id,
  label,
  query,
  onQueryChange,
  options,
  value,
  onChange,
  offerNone,
  disabled,
  describe,
}: {
  readonly id: string;
  /** The search field's label: "Find a project member", "New owner". */
  readonly label: string;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly options: ReadonlyArray<OwnerCandidate>;
  /** The address picked, `NO_OWNER`, or "" while none is. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly offerNone: boolean;
  readonly disabled: boolean;
  readonly describe: (candidate: OwnerCandidate) => string | undefined;
}) {
  const showNone = offerNone && query.trim() === "";
  return (
    <div className="flex flex-col gap-3">
      <PeerStackedField label={label} htmlFor={id}>
        <Input
          id={id}
          type="search"
          autoFocus
          placeholder="Name or email"
          value={query}
          disabled={disabled}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </PeerStackedField>
      <RadioGroup
        aria-label="Owner"
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next);
        }}
      >
        <div className="overflow-hidden rounded-xl border bg-card">
          {showNone ? (
            <Row
              value={NO_OWNER}
              picked={value === NO_OWNER}
              mark="–"
              title="No owner"
              line="Falls back to the area owner, if any"
            />
          ) : null}
          {options.map((candidate) => (
            <Row
              key={candidate.email}
              value={candidate.email}
              picked={value === candidate.email}
              mark={candidate.name}
              title={candidate.mine ? `${candidate.name} (you)` : candidate.name}
              line={describe(candidate)}
            />
          ))}
          {options.length === 0 && !showNone ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              No one on this project matches.
            </p>
          ) : null}
        </div>
      </RadioGroup>
    </div>
  );
}

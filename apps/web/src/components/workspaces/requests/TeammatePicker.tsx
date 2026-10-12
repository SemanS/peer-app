import { CheckIcon } from "lucide-react";
import { useState } from "react";

import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../../ui/combobox";
import { SelectButton } from "../../ui/select";
import { matchesTeammate, type TeammateOption } from "./requests.logic";

/** A person's initial in a quiet circle, the way the sidebar marks people. */
function Initial({ name }: { readonly name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function GroupLabel({ children }: { readonly children: string }) {
  return (
    <p
      role="presentation"
      className="px-2 pt-2 pb-1 text-2xs font-semibold tracking-wide text-muted-foreground uppercase"
    >
      {children}
    </p>
  );
}

/** What a row says under a name: where to write them, and whether they are at work now. */
function meta(option: TeammateOption): string {
  if (option.group === "elsewhere") return `${option.email} · not on this project`;
  return option.online ? `${option.email} · online now` : option.email;
}

/**
 * Who a request goes to, picked from the project's members first and then the workspace's others.
 * Those others are listed so that a missing teammate is explained, but cannot be picked: the Hub
 * delivers a request only to someone on the project. Typing narrows the list by name or address.
 */
export function TeammatePicker({
  id,
  options,
  value,
  projectName,
  workspaceName,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly options: ReadonlyArray<TeammateOption>;
  /** The chosen address, or "" for none. */
  readonly value: string;
  readonly projectName: string;
  readonly workspaceName: string;
  readonly disabled: boolean;
  readonly onChange: (email: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.email === value);
  const shown = options.filter((option) => matchesTeammate(option, query));
  const onProject = shown.filter((option) => option.group === "project");
  const elsewhere = shown.filter((option) => option.group === "elsewhere");
  const rows = [...onProject, ...elsewhere];
  const addresses = options.map((option) => option.email);
  const row = (option: TeammateOption) => (
    <ComboboxItem
      key={option.email}
      hideIndicator
      index={rows.indexOf(option)}
      value={option.email}
      disabled={option.group === "elsewhere"}
    >
      <Initial name={option.name} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{option.name}</span>
        <span className="truncate text-xs text-muted-foreground">{meta(option)}</span>
      </span>
      {option.online ? (
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-success" />
      ) : null}
      {option.email === value ? (
        <CheckIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      ) : null}
    </ComboboxItem>
  );
  return (
    <Combobox
      items={addresses}
      filteredItems={rows.map((option) => option.email)}
      filter={null}
      autoHighlight
      disabled={disabled}
      value={value === "" ? null : value}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery("");
      }}
      onValueChange={(next) => {
        if (typeof next !== "string") return;
        onChange(next);
        setOpen(false);
      }}
    >
      <ComboboxTrigger id={id} render={<SelectButton size="lg" />}>
        {selected === undefined ? (
          <span className="text-muted-foreground">Choose a teammate</span>
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            <Initial name={selected.name} />
            <span className="truncate">{selected.name}</span>
            <span className="truncate text-xs text-muted-foreground">{selected.email}</span>
          </span>
        )}
      </ComboboxTrigger>
      <ComboboxPopup align="start" className="flex w-96 flex-col">
        <ComboboxSearchInput
          aria-label="Search teammates"
          placeholder="Search by name or email"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxEmpty>
          {query.trim() === ""
            ? `No one else is on ${projectName} yet.`
            : `No one on ${workspaceName} matches.`}
        </ComboboxEmpty>
        <ComboboxList className="max-h-72">
          {onProject.length === 0 ? null : <GroupLabel>{`In ${projectName}`}</GroupLabel>}
          {onProject.map(row)}
          {elsewhere.length === 0 ? null : (
            <>
              <GroupLabel>{`Elsewhere in ${workspaceName}`}</GroupLabel>
              <p className="px-2 pb-1 text-xs text-muted-foreground">
                {`Not on ${projectName}, so a request can't reach them. A project lead adds people in Project settings.`}
              </p>
              {elsewhere.map(row)}
            </>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

import { CheckIcon, CornerDownRightIcon, FolderIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../ui/combobox";
import { parentChoices } from "./taskTree.logic";
import type { WorkProjectNode } from "./workTree.logic";

/** The picker's row for no parent. */
const NO_PARENT = "\u0000no-parent";

/**
 * The item a task sits under, as a chip: it lists the project's groups and tasks in the tree's
 * order and finds one by title. Moving a task leaves out the task and what is under it.
 */
export function UnderChip({
  project,
  value,
  moving,
  disabled = false,
  defaultOpen = false,
  onChange,
}: {
  readonly project: WorkProjectNode;
  /** null: a root. */
  readonly value: string | null;
  readonly moving?: string | undefined;
  readonly disabled?: boolean;
  readonly defaultOpen?: boolean;
  readonly onChange: (parent: string | null) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const choices = parentChoices(project, query, moving);
  const items = [NO_PARENT, ...choices.map((choice) => choice.id)];
  const chosen =
    value === null
      ? undefined
      : project.areas.flatMap((area) => area.tasks).find((task) => task.id === value);
  const byId = new Map(choices.map((choice) => [choice.id, choice]));
  return (
    <Combobox
      items={items}
      filteredItems={items}
      filter={null}
      autoHighlight
      disabled={disabled}
      value={value ?? NO_PARENT}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery("");
      }}
      onValueChange={(next) => {
        if (typeof next !== "string") return;
        onChange(next === NO_PARENT ? null : next);
        setOpen(false);
      }}
    >
      <ComboboxTrigger
        aria-label={chosen === undefined ? "Under" : `Under: ${chosen.title}`}
        render={<Button type="button" variant="outline" size="xs" />}
      >
        <CornerDownRightIcon aria-hidden />
        <span className={cn("max-w-48 truncate", chosen === undefined && "text-muted-foreground")}>
          {chosen?.title ?? "Under"}
        </span>
      </ComboboxTrigger>
      <ComboboxPopup align="start" className="flex w-80 flex-col">
        <ComboboxSearchInput
          aria-label="Find an item by title"
          placeholder="Find an item by title"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxList className="max-h-72">
          {items.map((item, index) => {
            const choice = byId.get(item);
            const depth = choice?.depth ?? 0;
            return (
              <ComboboxItem key={item} hideIndicator index={index} value={item}>
                {choice === undefined ? (
                  <span className="flex-1 text-muted-foreground">Not under an item</span>
                ) : (
                  <span
                    className="flex min-w-0 flex-1 items-center gap-1.5"
                    style={depth === 0 ? undefined : { paddingInlineStart: `${depth}rem` }}
                  >
                    {choice.group ? (
                      <FolderIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : null}
                    {choice.key === undefined ? null : (
                      <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                        {choice.key}
                      </span>
                    )}
                    <span className="truncate">{choice.title}</span>
                  </span>
                )}
                {(value ?? NO_PARENT) === item ? (
                  <CheckIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                ) : null}
              </ComboboxItem>
            );
          })}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

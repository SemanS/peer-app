import { ChevronRightIcon, PlusIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "../../ui/badge";
import { Button, InlineButton } from "../../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../../ui/collapsible";
import { Input } from "../../ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../../ui/menu";
import {
  envNameProblem,
  removeEnvEntry,
  setEnvEntry,
  type AddFromCatalog,
  type Chip,
  type ToolRowModel,
} from "./projectTools.logic";
import { ValueSource } from "./ValueSource";

function Problem({ children }: { readonly children: ReactNode }) {
  return (
    <p role="alert" className="text-xs text-destructive-foreground">
      {children}
    </p>
  );
}

const ACTION_LABEL = { review: "Review", secrets: "Set" } as const;

/**
 * A pill of what this computer says of a tool: `value · source`, amber where the tool does not work
 * here yet, with a link to where this computer approves tools and sets their secrets.
 */
function ToolChip({
  chip,
  onAction,
}: {
  readonly chip: Chip;
  /** Opens This computer › Tool trust. */
  readonly onAction: () => void;
}) {
  return (
    <ValueSource
      value={chip.value}
      from={{ kind: "computer" }}
      source={chip.source}
      tone={chip.tone}
      {...(chip.action === undefined
        ? {}
        : { change: { label: ACTION_LABEL[chip.action], onClick: onAction } })}
    />
  );
}

/**
 * One setting a project gives a tool: its name and value as fields. A row is saved into the draft
 * when focus leaves it (so Tab from the name to the value does not end the edit); a name that
 * cannot be one says why and keeps the row as typed.
 */
function SettingRow({
  name,
  value,
  others,
  readOnly,
  onCommit,
  onRemove,
}: {
  /** "" for a setting not added yet. */
  readonly name: string;
  readonly value: string;
  readonly others: ReadonlyArray<string>;
  readonly readOnly: boolean;
  readonly onCommit: (name: string, value: string) => void;
  readonly onRemove: () => void;
}) {
  const [typedName, setTypedName] = useState(name);
  const [typedValue, setTypedValue] = useState(value);
  const [problem, setProblem] = useState<string | null>(null);
  const leave = () => {
    const trimmed = typedName.trim();
    // A new row left empty is a row nobody wanted.
    if (name === "" && trimmed === "" && typedValue === "") {
      onRemove();
      return;
    }
    if (trimmed === name && typedValue === value) {
      setProblem(null);
      return;
    }
    const found = envNameProblem(trimmed, others);
    setProblem(found);
    if (found === null) onCommit(trimmed, typedValue);
  };
  return (
    <div
      className="flex flex-col gap-1"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) leave();
      }}
    >
      <div className="grid items-center gap-2 sm:grid-cols-[12.5rem_minmax(0,1fr)_auto]">
        <Input
          nativeInput
          size="sm"
          font="mono"
          aria-label="Name"
          aria-invalid={problem !== null}
          readOnly={readOnly}
          value={typedName}
          onChange={(event) => setTypedName(event.target.value)}
        />
        <Input
          nativeInput
          size="sm"
          font="mono"
          aria-label="Value"
          readOnly={readOnly}
          value={typedValue}
          onChange={(event) => setTypedValue(event.target.value)}
        />
        {readOnly ? null : (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={name === "" ? "Cancel the new setting" : `Remove ${name}`}
            onClick={onRemove}
          >
            <XIcon aria-hidden />
          </Button>
        )}
      </div>
      {problem === null ? null : <Problem>{problem}</Problem>}
    </div>
  );
}

/**
 * "Settings for Booking · 1": the project's own environment for a local tool, folded. A remote tool
 * takes none, so any it has are shown as ignored.
 */
function ToolSettings({
  projectName,
  tool,
  editable,
  onChange,
}: {
  readonly projectName: string;
  readonly tool: ToolRowModel;
  readonly editable: boolean;
  readonly onChange: (env: Readonly<Record<string, string>>) => void;
}) {
  const [adding, setAdding] = useState(false);
  const entries = Object.entries(tool.env);
  const canEdit = editable && tool.takesSettings;
  if (entries.length === 0 && !canEdit) return null;
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1.5 rounded-md text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-data-panel-open:rotate-90 motion-reduce:transition-none"
        />
        Settings for {projectName}
        {entries.length === 0 ? "" : ` · ${entries.length}`}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex max-w-xl flex-col gap-2 pt-2 pb-1">
          {tool.takesSettings ? null : (
            <p className="text-xs text-muted-foreground">
              A remote tool takes no settings, so these are ignored.
            </p>
          )}
          {entries.map(([name, value]) => (
            <SettingRow
              // Keyed by what is saved in the draft, so a discard shows the setting as it was.
              key={`${name}\u0000${value}`}
              name={name}
              value={value}
              others={entries.map(([other]) => other).filter((other) => other !== name)}
              readOnly={!canEdit}
              onCommit={(next, nextValue) => onChange(setEnvEntry(tool.env, name, next, nextValue))}
              onRemove={() => onChange(removeEnvEntry(tool.env, name))}
            />
          ))}
          {canEdit && adding ? (
            <SettingRow
              key="new"
              name=""
              value=""
              others={entries.map(([other]) => other)}
              readOnly={false}
              onCommit={(next, nextValue) => {
                onChange(setEnvEntry(tool.env, null, next, nextValue));
                setAdding(false);
              }}
              onRemove={() => setAdding(false)}
            />
          ) : null}
          {canEdit && !adding ? (
            <Button
              className="self-start"
              size="xs"
              variant="ghost-muted"
              onClick={() => setAdding(true)}
            >
              <PlusIcon aria-hidden />
              Add a setting
            </Button>
          ) : null}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/** One tool of the project: what it is, what this computer says of it, and the project's settings. */
function ToolCard({
  tool,
  projectName,
  editable,
  notSaved,
  onRemove,
  onEnv,
  onAction,
}: {
  readonly tool: ToolRowModel;
  readonly projectName: string;
  readonly editable: boolean;
  readonly notSaved: boolean;
  readonly onRemove: () => void;
  readonly onEnv: (env: Readonly<Record<string, string>>) => void;
  readonly onAction: () => void;
}) {
  return (
    <li className="flex flex-col gap-2 px-3.5 py-3">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-foreground">{tool.name}</span>
            {notSaved ? <Badge variant="info">Not saved</Badge> : null}
          </span>
          {tool.description === undefined && tool.docs === undefined ? null : (
            <span className="text-sm text-muted-foreground">
              {tool.description}
              {tool.description !== undefined && tool.docs !== undefined ? " · " : null}
              {tool.docs === undefined ? null : (
                <InlineButton render={<a href={tool.docs} target="_blank" rel="noreferrer" />}>
                  Docs
                </InlineButton>
              )}
            </span>
          )}
        </div>
        {editable ? (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`Remove ${tool.name} from ${projectName}`}
            onClick={onRemove}
          >
            <XIcon aria-hidden />
          </Button>
        ) : null}
      </div>
      {tool.chips.length === 0 ? null : (
        <div className="flex flex-wrap gap-1.5">
          {tool.chips.map((chip) => (
            <ToolChip key={`${chip.value}:${chip.source}`} chip={chip} onAction={onAction} />
          ))}
        </div>
      )}
      {tool.installHints.map((hint) => (
        <p key={hint} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ))}
      <ToolSettings projectName={projectName} tool={tool} editable={editable} onChange={onEnv} />
    </li>
  );
}

/** A tool of the project and whether the draft adds it. */
export interface ToolListItem {
  readonly tool: ToolRowModel;
  readonly notSaved: boolean;
}

export function ToolList({
  items,
  projectName,
  editable,
  onRemove,
  onEnv,
  onAction,
}: {
  readonly items: ReadonlyArray<ToolListItem>;
  readonly projectName: string;
  readonly editable: boolean;
  readonly onRemove: (id: string) => void;
  readonly onEnv: (id: string, env: Readonly<Record<string, string>>) => void;
  /** Opens This computer › Tool trust. */
  readonly onAction: () => void;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No tools yet.</p>;
  }
  return (
    <ul
      aria-label={`Tools for ${projectName}`}
      className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card"
    >
      {items.map(({ tool, notSaved }) => (
        <ToolCard
          key={tool.id}
          tool={tool}
          projectName={projectName}
          editable={editable}
          notSaved={notSaved}
          onRemove={() => onRemove(tool.id)}
          onEnv={(env) => onEnv(tool.id, env)}
          onAction={onAction}
        />
      ))}
    </ul>
  );
}

/**
 * "Add from catalog": the tools of the workspace catalog the project does not use yet, each with what
 * it does and how it runs, and the way on to the catalog itself. Where there is nothing to add it
 * says why (the catalog is loading, it is empty, or the project has all of it) instead of a line
 * that fits only the last.
 */
export function CatalogMenu({
  state,
  onAdd,
  onOpenCatalog,
}: {
  readonly state: AddFromCatalog;
  readonly onAdd: (id: string) => void;
  readonly onOpenCatalog: () => void;
}) {
  const { footer } = state;
  return (
    <Menu>
      <MenuTrigger render={<Button size="sm" variant="outline" />}>
        <PlusIcon aria-hidden />
        Add from catalog
      </MenuTrigger>
      <MenuPopup align="end" className="w-72">
        {state.kind === "choices" ? (
          state.choices.map((choice) => (
            <MenuItem key={choice.id} onClick={() => onAdd(choice.id)}>
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{choice.name}</span>
                <span className="text-xs text-muted-foreground">{choice.detail}</span>
              </span>
            </MenuItem>
          ))
        ) : (
          <p role="status" className="px-2 py-1.5 text-sm text-muted-foreground">
            {state.message}
          </p>
        )}
        {footer === null ? null : <MenuSeparator />}
        {footer === null ? null : footer.kind === "open" ? (
          <MenuItem onClick={onOpenCatalog}>{footer.label}</MenuItem>
        ) : (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">{footer.text}</p>
        )}
      </MenuPopup>
    </Menu>
  );
}

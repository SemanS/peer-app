/**
 * The editor of the tool catalog page (design artboard 17): one tool's definition, with how agents
 * reach it, the environment (or headers) it is given, what it needs on the computer and the
 * projects that use it. Fields go into the page's draft as soon as they can be one; rows of two
 * fields are saved when focus leaves them. It draws what `toolCatalog.logic` works out and hands
 * every edit back to the page.
 */
import { PlusIcon, XIcon } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";

import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { PeerStackedField } from "../PeerDialog";
import { ProjectMark } from "../signals";
import { projectScopeKey } from "../workBoard.logic";
import type { Transport } from "./projectTools.logic";
import { Problem, useTyped } from "./ToolCatalogParts";
import {
  TRANSPORTS,
  argsEdit,
  commandEdit,
  descriptionEdit,
  docsEdit,
  docsLinkProblem,
  envVariableProblem,
  headerNameProblem,
  joinArgs,
  mcpOf,
  nameEdit,
  pairsEdit,
  removeRequirementEdit,
  requirementCommandProblem,
  restoreTransport,
  secretNamesIn,
  secretsNote,
  setRequirementEdit,
  splitArgs,
  transportEdit,
  urlEdit,
  withPair,
  withoutPair,
  type Edit,
  type ToolProblems,
  type ToolValue,
} from "./toolCatalog.logic";

// ---- rows of two fields ---------------------------------------------------------------------------

/** How a row's two fields share its width: a name and a value, or two halves. */
const COLUMNS = {
  pair: "sm:grid-cols-[11rem_minmax(0,1fr)_auto]",
  halves: "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]",
} as const;

/**
 * One row of two fields: an environment variable or header and its value, or a command and how to
 * install it. A row is saved into the draft when focus leaves it (so Tab from one field to the next
 * does not end the edit); one that cannot be says why and stays as typed. A new row left empty is
 * one nobody wanted.
 */
function TwoFieldRow({
  first,
  second,
  columns,
  labels,
  placeholders,
  readOnly,
  check,
  onCommit,
  onRemove,
  removeLabel,
}: {
  /** "" for a row not added yet. */
  readonly first: string;
  readonly second: string;
  readonly columns: keyof typeof COLUMNS;
  readonly labels: readonly [string, string];
  readonly placeholders: readonly [string, string];
  readonly readOnly: boolean;
  /** What is wrong with the row as typed, if anything. */
  readonly check: (first: string, second: string) => string | null;
  readonly onCommit: (first: string, second: string) => void;
  readonly onRemove: () => void;
  readonly removeLabel: string;
}) {
  const [typedFirst, setTypedFirst] = useState(first);
  const [typedSecond, setTypedSecond] = useState(second);
  const [problem, setProblem] = useState<string | null>(null);
  const leave = () => {
    const name = typedFirst.trim();
    if (first === "" && name === "" && typedSecond.trim() === "") {
      onRemove();
      return;
    }
    if (name === first && typedSecond === second) {
      setProblem(null);
      return;
    }
    const found = check(name, typedSecond);
    setProblem(found);
    if (found === null) onCommit(name, typedSecond);
  };
  return (
    <div
      className="flex flex-col gap-1"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) leave();
      }}
    >
      <div className={cn("grid items-center gap-2", COLUMNS[columns])}>
        <Input
          nativeInput
          size="sm"
          font="mono"
          aria-label={labels[0]}
          aria-invalid={problem !== null || undefined}
          placeholder={placeholders[0]}
          readOnly={readOnly}
          value={typedFirst}
          onChange={(event) => setTypedFirst(event.target.value)}
        />
        <Input
          nativeInput
          size="sm"
          font="mono"
          aria-label={labels[1]}
          placeholder={placeholders[1]}
          readOnly={readOnly}
          value={typedSecond}
          onChange={(event) => setTypedSecond(event.target.value)}
        />
        {readOnly ? null : (
          <Button size="icon-xs" variant="ghost-muted" aria-label={removeLabel} onClick={onRemove}>
            <XIcon aria-hidden />
          </Button>
        )}
      </div>
      {problem === null ? null : <Problem>{problem}</Problem>}
    </div>
  );
}

/** A list of two-field rows with a way to add one: the shape the environment and the needs share. */
function RowsEditor({
  rows,
  adding,
  addLabel,
  readOnly,
  renderRow,
  renderNew,
  onAdd,
}: {
  readonly rows: ReadonlyArray<{ readonly key: string }>;
  readonly adding: boolean;
  readonly addLabel: string;
  readonly readOnly: boolean;
  readonly renderRow: (index: number) => ReactNode;
  readonly renderNew: () => ReactNode;
  readonly onAdd: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, index) => (
        <div key={row.key}>{renderRow(index)}</div>
      ))}
      {readOnly ? null : adding ? (
        renderNew()
      ) : (
        <Button className="self-start" size="xs" variant="ghost-muted" onClick={onAdd}>
          <PlusIcon aria-hidden />
          {addLabel}
        </Button>
      )}
    </div>
  );
}

/** The environment of a local tool, the headers of a remote one. */
function PairsEditor({
  id,
  value,
  readOnly,
  onEdit,
}: {
  readonly id: string;
  readonly value: ToolValue;
  readonly readOnly: boolean;
  readonly onEdit: (edit: Edit) => void;
}) {
  const [adding, setAdding] = useState(false);
  const local = value.transport === "stdio";
  const names = value.pairs.map(([name]) => name);
  const commit = (pairs: ReadonlyArray<readonly [string, string]>) =>
    onEdit(pairsEdit(id, value.transport, pairs));
  const problemOf = (name: string, others: ReadonlyArray<string>) =>
    local ? envVariableProblem(name, others) : headerNameProblem(name, others);
  return (
    <RowsEditor
      rows={value.pairs.map(([name, text]) => ({ key: `${name}\u0000${text}` }))}
      adding={adding}
      addLabel={local ? "Add a variable" : "Add a header"}
      readOnly={readOnly}
      onAdd={() => setAdding(true)}
      renderRow={(index) => {
        const [name, text] = value.pairs[index]!;
        return (
          <TwoFieldRow
            first={name}
            second={text}
            columns="pair"
            labels={["Name", "Value"]}
            placeholders={["NAME", "value or ${secret:NAME}"]}
            readOnly={readOnly}
            check={(next) =>
              problemOf(
                next,
                names.filter((other) => other !== name),
              )
            }
            onCommit={(nextName, nextValue) =>
              commit(withPair(value.pairs, name, nextName, nextValue))
            }
            onRemove={() => commit(withoutPair(value.pairs, name))}
            removeLabel={`Remove ${name}`}
          />
        );
      }}
      renderNew={() => (
        <TwoFieldRow
          key="new"
          first=""
          second=""
          columns="pair"
          labels={["Name", "Value"]}
          placeholders={["NAME", "value or ${secret:NAME}"]}
          readOnly={false}
          check={(next) => problemOf(next, names)}
          onCommit={(nextName, nextValue) => {
            commit(withPair(value.pairs, null, nextName, nextValue));
            setAdding(false);
          }}
          onRemove={() => setAdding(false)}
          removeLabel="Cancel the new row"
        />
      )}
    />
  );
}

/** The commands a tool needs on the computer, each with how to install it where it is missing. */
function RequirementsEditor({
  id,
  raw,
  value,
  readOnly,
  onEdit,
}: {
  readonly id: string;
  readonly raw: unknown;
  readonly value: ToolValue;
  readonly readOnly: boolean;
  readonly onEdit: (edit: Edit) => void;
}) {
  const [adding, setAdding] = useState(false);
  const check = (command: string) =>
    command.trim() === ""
      ? "Name the command this install line is for."
      : requirementCommandProblem(command);
  return (
    <RowsEditor
      rows={value.requires.map((requirement, index) => ({
        key: `${index}\u0000${requirement.command}\u0000${requirement.install}`,
      }))}
      adding={adding}
      addLabel="Add a command"
      readOnly={readOnly}
      onAdd={() => setAdding(true)}
      renderRow={(index) => {
        const requirement = value.requires[index]!;
        return (
          <TwoFieldRow
            first={requirement.command}
            second={requirement.install}
            columns="halves"
            labels={["Check command", "How to install"]}
            placeholders={["psql", "brew install libpq"]}
            readOnly={readOnly}
            check={check}
            onCommit={(command, install) =>
              onEdit(setRequirementEdit(id, raw, index, { command, install }))
            }
            onRemove={() => onEdit(removeRequirementEdit(id, raw, index))}
            removeLabel={`Remove ${requirement.command || "this command"}`}
          />
        );
      }}
      renderNew={() => (
        <TwoFieldRow
          key="new"
          first=""
          second=""
          columns="halves"
          labels={["Check command", "How to install"]}
          placeholders={["psql", "brew install libpq"]}
          readOnly={false}
          check={check}
          onCommit={(command, install) => {
            onEdit(setRequirementEdit(id, raw, null, { command, install }));
            setAdding(false);
          }}
          onRemove={() => setAdding(false)}
          removeLabel="Cancel the new row"
        />
      )}
    />
  );
}

// ---- the editor -----------------------------------------------------------------------------------

/** A project in the editor's "Projects" row: whether it uses the tool, and whether the person may change that. */
export interface UsageProject {
  readonly id: string;
  readonly name: string;
  readonly uses: boolean;
  readonly mayChange: boolean;
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-sm font-medium">{title}</span>
      {children}
    </div>
  );
}

/**
 * One tool's definition: its name and description, how agents reach it, the environment (or
 * headers) it is given, what it needs on the computer, and the projects that use it. Fields go into
 * the draft as soon as they can be one. Where the person does not change the catalog the fields are
 * read-only, and only the projects they lead take part.
 */
export function ToolEditor({
  workspace,
  id,
  raw,
  value,
  problems,
  editable,
  projects,
  onEdit,
  onUse,
  footer,
}: {
  readonly workspace: string;
  readonly id: string;
  /** The tool's node of the document, whole, so what the editor does not show is kept. */
  readonly raw: unknown;
  readonly value: ToolValue;
  readonly problems: ToolProblems;
  /** The person changes the definition (admins); else it is read. */
  readonly editable: boolean;
  readonly projects: ReadonlyArray<UsageProject>;
  readonly onEdit: (edit: Edit) => void;
  readonly onUse: (project: UsageProject, use: boolean) => void;
  /** The pause note and the buttons. */
  readonly footer: ReactNode;
}) {
  const ids = [useId(), useId(), useId()] as const;
  const name = useTyped(value.name);
  const description = useTyped(value.description);
  const docs = useTyped(value.docs);
  const command = useTyped(value.command);
  const args = useTyped(joinArgs(value.args));
  const url = useTyped(value.url);
  const [argsProblem, setArgsProblem] = useState<string | null>(null);
  // What was typed for the way of reaching the tool that is left, to come back to if it is chosen again.
  const left = useRef<{ stdio?: unknown; remote?: unknown }>({});
  const local = value.transport === "stdio";
  const addable = projects.filter((project) => !project.uses && project.mayChange);
  const using = projects.filter((project) => project.uses);
  const secrets = secretNamesIn(value);
  const noRequirements = value.requires.length === 0;
  // A name typed away is not taken into the draft, so the problem is said of what is typed.
  const nameProblem =
    name.typed !== null && name.typed.trim() === "" ? "A tool needs a name." : problems.name;

  const reach = (to: Transport) => {
    if (to === value.transport) return;
    const edit = transportEdit(id, raw, to);
    const kind = local ? "stdio" : "remote";
    left.current[kind] = mcpOf(raw);
    const back = to === "stdio" ? left.current.stdio : left.current.remote;
    onEdit(back === undefined ? edit : { ...edit, value: restoreTransport(back, to) });
  };

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="min-w-0 text-base font-semibold break-words">{value.name || id}</h2>
        <span className="font-mono text-xs text-muted-foreground">{id}</span>
      </div>

      <PeerStackedField label="Name" htmlFor={ids[0]}>
        <Input
          id={ids[0]}
          className="max-w-sm"
          autoComplete="off"
          value={name.shown}
          readOnly={!editable}
          aria-invalid={nameProblem !== undefined || undefined}
          onChange={(event) => {
            const text = event.target.value;
            name.type(text);
            if (text.trim() !== "") onEdit(nameEdit(id, text.trim()));
          }}
          onBlur={name.leave}
        />
      </PeerStackedField>
      {nameProblem === undefined ? null : <Problem>{nameProblem}</Problem>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PeerStackedField label="Description" htmlFor={ids[1]}>
          <Input
            id={ids[1]}
            autoComplete="off"
            value={description.shown}
            readOnly={!editable}
            onChange={(event) => {
              description.type(event.target.value);
              onEdit(descriptionEdit(id, event.target.value));
            }}
            onBlur={description.leave}
          />
        </PeerStackedField>
        <PeerStackedField
          label="Docs link"
          htmlFor={ids[2]}
          hint={
            noRequirements
              ? "Kept with the first command the tool needs, so add one below first."
              : undefined
          }
        >
          <Input
            id={ids[2]}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://wiki.acme.dev/mcp/postgres"
            value={docs.shown}
            readOnly={!editable}
            disabled={editable && noRequirements}
            aria-invalid={problems.docs !== undefined || undefined}
            onChange={(event) => {
              const text = event.target.value;
              docs.type(text);
              if (docsLinkProblem(text) === null) onEdit(docsEdit(id, raw, text));
            }}
            onBlur={docs.leave}
          />
        </PeerStackedField>
      </div>
      {problems.docs === undefined ? null : <Problem>{problems.docs}</Problem>}

      <Section title="How agents reach it">
        <ToggleGroup
          aria-label="Transport"
          value={[value.transport]}
          disabled={!editable}
          onValueChange={(next) => {
            const chosen = TRANSPORTS.find((transport) => transport === next[0]);
            // Pressing the chosen one again would clear it; a tool is always reached some way.
            if (chosen !== undefined) reach(chosen);
          }}
        >
          {TRANSPORTS.map((transport) => (
            <Toggle key={transport} value={transport}>
              {transport}
            </Toggle>
          ))}
        </ToggleGroup>
        {local ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <Input
              font="mono"
              autoComplete="off"
              spellCheck={false}
              aria-label="Command"
              placeholder="npx"
              value={command.shown}
              readOnly={!editable}
              aria-invalid={problems.command !== undefined || undefined}
              onChange={(event) => {
                command.type(event.target.value);
                onEdit(commandEdit(id, event.target.value));
              }}
              onBlur={command.leave}
            />
            <Input
              font="mono"
              autoComplete="off"
              spellCheck={false}
              aria-label="Arguments"
              placeholder="@acme/mcp-postgres --read-only"
              value={args.shown}
              readOnly={!editable}
              aria-invalid={argsProblem !== null || undefined}
              onChange={(event) => {
                const text = event.target.value;
                args.type(text);
                const read = splitArgs(text);
                setArgsProblem(read.ok ? null : read.problem);
                if (read.ok) onEdit(argsEdit(id, read.args));
              }}
              onBlur={() => {
                args.leave();
                setArgsProblem(null);
              }}
            />
          </div>
        ) : (
          <Input
            font="mono"
            autoComplete="off"
            spellCheck={false}
            aria-label="URL"
            placeholder="https://mcp.acme.dev/postgres"
            value={url.shown}
            readOnly={!editable}
            aria-invalid={problems.url !== undefined || undefined}
            onChange={(event) => {
              url.type(event.target.value);
              onEdit(urlEdit(id, event.target.value));
            }}
            onBlur={url.leave}
          />
        )}
        {[problems.command, problems.url, argsProblem].map((problem) =>
          problem === undefined || problem === null ? null : (
            <Problem key={problem}>{problem}</Problem>
          ),
        )}
      </Section>

      <Section title={local ? "Environment" : "Headers"}>
        <PairsEditor id={id} value={value} readOnly={!editable} onEdit={onEdit} />
        {problems.secret === undefined ? null : <Problem>{problems.secret}</Problem>}
        {problems.pairs === undefined ? null : <Problem>{problems.pairs}</Problem>}
        <p className="text-xs text-muted-foreground">{secretsNote(secrets)}</p>
      </Section>

      <Section title="Needs on the computer">
        <RequirementsEditor id={id} raw={raw} value={value} readOnly={!editable} onEdit={onEdit} />
        {problems.requires === undefined ? null : <Problem>{problems.requires}</Problem>}
        <p className="text-xs text-muted-foreground">
          Peer shows the install command to people who miss it. It never runs it.
        </p>
      </Section>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="me-1.5 text-sm font-medium">Projects</span>
        {using.length === 0 ? (
          <span className="text-sm text-muted-foreground">None yet</span>
        ) : null}
        {using.map((project) => (
          <span
            key={project.id}
            className="inline-flex h-6.5 items-center gap-1.5 rounded-md bg-muted ps-1 pe-2 text-sm"
          >
            <ProjectMark
              name={project.name}
              colorKey={projectScopeKey({ workspace, projectId: project.id })}
              className="size-4"
            />
            {project.name}
            {project.mayChange ? (
              <Button
                size="icon-micro"
                variant="ghost-muted"
                aria-label={`Take ${value.name || id} out of ${project.name}`}
                onClick={() => onUse(project, false)}
              >
                <XIcon aria-hidden />
              </Button>
            ) : null}
          </span>
        ))}
        {addable.length === 0 ? null : (
          <Menu>
            <MenuTrigger render={<Button size="xs" variant="outline" />}>
              <PlusIcon aria-hidden />
              Add
            </MenuTrigger>
            <MenuPopup align="start" className="max-h-64">
              {addable.map((project) => (
                <MenuItem key={project.id} onClick={() => onUse(project, true)}>
                  {project.name}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        )}
      </div>

      {footer}
    </>
  );
}

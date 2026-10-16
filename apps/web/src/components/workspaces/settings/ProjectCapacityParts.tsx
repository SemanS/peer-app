/**
 * The parts of a project's Capacity page (design artboard 10): the budget card and its editor, the
 * allocation table with its total, and the rule for personal AI plans. They draw what
 * `projectCapacity.logic` works out and hand every edit back to the page, which writes it to the
 * draft.
 */
import { useId, useState } from "react";

import { cn } from "../../../lib/utils";
import { Alert, AlertDescription } from "../../ui/alert";
import { Button, InlineButton } from "../../ui/button";
import { Input } from "../../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../ui/input-group";
import { Label } from "../../ui/label";
import { Radio, RadioGroup } from "../../ui/radio-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/table";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { PersonMark } from "../marks";
import { PeerCard } from "../PeerPageHeader";
import { NotSaved } from "./CapacityCoordinationParts";
import {
  PERIODS,
  PERIOD_LABELS,
  checkBudgetForm,
  isPeriod,
  isPersonalRule,
  overBudgetText,
  parseAmount,
  poolLabel,
  type AllocationRow,
  type AllocationSummary,
  type AllocationTable as AllocationTableModel,
  type BudgetCheck,
  type BudgetForm,
  type PersonalRule,
  type PlanOption,
  type Period,
  type PoolOption,
} from "./projectCapacity.logic";
import { currencySymbol, formatMoney } from "./shared.logic";

/** The shared budget: what it is, what was used of it, the models it allows, and Edit for admins. */
export function BudgetCard({
  amount,
  per,
  used,
  pool,
  models,
  changed,
  onEdit,
}: {
  /** `€600`. */
  readonly amount: string;
  /** `per month`. */
  readonly per: string;
  /** `€315 used this month`; null while the gateway has not said. */
  readonly used: string | null;
  /** The pool's name. */
  readonly pool: string;
  readonly models: ReadonlyArray<string>;
  readonly changed: boolean;
  /** Without it (the person does not set budgets) the card has no Edit. */
  readonly onEdit: (() => void) | undefined;
}) {
  return (
    <PeerCard className="flex-row flex-wrap items-center gap-x-5 gap-y-3">
      <div className="flex flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-semibold tracking-tight">
          <span>
            {amount} <span className="text-sm font-normal text-muted-foreground">{per}</span>
          </span>
          {changed ? <NotSaved /> : null}
        </span>
        {used === null ? null : <span className="text-xs text-muted-foreground">{used}</span>}
      </div>
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        <span className="text-xs text-muted-foreground">Models · {pool} pool</span>
        <div className="flex flex-wrap gap-1.5">
          {models.map((model) => (
            <span
              key={model}
              className="inline-flex h-6 items-center rounded-md bg-muted px-2 font-mono text-xs"
            >
              {model}
            </span>
          ))}
        </div>
      </div>
      {onEdit === undefined ? null : (
        <Button size="sm" variant="outline" onClick={onEdit}>
          Edit
        </Button>
      )}
    </PeerCard>
  );
}

/**
 * What a project without shared capacity shows in place of the budget: that agents run on people's
 * own plans, and for an admin the way to give it a budget, or where to set up the gateway that
 * would make one possible.
 */
export function NoSharedBudget({
  project,
  workspace,
  gateway,
  removed,
  action,
}: {
  readonly project: string;
  readonly workspace: string;
  /** Whether the workspace has a gateway; undefined where that is not known (no settings). */
  readonly gateway: boolean | undefined;
  /** The draft took the budget away, and no review has saved that yet. */
  readonly removed: boolean;
  /** What an admin may do about it; undefined for everyone else. */
  readonly action: { readonly give: () => void; readonly setUp: () => void } | undefined;
}) {
  return (
    <PeerCard className="flex-row flex-wrap items-center gap-x-5 gap-y-3">
      {removed ? <NotSaved /> : null}
      <p className="min-w-48 flex-1 text-sm text-muted-foreground">
        {gateway === false
          ? `Shared capacity is off in ${workspace}: no gateway is set up yet.`
          : gateway === true
            ? `Agents in ${project} use people’s own AI plans.`
            : `${project} has no shared budget.`}
        {action === undefined && gateway !== undefined
          ? gateway
            ? " Admins can give it a shared budget."
            : " Admins can set it up."
          : null}
      </p>
      {action === undefined || gateway === undefined ? null : gateway ? (
        <Button size="sm" variant="outline" onClick={action.give}>
          Give {project} a shared budget
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={action.setUp}>
          Set it up in Shared capacity
        </Button>
      )}
    </PeerCard>
  );
}

/**
 * Edits the budget in place: the amount, the period, the pool. Done writes into the draft (nothing
 * is saved until the review), Cancel leaves it as it was. A project with a budget may also lose it.
 */
export function BudgetEditor({
  currency,
  initial,
  pools,
  creating,
  removeReason,
  onDone,
  onCancel,
  onRemove,
  onOpenPools,
}: {
  readonly currency: string;
  readonly initial: BudgetForm;
  readonly pools: ReadonlyArray<PoolOption>;
  /** The project has no budget yet: this gives it one. */
  readonly creating: boolean;
  /** Why the budget cannot be taken away; null while it can. */
  readonly removeReason: string | null;
  readonly onDone: (budget: Extract<BudgetCheck, { ok: true }>) => void;
  readonly onCancel: () => void;
  readonly onRemove: () => void;
  /** Where pools are made, when there are none. */
  readonly onOpenPools: () => void;
}) {
  const [form, setForm] = useState(initial);
  const amountId = useId();
  const poolId = useId();
  const check = checkBudgetForm(form, pools);
  const pool = pools.find((candidate) => candidate.id === form.pool);
  const amountInvalid = form.amount.trim() !== "" && !parseAmount(form.amount).ok;
  return (
    <PeerCard>
      <form
        className="flex flex-col gap-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (check.ok) onDone(check);
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={amountId}>Amount ({currency})</Label>
            <Input
              id={amountId}
              className="w-36"
              inputMode="decimal"
              autoComplete="off"
              value={form.amount}
              aria-invalid={amountInvalid || undefined}
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
            />
          </div>
          <ToggleGroup
            aria-label="Period"
            value={[form.period]}
            onValueChange={(next) => {
              const period = next[0];
              // Pressing the chosen one again would clear it; a budget always has a period.
              if (isPeriod(period)) setForm({ ...form, period });
            }}
          >
            {PERIODS.map((period) => (
              <Toggle key={period} value={period}>
                {PERIOD_LABELS[period]}
              </Toggle>
            ))}
          </ToggleGroup>
          <div className="flex flex-col gap-1.5">
            <span id={poolId} className="text-sm font-medium">
              Model pool
            </span>
            <Select
              value={form.pool}
              disabled={pools.length === 0}
              onValueChange={(value) => {
                if (value !== null) setForm({ ...form, pool: value });
              }}
            >
              <SelectTrigger aria-labelledby={poolId} className="w-56">
                <SelectValue>{pool === undefined ? "No pools" : poolLabel(pool)}</SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {pools.map((candidate) => (
                  <SelectItem key={candidate.id} hideIndicator value={candidate.id}>
                    {poolLabel(candidate)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        </div>
        {pools.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            The workspace has no model pools yet.{" "}
            <InlineButton tone="muted" onClick={onOpenPools}>
              Open Shared capacity
            </InlineButton>
          </p>
        ) : null}
        {!check.ok && check.problem !== null ? (
          <p role="alert" className="text-xs text-destructive-foreground">
            {check.problem}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={!check.ok}>
            Done
          </Button>
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          {creating ? null : (
            <Button
              className="ms-auto"
              size="sm"
              variant="destructive-outline"
              disabled={removeReason !== null}
              onClick={onRemove}
            >
              Remove shared budget
            </Button>
          )}
        </div>
        {creating || removeReason === null ? null : (
          <p className="text-xs text-muted-foreground">{removeReason}</p>
        )}
      </form>
    </PeerCard>
  );
}

/**
 * A field for an amount of money. What is typed stays as typed while the field has focus, and only a
 * valid amount reaches the draft; leaving the field shows the draft's value again.
 */
function AmountInput({
  label,
  symbol,
  value,
  placeholder,
  disabled,
  allowEmpty,
  onValue,
}: {
  readonly label: string;
  readonly symbol: string;
  readonly value: number | undefined;
  readonly placeholder?: string | undefined;
  readonly disabled: boolean;
  /** An empty field is a value too (no cap), and not a mistake. */
  readonly allowEmpty: boolean;
  readonly onValue: (value: number | undefined) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? (value === undefined ? "" : String(value));
  const invalid = typed !== null && !parseAmount(typed).ok && !(allowEmpty && typed.trim() === "");
  return (
    <InputGroup className="w-28">
      <InputGroupAddon>
        <span className="text-muted-foreground">{symbol}</span>
      </InputGroupAddon>
      <InputGroupInput
        aria-label={label}
        aria-invalid={invalid || undefined}
        inputMode="decimal"
        autoComplete="off"
        size="sm"
        value={shown}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          setTyped(next);
          const read = parseAmount(next);
          if (read.ok) onValue(read.value);
          else if (allowEmpty && next.trim() === "") onValue(undefined);
        }}
        onBlur={() => setTyped(null)}
      />
    </InputGroup>
  );
}

function UsedBar({ row, currency }: { readonly row: AllocationRow; readonly currency: string }) {
  if (row.used === undefined) return <span className="text-muted-foreground">—</span>;
  const bar = row.bar;
  return (
    <div className="flex items-center gap-2">
      <div
        role="img"
        aria-label={
          row.value === undefined ? "No allocation to use up" : `${bar?.percent ?? 0}% used`
        }
        className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", bar?.warn === true ? "bg-warning" : "bg-info")}
          style={{ width: `${bar?.percent ?? 0}%` }}
        />
      </div>
      <span className="w-16 text-right text-muted-foreground tabular-nums">
        {formatMoney(row.used, currency)}
      </span>
    </div>
  );
}

/**
 * Who may spend how much of the budget: a row for each member, then the default for everyone else.
 * A custom allocation is a field, one that follows the project default a plain value. Without
 * settings (`source` null) only the gateway's figures are known, so they are shown and nothing can
 * be edited.
 */
export function AllocationsTable({
  rows,
  everyone,
  currency,
  period,
  canEdit,
  me,
  changed,
  everyoneChanged,
  onValue,
  onMakeCustom,
  onUseDefault,
  onEveryone,
}: {
  readonly rows: ReadonlyArray<AllocationRow>;
  /** The "Everyone else" row; undefined without settings. */
  readonly everyone: AllocationTableModel["everyone"] | undefined;
  readonly currency: string;
  readonly period: Period;
  readonly canEdit: boolean;
  /** The signed-in address, whose mark is the person's own. */
  readonly me: string | null;
  /** Lower-case addresses whose allocation the draft changed. */
  readonly changed: ReadonlySet<string>;
  readonly everyoneChanged: boolean;
  readonly onValue: (row: AllocationRow, value: number) => void;
  readonly onMakeCustom: (row: AllocationRow) => void;
  readonly onUseDefault: (row: AllocationRow) => void;
  readonly onEveryone: (value: number | undefined) => void;
}) {
  const symbol = currencySymbol(currency);
  const showSource = everyone !== undefined;
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table className="min-w-160 table-fixed" aria-label="Allocations">
        <colgroup>
          <col />
          <col className="w-32" />
          {showSource ? <col className="w-36" /> : null}
          <col className="w-56" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead>Per {period}</TableHead>
            {showSource ? <TableHead>Source</TableHead> : null}
            <TableHead>Used</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.email}>
              <TableCell className="whitespace-normal">
                <span className="flex min-w-0 items-center gap-2.5">
                  <PersonMark
                    name={row.name}
                    mine={me !== null && me.toLowerCase() === row.email.toLowerCase()}
                  />
                  <span className="min-w-0 truncate text-sm font-medium">{row.name}</span>
                </span>
              </TableCell>
              <TableCell>
                {row.source === "custom" && row.value !== undefined ? (
                  <AmountInput
                    label={`Allocation for ${row.name}`}
                    symbol={symbol}
                    value={row.value}
                    disabled={!canEdit}
                    allowEmpty={false}
                    onValue={(value) => value !== undefined && onValue(row, value)}
                  />
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {row.value === undefined ? "no cap" : formatMoney(row.value, currency)}
                  </span>
                )}
              </TableCell>
              {showSource ? (
                <TableCell className="whitespace-normal">
                  <span className="flex flex-col items-start gap-0.5">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      {row.source}
                      {changed.has(row.email.toLowerCase()) ? <NotSaved /> : null}
                    </span>
                    {canEdit ? (
                      row.source === "custom" ? (
                        <InlineButton
                          tone="muted"
                          aria-label={`Use the project default for ${row.name}`}
                          onClick={() => onUseDefault(row)}
                        >
                          Use default
                        </InlineButton>
                      ) : (
                        <InlineButton
                          tone="muted"
                          aria-label={`Give ${row.name} an allocation of their own`}
                          onClick={() => onMakeCustom(row)}
                        >
                          Set custom
                        </InlineButton>
                      )
                    ) : null}
                  </span>
                </TableCell>
              ) : null}
              <TableCell>
                <UsedBar row={row} currency={currency} />
              </TableCell>
            </TableRow>
          ))}
          {everyone === undefined ? null : (
            <TableRow>
              <TableCell className="whitespace-normal">
                <span className="flex min-w-0 items-center gap-2.5">
                  <PersonMark name="*" mine={false} />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium">Everyone else</span>
                    <span className="text-muted-foreground">Applies to {everyone.appliesTo}</span>
                  </span>
                </span>
              </TableCell>
              <TableCell>
                <AmountInput
                  label="Default allocation"
                  symbol={symbol}
                  value={everyone.value}
                  placeholder="no cap"
                  disabled={!canEdit}
                  allowEmpty
                  onValue={onEveryone}
                />
              </TableCell>
              <TableCell className="whitespace-normal">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  project default
                  {everyoneChanged ? <NotSaved /> : null}
                </span>
              </TableCell>
              <TableCell />
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** "Allocated €630 of €600", its bar, and the warning once the allocations pass the budget. */
export function AllocationTotal({
  summary,
  currency,
  period,
  project,
}: {
  readonly summary: AllocationSummary;
  readonly currency: string;
  readonly period: Period;
  readonly project: string;
}) {
  const over = summary.over > 0;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-0.5">
        <span className="text-sm font-medium">
          Allocated {formatMoney(summary.allocated, currency)} of{" "}
          {formatMoney(summary.budget, currency)}
        </span>
        <div
          role="img"
          aria-label={`${summary.percent}% of the budget allocated`}
          className="h-1.5 min-w-40 flex-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn("h-full rounded-full", over ? "bg-warning" : "bg-info")}
            style={{ width: `${summary.percent}%` }}
          />
        </div>
      </div>
      {over ? (
        <Alert variant="warning" role="status">
          <AlertDescription>
            {overBudgetText({
              over: summary.over,
              budget: summary.budget,
              period,
              currency,
              project,
            })}
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

/**
 * The rule for personal AI plans in the project, as three rows to pick from. A row that cannot be
 * picked says why, and the whole list is disabled for whoever does not set the rule.
 */
export function PersonalPlans({
  project,
  options,
  value,
  disabled,
  changed,
  note,
  onChange,
}: {
  readonly project: string;
  readonly options: ReadonlyArray<PlanOption>;
  readonly value: PersonalRule;
  readonly disabled: boolean;
  readonly changed: boolean;
  /** What the rule means for the people the document shows; null for nothing. */
  readonly note: string | null;
  readonly onChange: (value: PersonalRule) => void;
}) {
  const idBase = useId();
  return (
    <>
      <RadioGroup
        aria-label={`Personal AI plans in ${project}`}
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (isPersonalRule(next)) onChange(next);
        }}
      >
        <div className="overflow-hidden rounded-xl border bg-card">
          {options.map((option) => {
            const off = disabled || option.reason !== null;
            return (
              <label
                key={option.value}
                className={cn(
                  "flex items-start gap-3 border-b px-3.5 py-3 last:border-b-0",
                  off ? "cursor-not-allowed" : "cursor-pointer",
                )}
              >
                <Radio
                  className="mt-0.5"
                  value={option.value}
                  disabled={option.reason !== null}
                  aria-labelledby={`${idBase}-${option.value}-title`}
                  aria-describedby={`${idBase}-${option.value}-description`}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span
                    id={`${idBase}-${option.value}-title`}
                    className="flex flex-wrap items-center gap-2 text-sm font-medium"
                  >
                    {option.title}
                    {changed && value === option.value ? <NotSaved /> : null}
                  </span>
                  <span
                    id={`${idBase}-${option.value}-description`}
                    className="text-xs text-muted-foreground"
                  >
                    {option.description}
                    {option.reason === null ? null : <> {option.reason}</>}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </RadioGroup>
      {note === null ? null : <p className="text-sm text-muted-foreground">{note}</p>}
    </>
  );
}

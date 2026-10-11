/**
 * The parts of a project's Coordination page (design artboard 11): the policy list, the path rules
 * with the row that adds one, and the panel that says which rule decides for a path. They draw what
 * `projectCoordination.logic` works out and hand every edit back to the page, which writes it to the
 * draft.
 */
import type { PathRule } from "@t3tools/client-runtime/peer-settings";
import { XIcon } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "../../../lib/utils";
import { Alert, AlertAction, AlertDescription } from "../../ui/alert";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Radio, RadioGroup } from "../../ui/radio-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { DecisionChip } from "../DecisionChip";
import { NotSaved } from "./CapacityCoordinationParts";
import {
  POLICY_CHOICES,
  RULE_POLICIES,
  canAddRule,
  checkPattern,
  choiceReason,
  deciding,
  decidingChip,
  isPolicy,
  isPolicyChoice,
  type CoordinationSettings,
  type Policy,
  type PolicyChoice,
} from "./projectCoordination.logic";

/** The notice for a Hub that keeps path rules but does not apply them. */
export function PathRulesOff({
  project,
  onOpenHub,
}: {
  readonly project: string;
  readonly onOpenHub: () => void;
}) {
  return (
    <Alert variant="warning" role="status">
      <AlertDescription>
        Path rules are turned off on this Hub. They’re saved, but agents get {project}’s policy for
        every path until the Hub operator turns them back on.
      </AlertDescription>
      <AlertAction>
        <Button size="xs" variant="outline" onClick={onOpenHub}>
          Hub details
        </Button>
      </AlertAction>
    </Alert>
  );
}

/**
 * The project's policy as a list to pick from. A row that cannot be picked says why, and the whole
 * list is disabled for whoever does not set the policy. `value` is null for a policy this app does
 * not know, which no row shows as chosen.
 */
export function PolicyList({
  project,
  value,
  disabled,
  ruleCount,
  changed,
  onChange,
}: {
  readonly project: string;
  readonly value: PolicyChoice | null;
  readonly disabled: boolean;
  readonly ruleCount: number;
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
        {POLICY_CHOICES.map((choice) => {
          const reason = choiceReason(choice.value, ruleCount, project);
          return (
            <label
              key={choice.value}
              className={cn(
                "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 border-b px-3.5 py-2.5 last:border-b-0 sm:grid-cols-[auto_9.5rem_minmax(0,1fr)]",
                disabled || reason !== null ? "cursor-not-allowed" : "cursor-pointer",
              )}
            >
              <Radio
                value={choice.value}
                disabled={reason !== null}
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
                {reason === null ? null : <> {reason}</>}
              </span>
            </label>
          );
        })}
      </div>
    </RadioGroup>
  );
}

/** A rule's policy, chosen from the four. */
function PolicySelect({
  label,
  value,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (policy: Policy) => void;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (isPolicy(next)) onChange(next);
      }}
    >
      <SelectTrigger size="sm" aria-label={label}>
        <SelectValue>{value}</SelectValue>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        {RULE_POLICIES.map((policy) => (
          <SelectItem key={policy} hideIndicator value={policy}>
            {policy}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/** A rule's row: its pattern, its policy, Remove; on a narrow screen the policy goes under the pattern. */
const RULE_ROW =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b py-2 ps-3.5 pe-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_10rem_auto]";

/**
 * The row that adds a rule: a pattern, its policy, Add. What is typed is checked as it is typed, and
 * what the Hub would refuse stops Add; a project without a policy cannot have rules yet.
 */
function AddRule({
  existing,
  disabledReason,
  onAdd,
}: {
  readonly existing: ReadonlyArray<string>;
  /** Why no rule can be added now; null while one can. */
  readonly disabledReason: string | null;
  readonly onAdd: (pattern: string, policy: Policy) => void;
}) {
  const [pattern, setPattern] = useState("");
  const [policy, setPolicy] = useState<Policy>("exclusive");
  const check = checkPattern(pattern, policy, existing);
  const allowed = disabledReason === null && canAddRule(check, pattern);
  const add = () => {
    if (!allowed) return;
    onAdd(pattern.trim(), policy);
    setPattern("");
  };
  const message = disabledReason ?? check?.message ?? null;
  return (
    <div className="flex flex-col gap-1.5 border-b py-2.5 ps-3.5 pe-2.5 last:border-b-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
        <Input
          className="col-span-2 sm:col-span-1"
          font="mono"
          size="sm"
          aria-label="New path rule"
          placeholder="e.g. infra/terraform/**"
          autoComplete="off"
          spellCheck={false}
          value={pattern}
          disabled={disabledReason !== null}
          aria-invalid={check?.kind === "error" || undefined}
          onChange={(event) => setPattern(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            add();
          }}
        />
        <PolicySelect
          label="Policy for the new rule"
          value={policy}
          disabled={disabledReason !== null}
          onChange={setPolicy}
        />
        <Button size="sm" variant="outline" disabled={!allowed} onClick={add}>
          Add
        </Button>
      </div>
      {message === null ? null : (
        <p
          className={cn(
            "text-xs",
            disabledReason === null ? "text-warning-foreground" : "text-muted-foreground",
          )}
        >
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * The project's path rules, most specific first, each with its policy and a way to remove it, and
 * for whoever may add one the row that does.
 */
export function PathRules({
  rules,
  canEdit,
  changed,
  addDisabledReason,
  onPolicy,
  onRemove,
  onAdd,
}: {
  readonly rules: ReadonlyArray<PathRule>;
  readonly canEdit: boolean;
  /** Patterns whose rule the draft changed. */
  readonly changed: ReadonlySet<string>;
  /** Why no rule can be added; null while one can. */
  readonly addDisabledReason: string | null;
  readonly onPolicy: (pattern: string, policy: Policy) => void;
  readonly onRemove: (pattern: string) => void;
  readonly onAdd: (pattern: string, policy: Policy) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {rules.map((rule) => (
        <div key={rule.pattern} className={RULE_ROW}>
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <code className="font-mono text-sm break-all">{rule.pattern}</code>
            {changed.has(rule.pattern) ? <NotSaved /> : null}
          </span>
          <div className="order-3 col-span-2 sm:order-none sm:col-span-1">
            <PolicySelect
              label={`Policy for ${rule.pattern}`}
              value={rule.policy}
              disabled={!canEdit}
              onChange={(policy) => onPolicy(rule.pattern, policy)}
            />
          </div>
          <Button
            className="order-2 sm:order-none"
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`Remove ${rule.pattern}`}
            disabled={!canEdit}
            onClick={() => onRemove(rule.pattern)}
          >
            <XIcon aria-hidden />
          </Button>
        </div>
      ))}
      {canEdit ? (
        <AddRule
          existing={rules.map((rule) => rule.pattern)}
          disabledReason={addDisabledReason}
          onAdd={onAdd}
        />
      ) : null}
    </div>
  );
}

/**
 * Which rule decides for a path: a path is typed, and the answer is the rule that matches it, else
 * the project's policy, else each person's own default. It reads the draft, so a rule just added
 * already counts.
 */
export function DecidePanel({
  settings,
  project,
  rulesApply,
}: {
  readonly settings: CoordinationSettings;
  readonly project: string;
  readonly rulesApply: boolean;
}) {
  const [path, setPath] = useState("");
  const decision = deciding({ path, settings, rulesApply });
  const chip = decision === null ? null : decidingChip(decision, project);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        className="max-w-sm min-w-64 flex-1"
        font="mono"
        aria-label="Path to test"
        placeholder="e.g. payments/webhooks.ts"
        autoComplete="off"
        spellCheck={false}
        value={path}
        onChange={(event) => setPath(event.target.value)}
      />
      <span aria-live="polite" className="flex min-w-0 items-center">
        {chip === null ? (
          <span className="text-sm text-muted-foreground">
            {path.trim() === ""
              ? "Type a path to see which rule decides."
              : "That is not a path in the repository."}
          </span>
        ) : chip.policy === null ? (
          <Badge variant="outline" size="control">
            {chip.source}
          </Badge>
        ) : (
          <DecisionChip
            chip={{ policy: chip.policy, source: chip.source, warn: chip.warn, by: "project" }}
          />
        )}
      </span>
    </div>
  );
}

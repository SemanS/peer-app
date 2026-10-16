/**
 * The parts of the Shared capacity page (design artboard 16): the sync banner, the gateway's
 * address and currency, the master key and its dialog, the connection test, and the model pools as
 * a table of the gateway's models against the pools that hold them. They draw what
 * `sharedCapacity.logic` works out and hand every edit back to the page, which writes it to the
 * draft; the key is the one thing that never is: it is a secret, sent as it is typed and kept nowhere.
 */
import { useId, useState, type ReactNode } from "react";

import { cn } from "../../../lib/utils";
import { Alert, AlertAction, AlertDescription } from "../../ui/alert";
import { Button, InlineButton } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "../../ui/dialog";
import { Input } from "../../ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/table";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { PeerDialogBody, PeerDialogFooter, PeerStackedField } from "../PeerDialog";
import { NotSaved } from "./CapacityCoordinationParts";
import {
  CURRENCIES,
  adminUrlProblem,
  checkNewPool,
  gatewayUrlProblem,
  harnessText,
  isCurrency,
  keyValue,
  parseRate,
  poolIdFromName,
  syncConsequence,
  type Currency,
  type GatewaySettings,
  type ModelRow,
  type Pool,
  type SyncState,
  type TestOutcome,
} from "./sharedCapacity.logic";

const problemClass = "text-xs text-destructive-foreground";

/**
 * What a text field shows while the person types in it: what they typed, even where the draft does
 * not take it (an address that is not one). Leaving the field shows the draft's value again.
 */
function useTyped(committed: string) {
  const [typed, setTyped] = useState<string | null>(null);
  return { shown: typed ?? committed, typed, type: setTyped, leave: () => setTyped(null) };
}

const Optional = () => <span className="font-normal text-muted-foreground">optional</span>;

/**
 * Where the last reconciliation with the gateway stands. A failure is the one thing the page says
 * loudly: settings are saved either way, but the limits the gateway enforces are from the last time
 * it worked. Sync now tries again.
 */
export function SyncBanner({
  state,
  busy,
  error,
  onSync,
}: {
  readonly state: SyncState;
  readonly busy: boolean;
  /** Why asking for a sync failed (not why the gateway refused one). */
  readonly error: string | null;
  readonly onSync: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {state.kind === "failed" ? (
        <Alert variant="warning">
          <AlertDescription>
            <span>
              <span className="font-semibold">Last sync failed {state.when}:</span> {state.error}.{" "}
              {syncConsequence(state.lastOk)}
            </span>
          </AlertDescription>
          <AlertAction>
            <Button size="xs" variant="warning-outline" disabled={busy} onClick={onSync}>
              {busy ? "Syncing…" : "Sync now"}
            </Button>
          </AlertAction>
        </Alert>
      ) : (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              state.kind === "ok" ? "bg-success" : "bg-muted-foreground/60",
            )}
          />
          {state.kind === "ok"
            ? `On · synced ${state.ago}`
            : "Not synced yet. The gateway gets the settings at the next sync."}
          <InlineButton tone="muted" disabled={busy} onClick={onSync}>
            {busy ? "Syncing…" : "Sync now"}
          </InlineButton>
        </p>
      )}
      {error === null ? null : (
        <p role="alert" className={problemClass}>
          Could not sync: {error}
        </p>
      )}
    </div>
  );
}

/**
 * The gateway's address and its admin address, the currency, and what a dollar is worth in it. Each
 * value goes into the draft as soon as it can be one; one that cannot says why and is not taken. The
 * rest of the gateway waits for an address, which is what makes it one; in dollars the rate is 1.
 */
export function GatewayFields({
  gateway,
  currency,
  editable,
  onUrl,
  onAdminUrl,
  onRate,
  onCurrency,
}: {
  readonly gateway: GatewaySettings | undefined;
  readonly currency: Currency;
  readonly editable: boolean;
  readonly onUrl: (url: string) => void;
  readonly onAdminUrl: (url: string) => void;
  readonly onRate: (rate: number) => void;
  readonly onCurrency: (currency: Currency) => void;
}) {
  const ids = [useId(), useId(), useId()] as const;
  const url = useTyped(gateway?.url ?? "");
  const admin = useTyped(gateway?.adminUrl ?? "");
  const rate = useTyped(gateway === undefined ? "" : String(gateway.usdPerUnit));
  // What is saved was good enough for the Hub: only what is being typed can be wrong.
  const urlProblem =
    url.typed === null || (url.typed.trim() === "" && gateway === undefined)
      ? null
      : gatewayUrlProblem(url.typed);
  const adminProblem = admin.typed === null ? null : adminUrlProblem(admin.typed);
  const rateProblem = (() => {
    if (rate.typed === null) return null;
    const read = parseRate(rate.typed);
    return read.ok ? null : read.problem;
  })();
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PeerStackedField label="LiteLLM address" htmlFor={ids[0]}>
          <Input
            id={ids[0]}
            font="mono"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://llm.acme.dev"
            value={url.shown}
            disabled={!editable}
            aria-invalid={urlProblem !== null || undefined}
            onChange={(event) => {
              const text = event.target.value;
              url.type(text);
              if (gatewayUrlProblem(text) === null) onUrl(text);
            }}
            onBlur={url.leave}
          />
        </PeerStackedField>
        <PeerStackedField
          label={
            <>
              Admin address <Optional />
            </>
          }
          htmlFor={ids[1]}
        >
          <Input
            id={ids[1]}
            font="mono"
            autoComplete="off"
            spellCheck={false}
            placeholder="Same as above"
            value={admin.shown}
            disabled={!editable || gateway === undefined}
            aria-invalid={adminProblem !== null || undefined}
            onChange={(event) => {
              const text = event.target.value;
              admin.type(text);
              if (adminUrlProblem(text) === null) onAdminUrl(text);
            }}
            onBlur={admin.leave}
          />
        </PeerStackedField>
      </div>
      {[urlProblem, adminProblem].map((problem) =>
        problem === null ? null : (
          <p key={problem} role="alert" className={problemClass}>
            {problem}
          </p>
        ),
      )}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex flex-col gap-1.5">
          <span id={ids[2]} className="text-sm font-medium">
            Currency
          </span>
          <ToggleGroup
            aria-labelledby={ids[2]}
            value={[currency]}
            disabled={!editable}
            onValueChange={(next) => {
              const chosen = next[0];
              // Pressing the chosen one again would clear it; a workspace always has a currency.
              if (isCurrency(chosen)) onCurrency(chosen);
            }}
          >
            {CURRENCIES.map((option) => (
              <Toggle key={option} value={option}>
                {option}
              </Toggle>
            ))}
          </ToggleGroup>
        </div>
        {currency === "USD" ? (
          <p className="flex h-8 items-center text-sm text-muted-foreground">
            1 USD = 1 USD on the gateway
          </p>
        ) : (
          <label className="flex h-8 items-center gap-2 text-sm text-muted-foreground">
            1 {currency} =
            <Input
              className="w-24"
              inputMode="decimal"
              autoComplete="off"
              aria-label={`US dollars per ${currency === "EUR" ? "euro" : currency}`}
              value={rate.shown}
              disabled={!editable || gateway === undefined}
              aria-invalid={(rateProblem !== null && gateway !== undefined) || undefined}
              onChange={(event) => {
                const text = event.target.value;
                rate.type(text);
                const read = parseRate(text);
                if (read.ok) onRate(read.value);
              }}
              onBlur={rate.leave}
            />
            USD on the gateway
          </label>
        )}
      </div>
      {gateway !== undefined && currency !== "USD" && rateProblem !== null ? (
        <p role="alert" className={problemClass}>
          {rateProblem}
        </p>
      ) : null}
    </div>
  );
}

/** The master key: that it is stored and by whom, never the key. Replace… (or Set the key) opens the dialog. */
export function MasterKeyCard({
  text,
  stored,
  loading,
  canEdit,
  onReplace,
}: {
  readonly text: string;
  readonly stored: boolean;
  readonly loading: boolean;
  readonly canEdit: boolean;
  readonly onReplace: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-3.5 py-3">
      <div className="flex min-w-60 flex-1 flex-col">
        <span className="text-sm font-medium">Master key</span>
        <span className="text-xs text-muted-foreground">{loading ? "Reading…" : text}</span>
      </div>
      {canEdit ? (
        <Button size="sm" variant="outline" disabled={loading} onClick={onReplace}>
          {stored ? "Replace…" : "Set the key"}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Asks for the key as a password and sends it to be stored. The key is only in the field while the
 * dialog is open; nothing here shows it or keeps it, and the Hub never says it again.
 */
export function MasterKeyDialog({
  replacing,
  secret,
  onStore,
  onClose,
}: {
  readonly replacing: boolean;
  /** The name the Hub keeps the key under. */
  readonly secret: string;
  /** Stores the key; resolves with why it could not, or null once it did. */
  readonly onStore: (key: string) => Promise<string | null>;
  readonly onClose: () => void;
}) {
  const formId = useId();
  const fieldId = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = keyValue(typed);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <div className="flex min-w-0 flex-col gap-1.5 pe-6">
            <DialogTitle>{replacing ? "Replace the master key" : "Set the master key"}</DialogTitle>
            <DialogDescription>
              The gateway’s admin key. The Hub uses it to make keys for people and set their limits.
            </DialogDescription>
          </div>
        </DialogHeader>
        <PeerDialogBody>
          <form
            id={formId}
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (key === null || busy) return;
              setBusy(true);
              setError(null);
              void onStore(key)
                .then((problem) => {
                  if (problem === null) onClose();
                  else setError(problem);
                })
                .finally(() => setBusy(false));
            }}
          >
            <PeerStackedField
              label="Master key"
              htmlFor={fieldId}
              hint={
                <>
                  Stored on the Hub as <code className="font-mono">{secret}</code> and never shown
                  again. Replacing it keeps the old one until this is stored.
                </>
              }
            >
              <Input
                id={fieldId}
                type="password"
                font="mono"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={typed}
                disabled={busy}
                onChange={(event) => setTyped(event.target.value)}
              />
            </PeerStackedField>
            {key === null && typed.trim() !== "" ? (
              <p role="alert" className={problemClass}>
                A key is one line of at most 8,192 characters.
              </p>
            ) : null}
            {error === null ? null : (
              <p role="alert" className={problemClass}>
                {error}
              </p>
            )}
          </form>
        </PeerDialogBody>
        <PeerDialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={key === null || busy}>
            {busy ? "Storing…" : "Store key"}
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** Test connection, and what it found; or why it cannot be run yet. */
export function ConnectionTest({
  disabledReason,
  busy,
  outcome,
  onTest,
}: {
  /** Why the test cannot be run now; null while it can. */
  readonly disabledReason: string | null;
  readonly busy: boolean;
  readonly outcome: TestOutcome | null;
  readonly onTest: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button
        size="sm"
        variant="outline"
        disabled={busy || disabledReason !== null}
        onClick={onTest}
      >
        {busy ? "Testing…" : "Test connection"}
      </Button>
      {busy ? null : disabledReason !== null ? (
        <span className="text-xs text-muted-foreground">{disabledReason}</span>
      ) : outcome === null ? null : (
        <p
          role="status"
          className={cn(
            "flex items-center gap-2 text-sm",
            outcome.tone === "ok" ? "text-success-foreground" : "text-destructive-foreground",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              outcome.tone === "ok" ? "bg-success" : "bg-destructive",
            )}
          />
          {outcome.text}
        </p>
      )}
    </div>
  );
}

const HeadLabel = ({ children }: { readonly children: ReactNode }) => (
  <span className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
    {children}
  </span>
);

/**
 * The gateway's models down the side, the workspace's pools across, a checkbox where a pool holds
 * a model. A model only a pool lists, though the last test did not find it on the gateway, says so.
 */
export function PoolsTable({
  rows,
  pools,
  editable,
  isNew,
  onToggle,
}: {
  readonly rows: ReadonlyArray<ModelRow>;
  readonly pools: ReadonlyArray<Pool>;
  readonly editable: boolean;
  /** Whether the draft made the pool and no review has saved it yet. */
  readonly isNew: (pool: Pool) => boolean;
  readonly onToggle: (row: ModelRow, pool: Pool, on: boolean) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card px-3.5 py-3 text-sm text-muted-foreground">
        No models yet. Test the connection to list the models the gateway has.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table className="min-w-xl" aria-label="Model pools">
        <TableHeader>
          <TableRow>
            <TableHead>
              <HeadLabel>On the gateway</HeadLabel>
            </TableHead>
            <TableHead>
              <HeadLabel>Harness</HeadLabel>
            </TableHead>
            {pools.map((pool) => (
              <TableHead key={pool.id}>
                <span className="flex items-center gap-1.5">
                  <HeadLabel>{pool.name}</HeadLabel>
                  {isNew(pool) ? <NotSaved /> : null}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="whitespace-normal">
                <span className="flex flex-col">
                  <span className="font-mono text-sm break-all">{row.id}</span>
                  {row.missing ? (
                    <span className="text-xs text-warning-foreground">Not on the gateway</span>
                  ) : null}
                </span>
              </TableCell>
              <TableCell className="whitespace-normal">
                <span className="text-muted-foreground">{harnessText(row.harness)}</span>
              </TableCell>
              {pools.map((pool) => (
                <TableCell key={pool.id}>
                  <Checkbox
                    aria-label={`${row.id} in ${pool.name}`}
                    checked={row.inPools.has(pool.id)}
                    disabled={!editable}
                    onCheckedChange={(checked) => onToggle(row, pool, checked)}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The name and id of a pool to make. It starts with no models, which the person ticks in the table
 * before saving (the Hub does not take a pool with none).
 */
export function NewPoolDialog({
  taken,
  onCreate,
  onClose,
}: {
  readonly taken: ReadonlySet<string>;
  readonly onCreate: (id: string, name: string) => void;
  readonly onClose: () => void;
}) {
  const formId = useId();
  const nameId = useId();
  const idId = useId();
  const [name, setName] = useState("");
  // The id follows the name until the person writes their own.
  const [typedId, setTypedId] = useState<string | null>(null);
  const id = typedId ?? poolIdFromName(name);
  const check = checkNewPool({ name, id, taken });
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <div className="flex min-w-0 flex-col gap-1.5 pe-6">
            <DialogTitle>New pool</DialogTitle>
            <DialogDescription>
              A pool groups models the gateway already has. A project’s budget uses one pool.
            </DialogDescription>
          </div>
        </DialogHeader>
        <PeerDialogBody>
          <form
            id={formId}
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!check.ok) return;
              onCreate(check.id, check.name);
              onClose();
            }}
          >
            <PeerStackedField label="Name" htmlFor={nameId}>
              <Input
                id={nameId}
                autoFocus
                autoComplete="off"
                placeholder="Standard"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </PeerStackedField>
            <PeerStackedField
              label="ID"
              htmlFor={idId}
              hint="Fixed once saved: projects name their pool by it."
            >
              <Input
                id={idId}
                font="mono"
                autoComplete="off"
                spellCheck={false}
                placeholder="standard"
                value={id}
                aria-invalid={(!check.ok && check.problem !== null) || undefined}
                onChange={(event) => setTypedId(event.target.value)}
              />
            </PeerStackedField>
            {!check.ok && check.problem !== null ? (
              <p role="alert" className={problemClass}>
                {check.problem}
              </p>
            ) : null}
          </form>
        </PeerDialogBody>
        <PeerDialogFooter note="You pick its models in the table, then review the change before it is saved.">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={!check.ok}>
            Add pool
          </Button>
        </PeerDialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

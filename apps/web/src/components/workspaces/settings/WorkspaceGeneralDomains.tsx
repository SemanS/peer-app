/**
 * The workspace's email domains (design artboard 14): the ones it lists with what each is to the
 * Hub, a two-step panel that proves control of a domain with a DNS record, and a field to add one.
 * Owners change domains; everyone else reads them. Every change is the Hub's to refuse, and what it
 * answers is shown as it is: a domain another workspace holds comes back with the record that
 * would take it over.
 */
import type {
  EnvironmentId,
  PeerDomainState,
  PeerHubStatus,
  PeerWorkspaceState,
} from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../../lib/utils";
import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
import { useClientSettings } from "../../../hooks/useSettings";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { formatShortTimestamp } from "../../../timestampFormat";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { failureMessage } from "../WorkspaceAccess";
import { confirmed } from "../workFeedback";
import {
  DOMAIN_LABELS,
  NOT_CHECKED,
  checkNewDomain,
  checkOutcome,
  claimNote,
  claimOutcome,
  domainRows,
  mailDomainOf,
  removeDomainWords,
  withDomain,
  withoutDomain,
  type CheckOutcome,
  type CheckTone,
  type DomainClaim,
  type DomainRow,
} from "./workspaceGeneral.logic";

const isDomainState = (value: string): value is PeerDomainState =>
  value === "verified" || value === "claimed" || value === "listed";

const BADGE = { verified: "success", claimed: "info", listed: "warning" } as const;

const TONE_DOT: Readonly<Record<CheckTone, string>> = {
  idle: "bg-muted-foreground/60",
  ok: "bg-success",
  wait: "bg-warning",
  error: "bg-destructive",
};

const TONE_TEXT: Readonly<Record<CheckTone, string>> = {
  idle: "text-muted-foreground",
  ok: "text-success-foreground",
  wait: "text-warning-foreground",
  error: "text-destructive-foreground",
};

/** What a check said and when it was made, so a check that finds the same again still shows it ran. */
interface Checked {
  readonly outcome: CheckOutcome;
  readonly at: string;
}

/** `TXT  @  value  Copy`: the record to publish, which the Hub gives to owners. */
function RecordLine({ record }: { readonly record: string | undefined }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 1500, target: "TXT record" });
  return (
    <div className="grid grid-cols-[3rem_2rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs">
      <span className="text-muted-foreground">TXT</span>
      <span className="text-muted-foreground">@</span>
      <span className="min-w-0 truncate">{record ?? "…"}</span>
      <Button
        size="xs"
        variant="outline"
        disabled={record === undefined}
        onClick={() => record !== undefined && copyToClipboard(record, undefined)}
      >
        {isCopied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/**
 * The two steps that prove a domain: the record to add at the domain's DNS provider, then a check.
 * A check that finds no record also cancels an earlier verification, which the panel says.
 */
function DnsPanel({
  domain,
  record,
  recordError,
  checked,
  busy,
  onCheck,
}: {
  readonly domain: string;
  readonly record: string | undefined;
  readonly recordError: string | null;
  readonly checked: Checked | undefined;
  readonly busy: boolean;
  readonly onCheck: () => void;
}) {
  const { timestampFormat } = useClientSettings();
  const outcome = checked?.outcome ?? NOT_CHECKED;
  return (
    <div className="mx-3.5 mb-3.5 flex flex-col gap-3 rounded-lg border border-border bg-background/40 p-3.5">
      <p className="text-sm text-foreground">
        1. Add this TXT record at the DNS provider of <span className="font-mono">{domain}</span>
      </p>
      <RecordLine record={record} />
      {recordError === null ? null : (
        <p role="alert" className={cn("text-xs", TONE_TEXT.error)}>
          Could not get the record: {recordError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm text-foreground">2.</span>
        <Button size="sm" disabled={busy} onClick={onCheck}>
          {busy ? "Checking…" : "Check now"}
        </Button>
        <p
          role="status"
          className={cn("flex min-w-48 flex-1 items-start gap-2 text-sm", TONE_TEXT[outcome.tone])}
        >
          <span
            aria-hidden
            className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE_DOT[outcome.tone])}
          />
          <span className="min-w-0">
            {outcome.text}
            {checked === undefined ? null : (
              <span className="text-muted-foreground">
                {" "}
                · checked {formatShortTimestamp(checked.at, timestampFormat)}
              </span>
            )}
          </span>
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        A check that finds no record also cancels an earlier verification.
      </p>
    </div>
  );
}

/** The panel of a domain the workspace lists: the record is the Hub's to give, and is asked for once the panel opens. */
function ListedDomainPanel({
  environmentId,
  status,
  workspace,
  domain,
  checked,
  busy,
  onCheck,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: string;
  readonly domain: string;
  readonly checked: Checked | undefined;
  readonly busy: boolean;
  readonly onCheck: () => void;
}) {
  const record = useEnvironmentQuery(
    status.email === null
      ? null
      : serverEnvironment.peerSettings.domainRecord({
          environmentId,
          person: status.email,
          input: { workspace, domain },
        }),
  );
  return (
    <DnsPanel
      domain={domain}
      record={record.data?.record}
      recordError={record.error}
      checked={checked}
      busy={busy}
      onCheck={onCheck}
    />
  );
}

function DomainName({ domain, note }: { readonly domain: string; readonly note: string }) {
  return (
    <span className="flex min-w-48 flex-1 flex-col">
      <span className="font-mono text-sm font-medium">{domain}</span>
      <span className="text-xs text-muted-foreground">{note}</span>
    </span>
  );
}

function RemoveButton({
  domain,
  disabled,
  onClick,
}: {
  readonly domain: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Button
      size="icon-xs"
      variant="ghost-muted"
      aria-label={`Remove ${domain}`}
      disabled={disabled}
      onClick={onClick}
    >
      <XIcon aria-hidden />
    </Button>
  );
}

/**
 * The workspace's domains. `owner` is whether the person changes them (the Hub's rule: only owners)
 * and `available` whether the settings plugin can be used here at all; without either the rows are
 * read-only.
 */
export function DomainsSection({
  environmentId,
  status,
  workspace,
  owner,
  available,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: PeerHubStatus;
  readonly workspace: PeerWorkspaceState;
  readonly owner: boolean;
  readonly available: boolean;
}) {
  const update = useAtomCommand(serverEnvironment.peerSettings.updateWorkspace, {
    reportFailure: false,
  });
  const verify = useAtomCommand(serverEnvironment.peerSettings.verifyDomain, {
    reportFailure: false,
  });
  const sync = useAtomCommand(serverEnvironment.peerHubSync, { reportFailure: false });
  const [open, setOpen] = useState<string | null>(null);
  // What a check made of a domain stands in for the status until the status changes.
  const [checkedStates, setCheckedStates] = useState<{
    readonly key: string;
    readonly byDomain: Readonly<Record<string, PeerDomainState | undefined>>;
  }>({ key: "", byDomain: {} });
  const [results, setResults] = useState<Readonly<Record<string, Checked>>>({});
  const [claim, setClaim] = useState<DomainClaim | null>(null);
  const [claimChecked, setClaimChecked] = useState<Checked | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const editable = owner && available;
  const claimsKey = JSON.stringify(workspace.domainClaims ?? null);
  const rows = domainRows({
    workspace: workspace.name,
    domains: workspace.allowedDomains,
    claims: workspace.domainClaims,
    checked: checkedStates.key === claimsKey ? checkedStates.byDomain : {},
  });
  const next = checkNewDomain(typed, {
    listed: workspace.allowedDomains,
    mine: mailDomainOf(status.email),
  });
  const refresh = () => void sync({ environmentId, input: {} });
  const now = () => new Date().toISOString();

  /** Asks the Hub for the workspace's domains to be these; what it answers is the caller's to show. */
  const change = (domains: ReadonlyArray<string>) =>
    update({ environmentId, input: { workspace: workspace.slug, allowedDomains: [...domains] } });

  /** Adds a domain. The Hub refuses one another workspace holds, and says what record would take it over. */
  const add = async (domain: string) => {
    setBusy("add");
    setError(null);
    const result = await change(withDomain(workspace.allowedDomains, domain));
    setBusy(null);
    const failure = failureMessage(result);
    if (failure !== null) return setError(failure);
    if (result._tag !== "Success") return;
    if (result.value.kind === "updated") {
      setTyped("");
      setClaim(null);
      return refresh();
    }
    const { kind: _kind, ...refused } = result.value;
    setTyped("");
    setClaim(refused);
    setClaimChecked({ outcome: claimOutcome(refused), at: now() });
  };

  /** Tries to add the refused domain again: the Hub looks for the record, and adds the domain if it is there. */
  const checkClaim = async () => {
    if (claim === null) return;
    setBusy(claim.domain);
    const result = await change(withDomain(workspace.allowedDomains, claim.domain));
    setBusy(null);
    const failure = failureMessage(result);
    if (failure !== null) {
      setClaimChecked({ outcome: { tone: "error", text: failure }, at: now() });
      return;
    }
    if (result._tag !== "Success") return;
    if (result.value.kind === "updated") {
      setClaim(null);
      setClaimChecked(undefined);
      return refresh();
    }
    const { kind: _kind, ...refused } = result.value;
    setClaim(refused);
    setClaimChecked({ outcome: claimOutcome(refused), at: now() });
  };

  const check = async (row: DomainRow) => {
    setBusy(row.domain);
    const result = await verify({
      environmentId,
      input: { workspace: workspace.slug, domain: row.domain },
    });
    setBusy(null);
    const failure = failureMessage(result);
    const checked: Checked | null =
      failure !== null
        ? { outcome: { tone: "error", text: failure }, at: now() }
        : result._tag === "Success"
          ? {
              outcome: checkOutcome(result.value, {
                workspace: workspace.name,
                before: row.state,
              }),
              at: now(),
            }
          : null;
    if (checked === null) return;
    setResults((previous) => ({ ...previous, [row.domain]: checked }));
    if (result._tag === "Success" && isDomainState(result.value.state)) {
      const state = result.value.state;
      setCheckedStates((previous) => ({
        key: claimsKey,
        byDomain: { ...(previous.key === claimsKey ? previous.byDomain : {}), [row.domain]: state },
      }));
      if (state !== row.state) refresh();
    }
  };

  const remove = async (row: DomainRow) => {
    if (!(await confirmed(removeDomainWords(row, workspace.name), true))) return;
    setBusy(row.domain);
    setError(null);
    const result = await change(withoutDomain(workspace.allowedDomains, row.domain));
    setBusy(null);
    const failure = failureMessage(result);
    if (failure !== null) return setError(failure);
    if (open === row.domain) setOpen(null);
    refresh();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
        <ul aria-label="Email domains" className="flex flex-col divide-y divide-border">
          {rows.length === 0 && claim === null ? (
            <li className="px-3.5 py-3 text-sm text-muted-foreground">
              No domain yet. People join {workspace.name} when someone invites them.
            </li>
          ) : null}
          {rows.map((row) => (
            <li key={row.domain} className="flex flex-col">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
                <DomainName domain={row.domain} note={row.note} />
                {row.state === undefined ? null : (
                  <Badge variant={BADGE[row.state]} size="lg">
                    {DOMAIN_LABELS[row.state]}
                  </Badge>
                )}
                {editable && row.canVerify ? (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-expanded={open === row.domain}
                    onClick={() => setOpen(open === row.domain ? null : row.domain)}
                  >
                    Verify with DNS
                  </Button>
                ) : null}
                {editable ? (
                  <RemoveButton
                    domain={row.domain}
                    disabled={busy !== null}
                    onClick={() => void remove(row)}
                  />
                ) : null}
              </div>
              {editable && open === row.domain ? (
                <ListedDomainPanel
                  environmentId={environmentId}
                  status={status}
                  workspace={workspace.slug}
                  domain={row.domain}
                  checked={results[row.domain]}
                  busy={busy === row.domain}
                  onCheck={() => void check(row)}
                />
              ) : null}
            </li>
          ))}
          {claim === null ? null : (
            <li className="flex flex-col">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
                <DomainName domain={claim.domain} note={claimNote(claim)} />
                <Badge variant="warning" size="lg">
                  Not added
                </Badge>
                <RemoveButton
                  domain={claim.domain}
                  disabled={busy !== null}
                  onClick={() => {
                    setClaim(null);
                    setClaimChecked(undefined);
                  }}
                />
              </div>
              <DnsPanel
                domain={claim.domain}
                record={claim.record}
                recordError={null}
                checked={claimChecked}
                busy={busy === claim.domain}
                onCheck={() => void checkClaim()}
              />
            </li>
          )}
        </ul>
        {editable ? (
          <form
            className="flex gap-2 border-t border-border p-2.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (next.ok && busy === null) void add(next.domain);
            }}
          >
            <Input
              className="min-w-0 flex-1"
              aria-label="Add a domain"
              placeholder="Add a domain you have an address at"
              autoComplete="off"
              spellCheck={false}
              value={typed}
              aria-invalid={(!next.ok && next.problem !== null) || undefined}
              disabled={busy === "add"}
              onChange={(event) => {
                setTyped(event.target.value);
                setError(null);
              }}
            />
            <Button type="submit" variant="outline" disabled={!next.ok || busy !== null}>
              {busy === "add" ? "Adding…" : "Add"}
            </Button>
          </form>
        ) : null}
      </div>
      {!next.ok && next.problem !== null ? (
        <p role="alert" className="text-xs text-destructive-foreground">
          {next.problem}
        </p>
      ) : editable ? (
        <p className="text-xs text-muted-foreground">
          Public mail domains like gmail.com can’t be added.
        </p>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      )}
    </div>
  );
}

import { useState } from "react";
import type { PeerAuditEntry, PeerAuditPage } from "@t3tools/contracts";
import { describeAuditEntry } from "@t3tools/client-runtime/peer-audit";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { failureMessage } from "../WorkspaceAccess";
import type { WorkspaceSettingsSlotProps } from "../slots.types";

const GROUPS = [
  { id: "all", title: "All changes", kinds: [] },
  { id: "member", title: "Members", kinds: ["member"] },
  { id: "key", title: "Keys", kinds: ["key"] },
  { id: "config", title: "Configuration", kinds: ["workspace", "config", "secret"] },
  { id: "work", title: "Projects and tasks", kinds: ["project", "task"] },
];

/** Opens on demand and reads only on opening, Refresh, filtering or Load older. */
export function AuditLog({ environmentId, workspace }: WorkspaceSettingsSlotProps) {
  const list = useAtomCommand(serverEnvironment.peerAuditList, { reportFailure: false });
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<PeerAuditPage | null>(null);
  const [entries, setEntries] = useState<ReadonlyArray<PeerAuditEntry>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState("all");
  const [member, setMember] = useState("");
  const load = async (before?: number) => {
    setBusy(true);
    setError(null);
    if (before === undefined) {
      setPage(null);
      setEntries([]);
    }
    try {
      const result = await list({
        environmentId,
        input: {
          workspace: workspace.slug,
          kinds: GROUPS.find((g) => g.id === group)?.kinds ?? [],
          ...(member.trim() ? { member: member.trim() } : {}),
          ...(before === undefined ? {} : { before }),
        },
      });
      if (result._tag === "Success") {
        setPage(result.value);
        setEntries((current) =>
          before === undefined ? result.value.entries : [...current, ...result.value.entries],
        );
      } else {
        setPage(null);
        setEntries([]);
        setError(failureMessage(result));
      }
    } finally {
      setBusy(false);
    }
  };
  if (workspace.role === "member") return null;
  return (
    <div className="space-y-3 py-3">
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) void load();
        }}
      >
        Audit log · {workspace.name}
      </Button>
      {!open ? null : (
        <div className="space-y-3 pl-4">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void load();
            }}
          >
            <div className="w-48">
              <Select
                value={group}
                disabled={busy}
                onValueChange={(value) => {
                  if (value) {
                    setGroup(value);
                    setPage(null);
                    setEntries([]);
                  }
                }}
              >
                <SelectTrigger size="sm" aria-label="Audit group">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {GROUPS.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <div className="w-56">
              <Input
                size="sm"
                nativeInput
                type="email"
                aria-label="Audit person"
                placeholder="Filter by person's email"
                disabled={busy}
                value={member}
                onChange={(event) => {
                  setMember(event.currentTarget.value);
                  setPage(null);
                  setEntries([]);
                }}
              />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={busy}>
              {busy ? "Loading…" : "Refresh"}
            </Button>
          </form>
          {error ? (
            <div role="alert">
              <p className="text-sm text-destructive">{error}</p>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}>
                Retry
              </Button>
            </div>
          ) : null}
          {page?.unsupported ? (
            <p className="text-sm text-muted-foreground">
              This hub keeps no audit log. Update Peer Hub to record workspace changes.
            </p>
          ) : page && entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matching changes.</p>
          ) : null}
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li key={entry.seq} className="text-sm">
                <p>{describeAuditEntry(entry)}</p>
                <time dateTime={entry.at} className="text-xs text-muted-foreground">
                  {entry.at}
                </time>
                {entry.actor.type === "person" ? (
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · session {entry.actor.session}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {page?.next ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void load(page.next ?? undefined)}
            >
              Load older
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

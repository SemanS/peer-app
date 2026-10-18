import { useState } from "react";
import { mayManageAnnouncementCredentials } from "@t3tools/client-runtime/peer/announcements";
import type { PeerSlotProps, ProjectSettingsSlotProps } from "../slots.types";
import { SettingsRow } from "../../settings/settingsLayout";
import { Switch } from "../../ui/switch";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { usePeerPluginControl } from "../usePeerPluginControl";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useEnvironmentQuery } from "../../../state/query";
import { NestedRowTitle } from "../PeerSettingsRows";
import { failureMessage } from "../WorkspaceAccess";
import { announcementAtoms } from "./atoms";
import { withFinally } from "~/lib/withFinally";
export function AnnouncementSettings({ environmentId, status }: PeerSlotProps) {
  const control = usePeerPluginControl(environmentId);
  const setWake = useAtomCommand(announcementAtoms.setWake, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function wake(value: boolean) {
    setBusy(true);
    await withFinally(
      async () => {
        setError(failureMessage(await setWake({ environmentId, input: { wake: value } })));
      },
      () => {
        setBusy(false);
      },
    );
  }
  async function deliver(value: boolean) {
    setBusy(true);
    await withFinally(
      async () => {
        setError(await control.change("announcements", value));
      },
      () => {
        setBusy(false);
      },
    );
  }
  return (
    <>
      <SettingsRow
        title="Deliver announcements to this computer’s agents"
        description="Agents hear project announcements once, at their next step."
        control={
          <Switch
            aria-label="Deliver announcements"
            checked={status.plugins?.find((p) => p.id === "announcements")?.enabled ?? false}
            disabled={busy || !control.owner}
            onCheckedChange={(value) => void deliver(value)}
          />
        }
      />
      <SettingsRow
        title="Wake idle agents for announcements"
        description={
          error ??
          "Only information marked for waking reaches idle agents. Working agents hear it at their next step."
        }
        control={
          <Switch
            aria-label="Wake idle agents for announcements"
            checked={status.announcements?.wake ?? true}
            disabled={busy || !control.owner}
            onCheckedChange={(value) => void wake(value)}
          />
        }
      />
    </>
  );
}
export function AnnouncementCredentials(props: ProjectSettingsSlotProps) {
  return mayManageAnnouncementCredentials(props.state.project.role, props.workspace.role) ? (
    <Credentials {...props} />
  ) : null;
}
function Credentials({ environmentId, workspace, state }: ProjectSettingsSlotProps) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(30);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const input = { workspace: workspace.slug, project: state.project.id };
  const query = useEnvironmentQuery(
    open ? announcementAtoms.credentials({ environmentId, input }) : null,
  );
  const create = useAtomCommand(announcementAtoms.createCredential, { reportFailure: false });
  const revoke = useAtomCommand(announcementAtoms.revokeCredential, { reportFailure: false });
  async function make() {
    setBusy(true);
    setSecret(null);
    setCopied(false);
    await withFinally(
      async () => {
        const result = await create({
          environmentId,
          input: { ...input, label, validForDays: days },
        });
        setMessage(failureMessage(result));
        if (result._tag === "Success") {
          setSecret(result.value.secret);
          setLabel("");
          query.refresh();
        }
      },
      () => {
        setBusy(false);
      },
    );
  }
  async function remove(id: string) {
    setBusy(true);
    await withFinally(
      async () => {
        setMessage(failureMessage(await revoke({ environmentId, input: { ...input, id } })));
        query.refresh();
      },
      () => {
        setBusy(false);
      },
    );
  }
  function close() {
    setOpen(false);
    setSecret(null);
    setCopied(false);
  }
  return (
    <SettingsRow
      title={<NestedRowTitle under="project">Announcement credentials</NestedRowTitle>}
      description="Let CI or another project service post information. A credential cannot read the workspace or wake agents."
      control={
        <Button
          variant="outline"
          size="sm"
          aria-expanded={open}
          onClick={() => (open ? close() : setOpen(true))}
        >
          {open ? "Close" : "Manage credentials"}
        </Button>
      }
    >
      {open ? (
        <div className="flex flex-col gap-3 pt-3">
          {query.error ? <p role="alert">{query.error}</p> : null}
          {query.data?.credentials.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span>
                {row.label} · {row.createdBy} · {row.status} · expires{" "}
                {new Date(row.expiresAt).toLocaleDateString()} · last used{" "}
                {row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : "never"}
              </span>
              {row.status === "active" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void remove(row.id)}
                >
                  Revoke
                </Button>
              ) : null}
            </div>
          ))}
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && label.trim()) void make();
            }}
          >
            <label className="text-sm">
              Label
              <Input
                value={label}
                maxLength={40}
                required
                disabled={busy}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Valid for days
              <Input
                type="number"
                min={1}
                max={365}
                value={days}
                disabled={busy}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </label>
            <div>
              <Button
                type="submit"
                size="sm"
                disabled={busy || !label.trim() || days < 1 || days > 365}
              >
                Create credential
              </Button>
            </div>
          </form>
          {secret ? (
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <p className="text-sm">
                Copy this secret now. It disappears when this box closes and cannot be read again.
              </p>
              <code className="break-all text-xs">{secret}</code>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={copied}
                  onClick={() =>
                    void navigator.clipboard.writeText(secret).then(
                      () => setCopied(true),
                      () => setMessage("Could not copy. Select the secret and copy it."),
                    )
                  }
                >
                  {copied ? "Copied" : "Copy secret"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>
                  Close secret
                </Button>
              </div>
            </div>
          ) : null}
          {message ? <p role="alert">{message}</p> : null}
        </div>
      ) : null}
    </SettingsRow>
  );
}

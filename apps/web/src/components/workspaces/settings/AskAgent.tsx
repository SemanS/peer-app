import type { PeerProjectState, PeerWorkspaceState } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useState } from "react";

import { useComposerDraftStore } from "../../../composerDraftStore";
import { useNewThreadHandler } from "../../../hooks/useHandleNewThread";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { stackedThreadToast, toastManager } from "../../ui/toast";
import { usePeerSettings } from "./PeerSettingsContext";
import { askCheckout, askPrompt, type AskScope } from "./askAgent.logic";
import { useSettingsView } from "./useSettingsView";

/**
 * "Ask an agent to change this…" on a project or workspace page: the person says what they want in a
 * line, and a new thread opens in a checkout of the project (else of any project of the workspace)
 * with the request in its composer, worded so the agent reads the settings with `peer config show`
 * and proposes the change with `peer config propose`. The person sends it themselves; an agent
 * cannot save settings, only an owner's review does. Disabled until a project is cloned here, and
 * not there where the settings plugin is unavailable.
 */
export function AskAgent({
  workspace,
  project,
}: {
  readonly workspace: PeerWorkspaceState;
  /** The project the page is of; without it the request is about the workspace's own settings. */
  readonly project?: PeerProjectState | undefined;
}) {
  const { environmentId } = usePeerSettings();
  const view = useSettingsView(workspace.slug);
  const openNewThread = useNewThreadHandler();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!view.hubHasSettings) return null;
  const checkout = askCheckout(workspace.projects, project?.project.id);
  const scope: AskScope =
    project === undefined
      ? { kind: "workspace" }
      : { kind: "project", id: project.project.id, name: project.project.name };
  const request = text.trim();
  const start = async () => {
    if (checkout === null || request === "" || busy) return;
    setBusy(true);
    try {
      const opened = await openNewThread(scopeProjectRef(environmentId, checkout.projectId));
      if (opened === null) return;
      useComposerDraftStore
        .getState()
        .setPrompt(opened.draftId, askPrompt({ workspace, scope, text: request }));
      setText("");
    } catch (cause) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not open a thread",
          description: cause instanceof Error ? cause.message : "Try again from the project.",
        }),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      aria-label="Ask an agent"
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <Input
        className="min-w-0 flex-1"
        size="sm"
        aria-label="Ask an agent to change this"
        placeholder={checkout === null ? "Clone a project first" : "Ask an agent to change this…"}
        value={text}
        disabled={checkout === null || busy}
        onChange={(event) => setText(event.target.value)}
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={checkout === null || busy || request === ""}
      >
        {busy ? "Opening…" : "Ask"}
      </Button>
    </form>
  );
}

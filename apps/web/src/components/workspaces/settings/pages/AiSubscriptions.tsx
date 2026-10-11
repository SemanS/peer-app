import { ComingInThisChange, PeerSettingsPage } from "../PeerSettingsPage";

/** Which AI plans the person has: information for Peer, never a login. */
export function AiSubscriptions() {
  return (
    <PeerSettingsPage
      title="AI subscriptions"
      description="Tell Peer which plans you have. It’s information only: Peer never asks for your login, and never shares or pools your plan."
    >
      <ComingInThisChange>
        your plans, where you can use them, and why an agent can’t start on one
      </ComingInThisChange>
    </PeerSettingsPage>
  );
}

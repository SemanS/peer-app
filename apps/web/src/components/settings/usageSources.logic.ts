/**
 * What the Usage limit sources section says about itself. The section is about CLIProxyAPI servers
 * a person runs; its words once called them "hubs", beside a Peer Hub that is connected under a
 * different page, so it says which is which.
 */

/** The host of the Peer Hub an environment is signed in to; null where it is signed in to none. */
export function peerHubHost(
  hub: { readonly hubUrl: string; readonly signedIn: boolean } | null | undefined,
): string | null {
  if (hub === null || hub === undefined || !hub.signedIn) return null;
  try {
    return new URL(hub.hubUrl).host;
  } catch {
    return hub.hubUrl;
  }
}

/** The line under "CLIProxyAPI": what a source is for, and that it is not the Peer Hub. */
export function usageSourcesNote(
  hub: { readonly hubUrl: string; readonly signedIn: boolean } | null | undefined,
): string {
  const intro = "Reads your rate limits from a CLIProxyAPI server you run, for the Limits view.";
  const host = peerHubHost(hub);
  return host === null
    ? `${intro} It is not a Peer Hub.`
    : `${intro} This isn’t your Peer Hub: ${host} is connected under Workspace › Hub.`;
}

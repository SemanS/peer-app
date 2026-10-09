import { isNeedsYouPushId } from "@t3tools/contracts";
/** Connect keeps thread-shaped links. Rewrite only exact synthetic Peer activities. */
export function rewritePeerAlertPath(path: string): string {
  const match = /^\/?threads\/([^/?#]+)\/([^/?#]+)$/.exec(path);
  if (!match) return path;
  try {
    const environment = decodeURIComponent(match[1]!),
      id = decodeURIComponent(match[2]!);
    if (!isNeedsYouPushId(id)) return path;
    return `/needs-you?focus=${encodeURIComponent(id)}&environment=${encodeURIComponent(environment)}`;
  } catch {
    return path;
  }
}

export const NEEDS_YOU_ROUTE_PATH = "needs-you";
export const NEEDS_YOU_AGENT_PATH = "needs-you/agent/:environmentId/:agentId";

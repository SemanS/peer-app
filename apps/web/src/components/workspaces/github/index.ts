import type { PeerWebPlugin } from "../slots";
import { GitHubNotOpenHere, GitHubSettings, GitHubShareNote } from "./GitHubSlots";

/** GitHub: signing in through GitHub CLI so workspace repositories clone with the person's account. */
export const githubWebPlugin: PeerWebPlugin = {
  id: "github",
  settings: GitHubSettings,
  notOpenHere: GitHubNotOpenHere,
  shareProject: GitHubShareNote,
};

import { GitHubTaskBadge } from "./GitHubTaskBadge";
import { GitHubTaskPullRequests } from "./GitHubTaskPullRequests";
import { GitHubVerificationSettings } from "./GitHubVerificationSettings";
import type { PeerWebPlugin } from "../slots.types";
import { GitHubNotOpenHere, GitHubSettings, GitHubShareNote } from "./GitHubSlots";

/** GitHub: signing in through GitHub CLI so workspace repositories clone with the person's account. */
export const githubWebPlugin: PeerWebPlugin = {
  id: "github",
  taskBadges: GitHubTaskBadge,
  taskContext: GitHubTaskPullRequests,
  workspaceSettings: GitHubVerificationSettings,
  settings: GitHubSettings,
  notOpenHere: GitHubNotOpenHere,
  shareProject: GitHubShareNote,
};

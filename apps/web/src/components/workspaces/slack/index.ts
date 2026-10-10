import type { PeerWebPlugin } from "../slots.types";
import { SlackSection } from "./SlackSection";

/** Slack: connecting a workspace's Slack app, and a member's link and options. */
export const slackWebPlugin: PeerWebPlugin = { id: "slack", settings: SlackSection };

import { expect, it } from "@effect/vitest";

import { SlackPlugin } from "./index.ts";

it("is the Slack plugin, served by the Hub's slack feature and on by default", () => {
  expect(SlackPlugin.id).toBe("slack");
  expect(SlackPlugin.hubFeature).toEqual({ id: "slack", revision: 1 });
  expect(SlackPlugin.defaultEnabled).toBe(true);
});

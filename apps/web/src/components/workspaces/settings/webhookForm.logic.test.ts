import { describe, expect, it } from "vite-plus/test";

import {
  EVENT_GROUPS,
  MAX_EVENTS,
  MAX_WEBHOOKS,
  afterStoring,
  checkDraft,
  draftOf,
  formatLabel,
  generateSigningKey,
  groupOn,
  hookOf,
  idFromName,
  idOf,
  newDraft,
  otherEvents,
  projectChoices,
  readHook,
  reviewScope,
  saveOperation,
  savedHooks,
  secretNameFor,
  secretNameOf,
  secretRef,
  secretsToStore,
  signingKeyProblem,
  signingText,
  titleOfId,
  urlProblem,
  withGroup,
  withoutEvent,
  type WebhookDraft,
} from "./webhookForm.logic";

const group = (key: string) => EVENT_GROUPS.find((entry) => entry.key === key)!;

describe("the id a name makes", () => {
  it.each([
    ["Ops", "ops"],
    ["Team Slack", "team-slack"],
    ["  Teams alerts  ", "teams-alerts"],
    ["Café Ñandú", "cafe-nandu"],
    ["CI / deploys!", "ci-deploys"],
    ["", ""],
    ["Проект", ""],
  ])("makes %j into %j", (name, id) => {
    expect(idFromName(name)).toBe(id);
  });

  it("is at most 48 characters and never ends on a hyphen where it was cut", () => {
    expect(idFromName("a".repeat(80))).toHaveLength(48);
    expect(idFromName(`${"a".repeat(47)} bcd`)).toBe("a".repeat(47));
  });

  it("reads back as words, the way the lists name a webhook", () => {
    expect(titleOfId("teams-alerts")).toBe("Teams alerts");
    expect(titleOfId("ops")).toBe("Ops");
    expect(reviewScope("teams-alerts")).toBe("Webhook “Teams alerts”");
  });

  it("names a webhook's own secrets after its id", () => {
    expect(secretNameFor("ops", "WEBHOOK_URL")).toBe("OPS_WEBHOOK_URL");
    expect(secretNameFor("teams-alerts", "SIGNING_KEY")).toBe("TEAMS_ALERTS_SIGNING_KEY");
    // The longest id still makes a name the Hub takes (up to 64 characters).
    expect(secretNameFor("a".repeat(48), "WEBHOOK_URL").length).toBeLessThanOrEqual(64);
  });
});

describe("secret references", () => {
  it("are written and read back", () => {
    expect(secretRef("OPS_WEBHOOK_URL")).toBe(`\${secret:OPS_WEBHOOK_URL}`);
    expect(secretNameOf(secretRef("OPS_WEBHOOK_URL"))).toBe("OPS_WEBHOOK_URL");
    expect(secretNameOf(secretRef("github-webhook"))).toBe("github-webhook");
  });

  it("are the only thing that names a secret", () => {
    expect(secretNameOf("https://hooks.slack.com/services/T0/B0/X")).toBeNull();
    expect(secretNameOf(`\${secret:a b}`)).toBeNull();
    expect(secretNameOf(`\${secret:}`)).toBeNull();
    expect(secretNameOf(undefined)).toBeNull();
    expect(secretNameOf(42)).toBeNull();
  });
});

const ops = {
  format: "generic",
  url: secretRef("OPS_WEBHOOK_URL"),
  events: ["task.done", "task.review", "overlap.ask"],
  projects: ["booking", "peer-hub"],
  signingSecret: [secretRef("OPS_SIGNING_KEY")],
  enabled: true,
};
const teamSlack = {
  format: "slack",
  url: secretRef("TEAM_SLACK_URL"),
  events: ["task.review", "announcement.posted"],
  enabled: true,
};

describe("a webhook as the document holds it", () => {
  it("reads every field, a signing secret given as one name or a list, and what a newer Hub adds", () => {
    expect(readHook({ ...ops, signingSecret: secretRef("ONE"), retry: { max: 3 } })).toEqual({
      format: "generic",
      url: secretRef("OPS_WEBHOOK_URL"),
      events: ["task.done", "task.review", "overlap.ask"],
      projects: ["booking", "peer-hub"],
      signingSecret: [secretRef("ONE")],
      enabled: true,
      extra: { retry: { max: 3 } },
    });
  });

  it("reads a webhook open to everyone as having no projects, and one that is not paused as enabled", () => {
    expect(readHook({ format: "slack", url: "x", events: [] })).toMatchObject({
      projects: null,
      signingSecret: [],
      enabled: true,
    });
    expect(readHook({ ...teamSlack, enabled: false })?.enabled).toBe(false);
  });

  it("reads nothing from what is not an entry", () => {
    expect(readHook(null)).toBeNull();
    expect(readHook("ops")).toBeNull();
    expect(readHook(["ops"])).toBeNull();
  });

  it("lists the webhooks of a document by id", () => {
    const hooks = savedHooks({ webhooks: { ops, "team-slack": teamSlack, broken: 4 } });
    expect([...hooks.keys()]).toEqual(["ops", "team-slack"]);
    expect(savedHooks({}).size).toBe(0);
    expect(savedHooks(null).size).toBe(0);
  });
});

describe("the form and the document", () => {
  it("write a webhook back as it was when nothing was edited", () => {
    for (const raw of [
      ops,
      teamSlack,
      { ...ops, enabled: false },
      { ...teamSlack, retry: { max: 3 } },
      { ...ops, signingSecret: [secretRef("A"), secretRef("B")] },
    ]) {
      const hook = readHook(raw)!;
      expect(hookOf(draftOf("ops", hook))).toEqual(raw);
    }
  });

  it("start a new webhook as Slack with the two events most want, open to all", () => {
    const draft = newDraft();
    expect(draft).toMatchObject({
      existingId: null,
      format: "slack",
      events: ["task.done", "task.review"],
      projects: null,
      enabled: true,
    });
  });

  it("name a new webhook's destination after its id", () => {
    const draft: WebhookDraft = {
      ...newDraft(),
      name: "Team Slack",
      newUrl: "https://hooks.slack.com/services/T0/B0/X",
    };
    expect(idOf(draft)).toBe("team-slack");
    expect(hookOf(draft)).toEqual({
      format: "slack",
      url: secretRef("TEAM_SLACK_WEBHOOK_URL"),
      events: ["task.done", "task.review"],
      enabled: true,
    });
  });

  it("give a new generic webhook the signing secret it must have, and none to Slack or Teams", () => {
    const generic: WebhookDraft = { ...newDraft(), name: "Ops", format: "generic" };
    expect(hookOf(generic).signingSecret).toEqual([secretRef("OPS_SIGNING_KEY")]);
    expect(hookOf({ ...generic, format: "teams" })).not.toHaveProperty("signingSecret");
  });

  it("name the signing secret of a Slack webhook that is given a key", () => {
    const draft: WebhookDraft = { ...newDraft(), name: "Ops", newSigningKey: "whsec_x" };
    expect(hookOf(draft).signingSecret).toEqual([secretRef("OPS_SIGNING_KEY")]);
  });

  it("keep the saved id, destination and signing secrets when they are edited", () => {
    const draft = draftOf("ops", readHook(ops)!);
    const edited: WebhookDraft = {
      ...draft,
      name: "Renamed",
      format: "slack",
      events: ["task.done"],
      projects: null,
      enabled: false,
    };
    expect(idOf(edited)).toBe("ops");
    expect(hookOf(edited)).toEqual({
      format: "slack",
      url: secretRef("OPS_WEBHOOK_URL"),
      events: ["task.done"],
      signingSecret: [secretRef("OPS_SIGNING_KEY")],
      enabled: false,
    });
  });

  it("store what was typed under the names the document refers to", () => {
    const saved = draftOf("ops", readHook(ops)!);
    expect(secretsToStore(saved)).toEqual([]);
    const replaced: WebhookDraft = {
      ...saved,
      newUrl: "  https://example.com/hook  ",
      newSigningKey: "whsec_abc",
    };
    expect(secretsToStore(replaced)).toEqual([
      { name: "OPS_WEBHOOK_URL", value: "https://example.com/hook" },
      { name: "OPS_SIGNING_KEY", value: "whsec_abc" },
    ]);
  });

  it("store a new webhook's destination and key under names made from its id", () => {
    const draft: WebhookDraft = {
      ...newDraft(),
      name: "Teams alerts",
      format: "generic",
      newUrl: "https://example.com/hook",
      newSigningKey: "whsec_abc",
    };
    expect(secretsToStore(draft)).toEqual([
      { name: "TEAMS_ALERTS_WEBHOOK_URL", value: "https://example.com/hook" },
      { name: "TEAMS_ALERTS_SIGNING_KEY", value: "whsec_abc" },
    ]);
  });

  it("store nothing for a field that was opened and left empty", () => {
    expect(
      secretsToStore({ ...draftOf("ops", readHook(ops)!), newUrl: "  ", newSigningKey: "" }),
    ).toEqual([]);
  });

  it("take what was stored for the saved destination and key, so it is not stored twice", () => {
    const draft: WebhookDraft = {
      ...newDraft(),
      name: "Ops",
      format: "generic",
      newUrl: " https://example.com/hook ",
      newSigningKey: "whsec_abc",
    };
    const stored = afterStoring(draft);
    expect(stored).toMatchObject({
      urlSecret: "OPS_WEBHOOK_URL",
      newUrl: null,
      signingSecrets: ["OPS_SIGNING_KEY"],
      newSigningKey: null,
    });
    expect(secretsToStore(stored)).toEqual([]);
    expect(hookOf(stored)).toEqual(hookOf(draft));
    // What was not typed stays as it was.
    expect(afterStoring({ ...draft, newSigningKey: null })).toMatchObject({
      urlSecret: "OPS_WEBHOOK_URL",
      signingSecrets: [],
    });
  });

  it("ask for a new destination where the saved one names no secret", () => {
    const draft = draftOf("old", readHook({ ...teamSlack, url: "https://hooks.slack.com/x" })!);
    expect(draft).toMatchObject({ urlSecret: null, newUrl: "" });
  });

  it("send the change as `webhooks.<id>`, or its removal", () => {
    const hook = hookOf(draftOf("ops", readHook(ops)!));
    expect(saveOperation({ workspace: "acme", base: 41, id: "ops", hook })).toEqual({
      kind: "save",
      workspace: "acme",
      base: 41,
      set: [{ path: ["webhooks", "ops"], value: hook }],
    });
    expect(saveOperation({ workspace: "acme", base: 41, id: "ops", hook: null })).toMatchObject({
      kind: "save",
      set: [{ path: ["webhooks", "ops"], value: null }],
    });
  });
});

describe("the events", () => {
  it("map the five checkboxes to the Hub's names", () => {
    expect(EVENT_GROUPS.map((entry) => [entry.label, entry.events])).toEqual([
      ["Task finished", ["task.done"]],
      ["Needs review", ["task.review"]],
      ["Overlap", ["overlap.ask"]],
      ["Team request", ["request.created", "request.answered"]],
      ["Announcement", ["announcement.posted"]],
    ]);
  });

  it("are on when the webhook has any of a group's names", () => {
    expect(groupOn(["request.answered"], group("request"))).toBe(true);
    expect(groupOn(["task.done"], group("request"))).toBe(false);
  });

  it("add a group's names after the others, once, and take them all away", () => {
    expect(withGroup(["task.done"], group("request"), true)).toEqual([
      "task.done",
      "request.created",
      "request.answered",
    ]);
    expect(withGroup(["request.created", "task.done"], group("request"), true)).toEqual([
      "request.created",
      "task.done",
      "request.answered",
    ]);
    expect(
      withGroup(["request.created", "task.done", "request.answered"], group("request"), false),
    ).toEqual(["task.done"]);
  });

  it("keep the events the form has no checkbox for, so saving does not drop them", () => {
    const events = ["task.done", "work.merged", "handoff"];
    expect(otherEvents(events)).toEqual(["work.merged", "handoff"]);
    expect(withGroup(events, group("review"), true)).toEqual([...events, "task.review"]);
    expect(withoutEvent(events, "handoff")).toEqual(["task.done", "work.merged"]);
  });
});

describe("what keeps Save off", () => {
  const free = new Set<string>();
  const filled: WebhookDraft = {
    ...newDraft(),
    name: "Ops",
    newUrl: "https://example.com/hook",
  };
  const check = (draft: WebhookDraft, taken: ReadonlySet<string> = free) =>
    checkDraft(draft, { takenIds: taken });

  it("is on for a webhook with a name, an https destination and an event", () => {
    expect(check(filled)).toEqual({
      name: null,
      url: null,
      events: null,
      projects: null,
      signing: null,
      limit: null,
      ready: true,
    });
  });

  it("is off, without a complaint, while the name or the destination is not typed", () => {
    expect(check({ ...filled, name: "" })).toMatchObject({ name: null, ready: false });
    expect(check({ ...filled, newUrl: "" })).toMatchObject({ url: null, ready: false });
  });

  it("complains of a name that makes no id, and of one that is taken", () => {
    expect(check({ ...filled, name: "!!!" }).name).toContain("The id is made from the letters");
    expect(check(filled, new Set(["ops"])).name).toBe(
      "A webhook called “ops” exists already. Pick another name.",
    );
  });

  it("does not ask an existing webhook for a name", () => {
    const saved = draftOf("ops", readHook(ops)!);
    expect(check(saved, new Set(["ops"]))).toMatchObject({ name: null, ready: true });
  });

  it("complains of a destination that is not https", () => {
    expect(check({ ...filled, newUrl: "http://example.com/hook" }).url).toBe(
      "Use an https address: http is not accepted.",
    );
    expect(check({ ...filled, newUrl: "hooks" }).url).toBe("That is not a web address.");
    expect(check({ ...filled, newUrl: "https://a b.com" }).url).toBe("An address has no spaces.");
  });

  it("lets a saved webhook be saved as it is, whether or not its secret is stored", () => {
    expect(check(draftOf("ops", readHook(ops)!))).toMatchObject({ url: null, ready: true });
  });

  it("asks for at least one event and at most ten", () => {
    expect(check({ ...filled, events: [] })).toMatchObject({
      events: "Pick at least one event.",
      ready: false,
    });
    const many = Array.from({ length: MAX_EVENTS + 1 }, (_, i) => `x.${i}`);
    expect(check({ ...filled, events: many }).events).toBe(
      `A webhook takes up to ${MAX_EVENTS} events.`,
    );
  });

  it("asks for a project when it is limited to some", () => {
    expect(check({ ...filled, projects: [] })).toMatchObject({
      projects: "Pick at least one project, or open it to all.",
      ready: false,
    });
    expect(check({ ...filled, projects: ["booking"] }).ready).toBe(true);
  });

  it("asks a generic webhook for a signing key, and checks the one typed", () => {
    const generic = { ...filled, format: "generic" };
    expect(check(generic)).toMatchObject({ signing: null, ready: false });
    expect(check({ ...generic, newSigningKey: "secret" }).signing).toContain("starts with whsec_");
    const key = generateSigningKey(() => new Uint8Array(32).fill(7));
    expect(check({ ...generic, newSigningKey: key })).toMatchObject({ signing: null, ready: true });
  });

  it("does not ask a Slack webhook for a key, but checks one it is given", () => {
    expect(check(filled).signing).toBeNull();
    expect(check({ ...filled, newSigningKey: "nope" }).signing).toContain("starts with whsec_");
  });

  it("does not ask a saved generic webhook for the key it has", () => {
    expect(check(draftOf("ops", readHook(ops)!)).ready).toBe(true);
  });

  it("stops a new webhook past the twentieth", () => {
    const taken = new Set(Array.from({ length: MAX_WEBHOOKS }, (_, i) => `hook-${i}`));
    expect(check(filled, taken)).toMatchObject({
      limit: "A workspace has up to 20 webhooks.",
      ready: false,
    });
    expect(check(draftOf("hook-1", readHook(teamSlack)!), taken).limit).toBeNull();
  });

  it("says a format only a newer Hub has cannot be kept as a choice", () => {
    expect(check({ ...filled, format: "discord" })).toMatchObject({ ready: false });
    expect(formatLabel("discord")).toBe("discord");
    expect(formatLabel("teams")).toBe("Teams");
  });
});

describe("signing keys", () => {
  const key = (bytes: number) => `whsec_${btoa("a".repeat(bytes))}`;

  it("are whsec_ and base64 of 24 to 64 bytes", () => {
    expect(signingKeyProblem(key(24))).toBeNull();
    expect(signingKeyProblem(key(64))).toBeNull();
    expect(signingKeyProblem(`  ${key(32)}\n`)).toBeNull();
    expect(signingKeyProblem(key(23))).toBe("A signing key holds 24 to 64 bytes. Generate one.");
    expect(signingKeyProblem(key(65))).toBe("A signing key holds 24 to 64 bytes. Generate one.");
  });

  it("say what is wrong with one that is not", () => {
    expect(signingKeyProblem(key(32).slice(6))).toBe(
      "A signing key starts with whsec_. Generate one.",
    );
    expect(signingKeyProblem("whsec_not base64!")).toContain("base64");
    expect(signingKeyProblem("")).toBeNull();
  });

  it("are made of 32 random bytes and are keys the Hub reads", () => {
    const made = generateSigningKey(() => Uint8Array.from({ length: 32 }, (_, i) => i));
    expect(made.startsWith("whsec_")).toBe(true);
    expect(atob(made.slice(6))).toHaveLength(32);
    expect(signingKeyProblem(made)).toBeNull();
    expect(generateSigningKey()).not.toBe(generateSigningKey());
  });
});

describe("destinations", () => {
  it.each([
    ["", null],
    ["https://hooks.slack.com/services/T0/B0/X", null],
    ["https://example.com", null],
    ["http://example.com", "Use an https address: http is not accepted."],
    ["ftp://example.com", "Use an https address: http is not accepted."],
    ["example.com", "That is not a web address."],
    ["https://", "That is not a web address."],
  ])("judges %j", (value, problem) => {
    expect(urlProblem(value)).toBe(problem);
  });
});

describe("around the form", () => {
  it("offers the projects of the document by name, else the ones the manifest lists", () => {
    const document = {
      projects: { peer: { name: "Peer Hub" }, booking: { name: "Booking" }, bare: {} },
    };
    expect(projectChoices(document, [{ id: "x", name: "X" }])).toEqual([
      { id: "bare", name: "bare" },
      { id: "booking", name: "Booking" },
      { id: "peer", name: "Peer Hub" },
    ]);
    expect(
      projectChoices(null, [
        { id: "b", name: "B" },
        { id: "a", name: "A" },
      ]),
    ).toEqual([
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ]);
  });

  it("says which secrets a webhook signs with, and whether they are stored", () => {
    const stored = new Set(["OPS_SIGNING_KEY"]);
    expect(signingText(["OPS_SIGNING_KEY"], stored)).toBe(
      "With the secret OPS_SIGNING_KEY · stored",
    );
    expect(signingText(["OPS_SIGNING_KEY", "OLD"], stored)).toBe(
      "With the secrets OPS_SIGNING_KEY and OLD · not stored yet",
    );
    expect(signingText([], stored)).toBe(
      "A generic webhook is signed, so its receiver can verify it.",
    );
  });
});

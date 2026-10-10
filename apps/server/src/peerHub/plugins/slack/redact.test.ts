import { describe, expect, it } from "@effect/vitest";

import { cleanForSlack, SLACK_TEXT_MAX, titleForSlack } from "./redact.ts";

/** A made-up secret of `length` characters after `prefix`; never a whole real-looking token in the source. */
const made = (prefix: string, length: number) => prefix + "aZ09bY18cX27".repeat(8).slice(0, length);
const pem = (
  kind: string,
  body = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nKgwggSkAgEAAoIBAQC7VJTUt9Us8cKj",
) => `-----BEGIN ${kind}PRIVATE KEY-----\n${body}\n-----END ${kind}PRIVATE KEY-----`;
const characters = (...codes: number[]) => String.fromCodePoint(...codes);
const loneSurrogate = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

describe("credentials in text for Slack", () => {
  const secrets: ReadonlyArray<readonly [string, string]> = [
    ["a private key", pem("")],
    ["an RSA private key", pem("RSA ")],
    ["an OpenSSH private key", pem("OPENSSH ")],
    ["an encrypted private key", pem("ENCRYPTED ")],
    ["a GitHub personal access token", made("ghp_", 36)],
    ["a GitHub OAuth token", made("gho_", 36)],
    ["a GitHub user token", made("ghu_", 36)],
    ["a GitHub server token", made("ghs_", 36)],
    ["a GitHub refresh token", made("ghr_", 36)],
    ["a fine-grained GitHub token", made("github_pat_", 40)],
    ["a Slack bot token", `${made("xoxb-", 12)}-${made("", 13)}-${made("", 24)}`],
    ["a Slack user token", `${made("xoxp-", 12)}-${made("", 13)}-${made("", 32)}`],
    ["a Slack legacy token", made("xoxa-2-", 30)],
    ["a Slack refresh token", made("xoxr-", 30)],
    ["a Slack session token", made("xoxs-", 30)],
    ["a Slack app-level token", `${made("xapp-1-A", 10)}-${made("", 13)}-${made("", 40)}`],
    ["an OpenAI key", made("sk-", 48)],
    ["an OpenAI project key", made("sk-proj-", 40)],
    ["an Anthropic key", made("sk-ant-api03-", 60)],
    ["an AWS access key id", `AKIA${"IOSFODNN7EXAMPLE".slice(0, 16)}`],
    ["a temporary AWS access key id", `ASIA${"IOSFODNN7EXAMPLE".slice(0, 16)}`],
    ["a JSON web token", `${made("eyJ", 17)}.${made("eyJ", 37)}.${made("", 43)}`],
    ["a Peer session token", made("phs_", 43)],
    ["a Peer announcement credential", `pan_0123456789ab_${made("", 43)}`],
  ];

  it.each(secrets)("replaces %s", (_, secret) => {
    expect(cleanForSlack(`use ${secret} now`)).toBe("use [redacted] now");
    expect(cleanForSlack(`curl -H "x: ${secret}"`)).toBe('curl -H "x: [redacted]"');
    expect(titleForSlack(`Deploy with ${secret}`)).toBe("Deploy with [redacted]");
  });

  it("redacts a private key whole, and one that is cut short to the end", () => {
    expect(cleanForSlack(`before\n${pem("RSA ")}\nafter`)).toBe("before\n[redacted]\nafter");
    expect(cleanForSlack(`before -----BEGIN PRIVATE KEY-----\nMIIEvQIBADAN\nnever ends`)).toBe(
      "before [redacted]",
    );
  });

  it("keeps the name of a setting and replaces its value", () => {
    expect(cleanForSlack("password = hunter2")).toBe("password = [redacted]");
    expect(cleanForSlack("password=hunter2 and more")).toBe("password=[redacted] and more");
    expect(cleanForSlack("PASSWD : hunter2")).toBe("PASSWD : [redacted]");
    expect(cleanForSlack("secret: s3cr3t!")).toBe("secret: [redacted]");
    expect(cleanForSlack("token=abc.def/ghi")).toBe("token=[redacted]");
    expect(cleanForSlack("api_key=k1 apikey=k2 api-key: k3")).toBe(
      "api_key=[redacted] apikey=[redacted] api-key: [redacted]",
    );
    expect(cleanForSlack("export DB_PASSWORD=pw AWS_SECRET_ACCESS_KEY=abc/def+ghi")).toBe(
      "export DB_PASSWORD=[redacted] AWS_SECRET_ACCESS_KEY=[redacted]",
    );
    expect(cleanForSlack("{ accessToken: 'one two', clientSecret: \"three four\" }")).toBe(
      "{ accessToken: [redacted], clientSecret: [redacted] }",
    );
    expect(cleanForSlack('{"password": "hunter2", "api_key":"k"}')).toBe(
      '{"password": [redacted], "api_key":[redacted]}',
    );
    expect(cleanForSlack("mysql --password=hunter2 -u root")).toBe(
      "mysql --password=[redacted] -u root",
    );
  });

  it("replaces a bearer token and the password of a URL", () => {
    expect(cleanForSlack(`Authorization: Bearer ${made("", 30)}`)).toBe(
      "Authorization: Bearer [redacted]",
    );
    expect(cleanForSlack("psql postgres://app:hunter2@db.internal:5432/app")).toBe(
      "psql postgres://app:[redacted]@db.internal:5432/app",
    );
    expect(cleanForSlack("git clone https://x-access-token:abc123@github.com/acme/app.git")).toBe(
      "git clone https://x-access-token:[redacted]@github.com/acme/app.git",
    );
  });

  it("leaves alone what only looks a little like one", () => {
    for (const text of [
      "Raise max_tokens: 4096 and token_count = 5; tokens: 12",
      "A password policy needs a reset flow.",
      "Enter your token:\nThen press enter",
      "risk-assessment-for-the-project and task-runner-configuration-file",
      "ghp_tooshort and sk-short and xoxb-1 and AKIA123 and eyJ.a.b",
      "https://example.com:8080/docs and Bearer authentication",
      "phs_ alone, graphs_of_the_pipeline_stages and japan_tokyo_station_names",
    ]) {
      expect(cleanForSlack(text), text).toBe(text);
    }
  });

  it("redacts before it cuts, so no part of a key shows at the cut", () => {
    // The cut keeps 2,779 characters; this key starts nine characters before it.
    const text = `${"a".repeat(2769)} ${made("ghp_", 36)} ${"b".repeat(100)}`;
    const cut = cleanForSlack(text);
    expect(cut).not.toMatch(/ghp_|aZ09/);
    expect(cut).toMatch(/\[redacte.{0,10}… the rest is in Peer$/);
  });
});

describe("control characters in text for Slack", () => {
  it("are removed, but newlines and tabs stay", () => {
    const hidden = characters(
      0x00,
      0x07,
      0x1b,
      0x7f,
      0x85,
      0x9f,
      0x061c,
      0x200b,
      0x200e,
      0x202e,
      0x2066,
      0xfeff,
    );
    expect(cleanForSlack(`a${hidden}b\r\nc\td\ne\rf`)).toBe("ab\nc\td\nef");
  });

  it("keep what a script or an emoji is made of", () => {
    const family = `👨${characters(0x200d)}👩${characters(0x200d)}👧`;
    expect(cleanForSlack(`日本語 ${family} ñ`)).toBe(`日本語 ${family} ñ`);
  });

  it("leave `&`, `<` and `>` to the Hub, which escapes them once", () => {
    const text = "<!channel> a & b <https://evil.example|docs>";
    expect(cleanForSlack(text)).toBe(text);
    expect(titleForSlack(text)).toBe(text);
  });
});

describe("a cut text for Slack", () => {
  it("keeps a text of exactly the bound and cuts a longer one to it, ending counted", () => {
    const exact = "a".repeat(SLACK_TEXT_MAX);
    expect(SLACK_TEXT_MAX).toBe(2_800);
    expect(cleanForSlack(exact)).toBe(exact);
    const over = cleanForSlack("a".repeat(SLACK_TEXT_MAX + 1));
    // The ending counts within the bound.
    expect(over).toHaveLength(SLACK_TEXT_MAX);
    expect(over).toBe(`${"a".repeat(SLACK_TEXT_MAX - 21)}… the rest is in Peer`);
    const long = cleanForSlack(`first part\n${"x".repeat(10_000)}`);
    expect(long).toHaveLength(SLACK_TEXT_MAX);
    expect(long.startsWith("first part\nxxx")).toBe(true);
    expect(long.endsWith("x… the rest is in Peer")).toBe(true);
  });

  it("takes the bound as an argument", () => {
    // 50 characters: 29 of the text and the 21 of the ending.
    expect(cleanForSlack("0123456789".repeat(10), 50)).toBe(
      "01234567890123456789012345678… the rest is in Peer",
    );
    expect(cleanForSlack("short", 50)).toBe("short");
  });

  it("is never cut between the two halves of one character", () => {
    const keep = SLACK_TEXT_MAX - 21;
    // The emoji's first half would be the last character kept: it goes whole or not at all.
    const split = cleanForSlack(`${"a".repeat(keep - 1)}😀${"b".repeat(100)}`);
    expect(split).toBe(`${"a".repeat(keep - 1)}… the rest is in Peer`);
    expect(split).not.toMatch(loneSurrogate);
    const whole = cleanForSlack(`${"a".repeat(keep - 2)}😀${"b".repeat(100)}`);
    expect(whole).toBe(`${"a".repeat(keep - 2)}😀… the rest is in Peer`);
    expect(whole).not.toMatch(loneSurrogate);
    expect(cleanForSlack("😀".repeat(5_000))).not.toMatch(loneSurrogate);
    expect(cleanForSlack("😀".repeat(5_000), 51)).toBe(`${"😀".repeat(15)}… the rest is in Peer`);
  });

  it("says the rest is in Peer also when little is left of a very long text", () => {
    // A private key that never ends runs to the end of what is read, and what follows is dropped.
    const text = `${"a".repeat(100)} -----BEGIN PRIVATE KEY-----\n${"M".repeat(50_000)}`;
    expect(cleanForSlack(text)).toBe(`${"a".repeat(100)} [redacted]… the rest is in Peer`);
    expect(cleanForSlack(`hello ${"x".repeat(5_000_000)}`)).toHaveLength(SLACK_TEXT_MAX);
  });

  it("is cleaned once: cleaning it again changes nothing", () => {
    for (const text of [
      "plain words",
      `key ${made("ghp_", 36)} and password: hunter2`,
      `${"a".repeat(5_000)} ${pem("")}`,
      `${"😀".repeat(3_000)}`,
      `x-access-token:abc@host ${"b".repeat(3_000)}`,
    ]) {
      expect(cleanForSlack(cleanForSlack(text))).toBe(cleanForSlack(text));
      expect(titleForSlack(titleForSlack(text))).toBe(titleForSlack(text));
    }
  });

  it("copes with a very long text of anything", () => {
    for (const unit of [
      "eyJ",
      "ghp_",
      "sk-",
      "Bearer ",
      "password ",
      "://",
      "-----BEGIN ",
      "a.",
      "😀",
    ]) {
      const text = unit.repeat(Math.ceil(2_000_000 / unit.length));
      expect(cleanForSlack(text).length).toBeLessThanOrEqual(SLACK_TEXT_MAX);
      expect(titleForSlack(text).length).toBeLessThanOrEqual(120);
    }
  });
});

describe("a title for Slack", () => {
  it("is one line without control characters", () => {
    const marks = `${characters(0x00)} auth${characters(0x202e)}`;
    expect(titleForSlack(`  Fix\n the\t\tbug \r\n in${marks}  `)).toBe("Fix the bug in auth");
    expect(titleForSlack("")).toBe("");
    expect(titleForSlack(" \n\t ")).toBe("");
  });

  it("is cut to 120 characters with an ellipsis", () => {
    expect(titleForSlack("a".repeat(120))).toBe("a".repeat(120));
    expect(titleForSlack("a".repeat(121))).toBe(`${"a".repeat(119)}…`);
    expect(titleForSlack(`${"word ".repeat(40)}`)).toHaveLength(120);
    expect(titleForSlack("0123456789".repeat(10), 75)).toBe(`${"0123456789".repeat(7)}0123…`);
  });

  it("is never cut between the two halves of one character", () => {
    const split = titleForSlack(`${"a".repeat(118)}😀${"b".repeat(10)}`);
    expect(split).toBe(`${"a".repeat(118)}…`);
    expect(split).not.toMatch(loneSurrogate);
    expect(titleForSlack(`${"a".repeat(117)}😀${"b".repeat(10)}`)).toBe(`${"a".repeat(117)}😀…`);
  });
});

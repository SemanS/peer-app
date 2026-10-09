---
title: Hand a task to a teammate
hint: "<teammate email> [what is left]"
access: write
requires: [requests]
---
Hand off your current task through a request its owner accepts.

Input: {{input}}

1. Read `peer status`. The first input word is the teammate's workspace email; the rest says what is left. If the email, task or goal is missing, ask your person; never guess.
2. Write what is done, what is left, the branch and pull requests, files and unconfirmed facts into the shared task context if you keep it, otherwise under For the team in your private working context.
3. Check that it was saved. Read the shared version back with `peer context` when you keep it. If the state was not saved, STOP here and tell your person: do not release anything or send a request.
4. If `peer handoff` is listed in `peer help`, read the existing handoff package as reference and mention it in your request if one exists. This read does not create a package or finish the task. Release your claims with `peer release`.
5. Send `peer request <email> "<prompt>" --title "<task>: continue"`. Give a short summary, task, release state and the context version to read. Keep sent text on one line without $, backticks or backslashes. If the result is uncertain, repeat the same command and operation id.
6. Tell your person who received the request. It waits for the teammate to accept; it never prompts their agent directly.

Do not run `peer review` or `peer done` from this procedure.

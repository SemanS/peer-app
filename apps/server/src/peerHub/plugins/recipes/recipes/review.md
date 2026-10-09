---
title: Hand my task over for review
hint: "[reviewer email]"
access: write
requires: [requests]
---
Input: {{input}}

1. Read `peer status` and `peer context`. Ask your person for a missing task or reviewer; never guess. Check any changed input before accepting its new version with `peer ack <task>`.
2. Finish the requested work and relevant checks. Save the shared handoff context with the result, validation, pull request and anything uncertain. Read it back with `peer context`.
3. Run `peer review` only after the state is saved and checks pass. An input-version refusal means read and verify that input before retrying; do not bypass it.
4. If your person requested a teammate review, use `peer request <email> "<prompt>" --title "<task>: review"`, naming the saved context and pull request. Keep sent text on one line without $, backticks or backslashes.
5. Report what is ready and what is waiting. A review handoff does not mean the task is done; do not claim a merge you could not verify.

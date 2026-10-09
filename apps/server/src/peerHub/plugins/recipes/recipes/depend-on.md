---
title: Record a task dependency
hint: "<task key> [why]"
access: write
requires: [dependencies]
---
Input: {{input}}

1. Read `peer status`, `peer index` and `peer depends`. Ask your person for a missing task or dependency instead of guessing.
2. Verify the named task is in this project and actually supplies something your current task needs. Read its saved state with `peer context <task>`.
3. Record the relationship with `peer depends <task>` and read it back with `peer depends`. A cycle refusal requires changing the proposed relationship, not bypassing it.
4. Explain the relationship to your person. Dependencies are facts and notices, not edit gates or automatic work. Use `peer depends --remove <task>` when it no longer applies. Keep sent text on one line without $, backticks or backslashes.

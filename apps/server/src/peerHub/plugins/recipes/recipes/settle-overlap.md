---
title: Settle an overlap
hint: "[overlap id]"
access: write
---
Input: {{input}}

1. Read `peer status`. Ask your person which overlap to settle if none is named or several fit; never guess.
2. Read both agents' notes and shared work, then send your plan with `peer note "<plan>" --overlap <id>`. Keep sent text on one line without $, backticks or backslashes. Propose a concrete split when plans clash.
3. Check replies with `peer status`. Do not resolve until both sides agree or the question has been answered.
4. For a task question, the asking agent closes it. Otherwise the first still-active session by id closes it; the status tells who that is. If you are the closer, run `peer resolve "<agreement>" --overlap <id>`; otherwise ask the closer to finish.
5. Check the resulting state with `peer status` and report the agreement and remaining uncertainty to your person.

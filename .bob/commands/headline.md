---
description: Turn a news headline into a disruption proposal
argument-hint: "<headline text>"
---
Call `parse_headline` with: $1

Then, before reporting:

- If it matched a known place, call `list_at_risk` and say which shipments would
  plausibly be affected, and roughly when each would reach the zone.
- If it did NOT match a place, say so plainly and ask the operator for the
  location. Do not invent coordinates.

Present the draft, then stop. Raising the disruption is the operator's call.

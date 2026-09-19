---
description: Draft a GDP-style deviation report for a shipment
argument-hint: "<shipmentId>"
---
Call `get_excursion` and then `draft_deviation_report` for shipment $1.

Report it as a deviation record: what happened, the rule profile and version that
judged it, peak and minimum temperature, time in each band, mean kinetic
temperature, the diagnosed root cause, and the recommended disposition.

End with the line: "Draft only — requires a QA/Responsible Person signature."
Do not attempt to sign it. You will be refused, and correctly so.

# Known limitations

Written deliberately and kept current. Where a number on screen is ours rather
than a published figure it is tagged `[illustrative]` in the code as well.

## Data is illustrative where it says so

- **Rule profiles** carry a `confidence` tag and a `sourceTag`.
  `mrna_comirnaty_thawed` uses the real published thawed-storage figures. The
  others are shaped correctly but some thresholds are ours — the tag says which.
- **Duty rates and customs dwell** in `data/duty-rules.json` are illustrative
  throughout. The *direction* is real — vaccines are duty-free into many markets
  under the WTO Pharmaceutical Agreement — but no rate here should be quoted.
- **Costs, speeds and emission factors** are plausible orders of magnitude, not
  quoted tariffs.
- **The freeze threshold** of −0.5 °C sustained 60 minutes follows WHO PQS
  guidance; the per-product application of it is ours.

## What the compliance story is and is not

The audit log is **hash-chained and append-only**, so altering or deleting a
historic row is detectable by re-running `GET /api/v1/audit/verify`. That is
*tamper evidence*, not a signature: it does not prove who wrote a row, and an
attacker able to rewrite the whole collection could recompute the whole chain.

The product is **designed toward 21 CFR Part 11 principles**. It is not
validated, not qualified, and no part of this is a compliance claim.

MKT is computed and reported. It never lowers a severity and never closes an
excursion.

## Built, but shallow

- **Multi-leg cascade.** Shipments have real multi-leg routes and legs are
  seeded, but delay does not yet propagate from one leg to the next, and missed
  connections are not detected.
- **Carrier alternatives.** A catalogue with on-time record and certifications
  exists and a switch option is generated, but there is no learned per-lane
  excursion rate feeding back into the scorecard yet.
- **Approve.** Approving a recommendation records a signed, audited decision.
  It does not yet apply the option's actions to the world — so the map does not
  re-route on approval.
- **Replay mode.** `npm run record` produces a verifiable recording and
  `npm run demo` replays it, but the UI does not yet expose a scrub bar over a
  recording.

## Not built

- Multiple organisations, per-party views, and real authentication. The actor is
  a single named operator; IBM Bob is identified separately and refused any
  committing action. The custody *data* exists, the multi-tenant UI does not.
- Live weather or news ingestion. `parse_headline` structures a headline you
  paste; nothing polls an external feed.
- Notifications. Alerts are rows and socket events; there is no email, SMS or
  webhook.
- A deployed instance. `demo/live-demo-url.txt` says `NOT DEPLOYED`.

## Environment notes

- `next build` fails under WSL against a `node_modules` installed on Windows —
  `lightningcss` ships a per-platform native binary. Build on one OS.
- The in-memory database fallback downloads a MongoDB binary on first use and is
  therefore opt-in via `ENABLE_MEMORY_DB=1`. Without it and without MongoDB the
  server still boots and serves `/health`, and DB-backed routes return 503.

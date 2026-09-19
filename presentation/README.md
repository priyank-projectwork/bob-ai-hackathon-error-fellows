# Presentation

`slides.pptx` — four slides.

| # | Slide | What it says |
|---|---|---|
| 1 | **LIFECLOCK** | Cold-chain control tower, operated by IBM Bob. Team Error Fellows, Track AI. |
| 2 | **The problem** | A breach is found at the door, not in transit. Disruptions cascade faster than people can triage; cold-chain damage surfaces at delivery when the only question left is who pays. $500K+ per spoiled consignment · $10B+ for one major port event · 4–8 hrs to assemble a GDP deviation report by hand. |
| 3 | **The solution** | Every shipment has two deadlines and we compute both: a schedule clock (hours until late) and a stability clock (hours until the cargo is unusable). The smaller is its **life clock**. Predict before the breach, grade by rule matrix and MKT, reject routes that outlast the cargo, and let only a human commit. |
| 4 | **Architecture** | Pure engines with an injected clock — 165 tests, no I/O, no wall-clock reads. IBM Bob operates it over MCP and is refused when it tries to commit; the refusal lands in a hash-chained audit trail. The model never sets a severity, a clock value or a disposition. |

## Speaking it in 60 seconds

> A cold shipment has two deadlines: when it's late, and when it's dead. Most
> systems track the first. We compute both, and whichever is smaller is its
> life clock.
>
> That changes the answer. Holding a vessel on ship power freezes the stability
> clock while the schedule clock keeps running — so waiting can beat rerouting.
> And a route that's cheaper and faster gets rejected as infeasible when it
> outlasts the cargo, shown struck through with the shortfall rather than
> quietly dropped.
>
> Severity, disposition and the clock are decided by rule engines against
> versioned regulatory profiles. watsonx explains the conclusion afterwards,
> and the product is unchanged without it.
>
> IBM Bob operates the tower through twelve MCP tools — and when Bob tries to
> approve a decision it's refused, with the refusal written into a hash chain
> you can verify on screen. An agent may propose. Only a human commits.

## Exporting to PDF

The submission guide prefers `slides.pdf`. From PowerPoint: **File → Export →
Create PDF/XPS**, save as `presentation/slides.pdf`, and commit both.

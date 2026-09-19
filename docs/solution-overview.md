# Solution overview — LIFECLOCK

## The idea

A cold shipment has **two deadlines**.

- The **schedule clock** is hours until it is late.
- The **stability clock** is hours until the cargo is no longer usable.

Whichever is smaller is its **life clock**, and every engine in the product
reads it. That single number is the difference between a dashboard that shows
you temperature and a system that tells you how long you have to act.

## Why two clocks change the answer

They drain for different reasons, so they come apart — and when they do, the
right move is not the one a cost-and-time router would pick.

A vessel held at anchor on ship power is **not aging**: the stability clock
pauses while the schedule clock keeps running. So *waiting* can beat
*rerouting*, even though it arrives later.

And a route that is cheaper **and** faster is **rejected as infeasible** when
it outlasts the cargo. It is shown struck through with the shortfall —
"needs 38 h, cargo has 22 h" — rather than silently dropped, because "we
considered this and here is why it lost" is what a dispatcher actually needs.

## The four things the problem statement asks for

| Asked for | How it works |
|---|---|
| **Which shipments are affected** | Point-to-segment intersection against the **remaining** path, so a corridor running through a storm is caught even when both leg endpoints are clear — and "already past it" is distinguished from "enters in 6.2 h" |
| **Re-routing / carrier alternatives** | Dijkstra plus Yen's k-shortest over a 40-node, 18-lane network with blocked and delayed nodes. Options include do-nothing, wait-it-out, hold-at-cold-depot and carrier switch, priced on **landed cost**: freight + fees + customs dwell + duty + expected spoilage, with CO₂ |
| **Idle fleet redeployment** | Hard filters first — mode, temperature range, capacity, driver hours, maintenance, and whether it can physically arrive in time including **pre-cool**. Then a 0–100 score from six named factors, with every rejection carrying its reason |
| **Cold-chain excursions and regulatory severity** | A magnitude × duration matrix with a freeze override and cumulative band budgets, mean kinetic temperature per USP, a disposition, and who must sign it — all against a **versioned** rule profile that history is never re-judged under |

## Predict, don't detect

Detection after a breach is a receipt. LIFECLOCK fits Newton's law of cooling
over recent readings and says *"breach in 31 minutes, high confidence"* while
the cargo is still inside its range — which is what "before delivery" in the
problem statement actually requires.

The same physics drives the simulated world, so the predictor and the
telemetry generator agree because they model the same thing.

## Where the model is, and is not

**Severity, disposition and the clock are decided by rule engines.** The model
is asked afterwards to put the engine's conclusion into a sentence. Pull the
credentials and every number on screen is identical; only the prose changes.

This is checkable rather than claimed: the engines are pure functions with no
I/O and no wall-clock reads, they take `nowMs` as a parameter, and there are
165 tests over them.

## IBM Bob operates it

Twelve MCP tools served over Streamable HTTP from the backend process itself —
no second package, no file path in the config, no copy of the logic that can
drift.

The rule that matters: **an agent may read and propose, but not commit.**
Approving a recommendation, dispatching an asset and signing a disposition are
committing actions. Bob is refused whatever role it holds, and **the refusal is
written into a hash-chained audit trail** you can verify on screen.

The committing tools are deliberately present and wired. Watching Bob get
stopped is the point.

## Design decisions

| Decision | Alternative | Why |
|---|---|---|
| Two clocks, not one risk score | A single 0–100 risk number | A risk score cannot tell you *what to do*. Two clocks say which constraint binds, and that decides the action |
| Life clock as a **hard** routing constraint | A weighted factor among cost and time | A soft weight lets a fast, cheap route that spoils the cargo win. A constraint cannot |
| Rules decide, model explains | End-to-end LLM decisioning | Regulated decisions must be repeatable and inspectable. The product works with the model switched off |
| Rule profiles as versioned **data** | Thresholds in code | Editing a threshold must not silently rewrite how a past excursion was judged |
| Agent proposes, human commits | Autonomous dispatch | In a regulated cold chain the signature is the product. An agent that can sign is a liability, not a feature |
| Simulated clock everywhere | Real time | Lets a run be paused, accelerated, recorded and replayed — and makes every engine testable |

## What we are not claiming

The audit log is tamper-**evident**, not a signature. The product is *designed
toward* 21 CFR Part 11 principles; it is not validated or qualified. Duty rates
and dwell benchmarks are illustrative. See `docs/known-limitations.md`, which is
deliberately specific.

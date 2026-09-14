# Problem Statement

## Background

Pharmaceutical cold-chain logistics sits at the intersection of two disciplines that rarely talk to each other: supply chain operations and clinical quality assurance. Companies shipping vaccines, insulin, and biologics must simultaneously manage complex multi-leg freight networks — prone to weather events, port strikes, and geopolitical disruptions — while maintaining an unbroken temperature chain between 2°C and 8°C from manufacturer to patient. A single failure at either layer — a disrupted route or a temperature excursion — can destroy a shipment worth $500,000 or more.

## The Problem

Operations teams managing cold-chain pharmaceutical shipments face a **dual crisis** that compounds itself in real time:

**1. Disruption Blindness**  
When a port strike, blizzard, or hurricane hits, the operations team's first instinct is to open a spreadsheet. They have no tool that automatically maps which of their 50–200 active shipments are geographically exposed to the disruption, ranks them by urgency, and proposes alternative routes. The manual triage process takes 2–4 hours per major event — by which time refrigerated trucks have been sitting in queues for hours, idle fleet assets have already been deployed suboptimally, and delivery deadlines have silently passed.

**2. Cold-Chain Excursion Discovery After Delivery**  
IoT temperature sensors generate a reading every 5–10 minutes per shipment. A fleet of 100 active shipments produces 14,400–28,800 readings per day. No human team reviews these in real time. Excursions — temperature deviations that can spoil cargo — are discovered at the destination dock during receiving inspection, when nothing can be done. The GDP (Good Distribution Practice) guidelines require classifying each excursion as Minor, Major, or Critical based on magnitude and duration, and prescribing a disposition action (monitor, quarantine, discard). This classification today is performed manually by quality managers, often days after the event.

## Who Is Affected

- **Operations Control Tower Managers** at pharmaceutical 3PLs and distribution arms of major pharma companies (e.g., cold-chain logistics subsidiaries of global vaccine manufacturers). They own the network view and are accountable for on-time, intact delivery.
- **Cold-Chain / Quality Managers** responsible for regulatory compliance. They must produce excursion reports for FDA/EMA audits and make disposition decisions under time pressure.
- **Transport Planners** who manually re-plan routes when disruptions occur, currently using email threads and carrier phone calls.

## Why It Matters

- A single rejected vaccine shipment due to cold-chain failure: **$500K+ cargo loss** plus regulatory reporting burden
- A major port backlog event (e.g., 2021 LA/Long Beach): **$10B+ in global supply chain losses**; cold-chain cargo is among the highest-value and highest-urgency categories
- Manual excursion classification per GDP guidelines: **4–8 hours of quality manager time per incident**; at scale, this is untenable
- Late detection of disruption impact: **24–48 hour delay** in rerouting decisions, during which cold-chain integrity window is actively degrading

## Why Existing Solutions Fall Short

Current tools treat the two problems as entirely separate:

- **TMS (Transport Management Systems)** track shipments and planned routes but have no real-time disruption ingestion, no AI-driven impact scoring, and no cold-chain awareness.
- **IoT monitoring platforms** (e.g., Sensitech, Controlant) record temperature data and generate alerts but do not correlate excursions with disruption context, route position, or available remediation options.
- **Spreadsheet-based triage** is the de facto standard for disruption response — it requires manual lookup of every shipment's route, manual assessment of disruption geography, and manual matching of idle fleet assets.

No existing product provides a single interface that: (a) automatically detects which shipments are impacted by a disruption, (b) scores and ranks them by risk, (c) proposes ranked rerouting and fleet redeployment options, and (d) simultaneously monitors cold-chain telemetry and classifies excursions with regulatory-compliant severity — all in real time, with a natural-language AI layer that can explain every recommendation on demand.

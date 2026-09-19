/**
 * mcp/tools.js — what IBM Bob can actually do with LIFECLOCK.
 *
 * These are not wrappers around a REST API in another process: they call the
 * same services and engines the UI calls, in the same process. Bob reads the
 * same numbers the dispatcher sees.
 *
 * The rule that matters: **Bob may read and propose, but not commit.** Every
 * tool declares an `action`, and that action is checked against engines/policy.
 * `approve_recommendation` and `dispatch_asset` exist and are wired — and Bob
 * is refused when it calls them, with the refusal written into the hash-chained
 * audit trail. "The agent tried and was stopped" is evidence, not a slogan.
 */
"use strict";

const { z } = require("zod");

const Shipment = require("../models/Shipment");
const FleetAsset = require("../models/FleetAsset");
const Excursion = require("../models/Excursion");
const Disruption = require("../models/Disruption");
const Recommendation = require("../models/Recommendation");
const RuleProfile = require("../models/RuleProfile");

const coldChain = require("../services/coldChain");
const auditService = require("../services/audit");
const { can, statusFor, AGENT_ROLE } = require("../engines/policy");
const fleet = require("../engines/fleetMatcher");
const net = require("../data/network");

/** Bob identifies itself. Anything calling the MCP surface is an agent. */
const BOB = { sub: "bob", roles: [AGENT_ROLE] };

const text = (s) => ({ content: [{ type: "text", text: s }] });
const json = (o) => text(JSON.stringify(o, null, 2));

/**
 * Wrap a tool so that policy is enforced and every call is audited.
 * A refused call still returns a readable answer — Bob should understand why
 * it was stopped and what to do instead, not just see an error.
 */
function guarded(action, entityType, handler) {
  return async (args = {}) => {
    const verdict = can(BOB, action);

    if (!verdict.allowed) {
      await auditService.recordDenial({
        actor: BOB,
        action,
        entityType,
        entityId: args.shipmentId ?? args.recommendationId ?? args.assetId ?? null,
        reason: verdict.code,
      }).catch(() => {});
      return text(
        `REFUSED (${verdict.code}): ${verdict.message}\n\n` +
        `This action commits a change to the operational record. I can prepare it, ` +
        `show the trade-offs and draft the paperwork, but a human has to approve it ` +
        `in the LIFECLOCK console. The refusal has been written to the audit trail.`
      );
    }

    const result = await handler(args);

    await auditService.record({
      actor: BOB,
      action: "mcp_tool_call",
      entityType: "McpTool",
      entityId: action,
      outcome: "recorded",
      payload: { action, args },
    }).catch(() => {});

    return result;
  };
}

/** Everything Bob can do, with schemas. */
function toolDefinitions({ world }) {
  const nowMs = () => world.clock.now();

  return [
    // ── Read ──────────────────────────────────────────────────────────────
    {
      name: "list_at_risk",
      description:
        "List shipments ranked by how little usable cargo life they have left. " +
        "Use this first to find out what needs attention.",
      schema: { limit: z.number().int().min(1).max(50).optional() },
      action: "read_lifeclock",
      entityType: "Shipment",
      handler: async ({ limit = 10 }) => {
        const shipments = await Shipment.find({ status: "In Transit" }, { shipmentId: 1 }).lean();
        const rows = [];
        for (const s of shipments) {
          const lc = await coldChain.lifeClockFor(s.shipmentId, nowMs());
          if (lc) rows.push(lc);
        }
        rows.sort((a, b) => a.lifeClockH - b.lifeClockH);
        return json(rows.slice(0, limit).map((r) => ({
          shipmentId: r.shipmentId,
          lifeClockH: Number(r.lifeClockH.toFixed(1)),
          state: r.state,
          binding: r.bindingConstraint,
          severity: r.severity,
          usdAtRisk: Math.round(r.usdAtRisk),
          dosesAtRisk: r.dosesAtRisk,
        })));
      },
    },
    {
      name: "get_life_clock",
      description:
        "Both clocks for one shipment: hours until it is late (schedule) and hours " +
        "until the cargo is no longer usable (stability), plus which one binds.",
      schema: { shipmentId: z.string() },
      action: "read_lifeclock",
      entityType: "Shipment",
      handler: async ({ shipmentId }) => {
        const lc = await coldChain.lifeClockFor(shipmentId, nowMs());
        return lc ? json(lc) : text(`No shipment ${shipmentId}, or it has no rule profile.`);
      },
    },
    {
      name: "get_excursion",
      description:
        "A temperature excursion in full: severity and the rule that produced it, " +
        "MKT, root cause, which carrier held the cargo, and who must sign it off.",
      schema: { shipmentId: z.string().optional(), excursionId: z.string().optional() },
      action: "read_excursion",
      entityType: "Excursion",
      handler: async ({ shipmentId, excursionId }) => {
        const q = excursionId ? { _id: excursionId } : { shipmentId, status: "Open" };
        const exc = await Excursion.findOne(q).lean();
        return exc ? json(exc) : text("No matching excursion.");
      },
    },
    {
      name: "fleet_status",
      description:
        "Fleet utilisation: how many assets are idle, for how long, what that is " +
        "costing, and which have been idle longest.",
      schema: { base: z.string().optional() },
      action: "read_fleet",
      entityType: "FleetAsset",
      handler: async ({ base }) => {
        const q = base ? { homeBase: base } : {};
        const assets = await FleetAsset.find(q).lean();
        return json(fleet.utilisation(assets, { nowMs: nowMs() }));
      },
    },
    {
      name: "find_rescue_asset",
      description:
        "Rank idle assets that could rescue a shipment, with the reason each one " +
        "was accepted or rejected. Proposes only — dispatching needs a human.",
      schema: { shipmentId: z.string() },
      action: "read_fleet",
      entityType: "FleetAsset",
      handler: async ({ shipmentId }) => {
        const s = await Shipment.findOne({ shipmentId }).lean();
        if (!s) return text(`No shipment ${shipmentId}.`);
        const profile = s.tempProfileId ? await RuleProfile.findById(s.tempProfileId).lean() : null;
        const assets = await FleetAsset.find({ status: "Idle" }).lean();
        const r = fleet.rankFleetMatches({
          shipmentId,
          cargoType: s.cargoType,
          transportMode: s.transportMode || "Road",
          minTempC: profile?.minTempC,
          maxTempC: profile?.maxTempC,
          pickupPoint: s.currentLocation ? [s.currentLocation.lng, s.currentLocation.lat] : null,
        }, assets, { nowMs: nowMs() });
        return json({
          candidates: r.matches.slice(0, 5).map((m) => ({
            assetId: m.assetId, matchScore: m.matchScore, distanceKm: m.distanceKm,
            etaHours: m.etaHours, deadheadUsd: m.deadheadUsd, why: m.why,
          })),
          rejectedCount: r.rejected.length,
          sampleRejections: r.rejected.slice(0, 5),
        });
      },
    },
    {
      name: "world_status",
      description: "The simulated clock and how many shipments are moving.",
      schema: {},
      action: "read_world",
      entityType: "World",
      handler: async () => {
        const inTransit = await Shipment.countDocuments({ status: "In Transit" });
        const open = await Excursion.countDocuments({ status: "Open" });
        const active = await Disruption.countDocuments({ status: "Active" });
        return json({ ...world.status(), shipmentsInTransit: inTransit, openExcursions: open, activeDisruptions: active });
      },
    },

    // ── Propose ───────────────────────────────────────────────────────────
    {
      name: "parse_headline",
      description:
        "Turn a news headline into a structured disruption proposal (type, place, " +
        "radius, expected duration). Returns a draft for a human to raise.",
      schema: { headline: z.string().min(8) },
      action: "parse_headline",
      entityType: "Disruption",
      handler: async ({ headline }) => {
        const h = headline.toLowerCase();
        const type =
          /strike|industrial action|walkout|stoppage/.test(h) ? "Strike" :
          /storm|hurricane|typhoon|blizzard|flood|cyclone/.test(h) ? "Weather" :
          /tariff|duty|customs|sanction|export control/.test(h) ? "Tariff" :
          /closure|blockade|conflict|attack|chokepoint/.test(h) ? "Geopolitical" :
          "Infrastructure";

        // Match a place we actually know, rather than inventing coordinates.
        const node = Object.entries(net.NODES).find(([id, n]) =>
          h.includes(n.name.toLowerCase()) || h.includes(id.toLowerCase())
        );

        return json({
          draft: {
            type,
            nodeId: node ? node[0] : null,
            place: node ? node[1].name : null,
            centre: node ? node[1].coords : null,
            radiusKm: type === "Weather" ? 250 : 60,
            expectedDurationHours: type === "Strike" ? 96 : type === "Weather" ? 48 : 168,
            confidence: node ? 0.8 : 0.3,
            sourceHeadline: headline,
          },
          note: node
            ? "Place matched against the known network. Raise it in the console to make it active."
            : "No known place matched — a human should set the location before raising this.",
        });
      },
    },
    {
      name: "draft_deviation_report",
      description:
        "Draft a GDP-style deviation report for an excursion: what happened, the " +
        "rule that judged it, the root cause, and the recommended disposition. " +
        "A draft only — a QA/Responsible Person signs the real one.",
      schema: { shipmentId: z.string() },
      action: "draft_deviation_report",
      entityType: "Excursion",
      handler: async ({ shipmentId }) => {
        const exc = await Excursion.findOne({ shipmentId }).sort({ startedAt: -1 }).lean();
        if (!exc) return text(`No excursion recorded for ${shipmentId}.`);
        const s = await Shipment.findOne({ shipmentId }).lean();
        return json({
          draft: true,
          shipmentId,
          product: s?.cargoType,
          declaredValueUsd: s?.declaredValueUsd,
          doses: s?.doses,
          custodyCarrier: exc.custodyCarrier,
          judgedUnder: exc.ruleProfileRef,
          severity: exc.severity,
          irreversible: exc.irreversible,
          peakTempC: exc.peakTempC,
          minTempC: exc.minTempC,
          durationMin: Math.round(exc.durationMin ?? 0),
          bandMinutes: exc.bandMinutes,
          meanKineticTempC: exc.mktC,
          rootCause: exc.rootCause,
          rationale: exc.rationale,
          recommendedDisposition: exc.recommendedDisposition,
          mustBeSignedBy: exc.requiredRole,
          investigatorTodo: ["5-Why / Ishikawa", "extent-of-impact check", "CAPA"],
          caveat: "Draft generated from engine output. Not a signed regulatory record.",
        });
      },
    },
    {
      name: "morning_brief",
      description:
        "The shift handover: what is at risk, what changed, what is idle and what " +
        "it is costing. This is the daily-operations view, not a crisis view.",
      schema: {},
      action: "write_morning_brief",
      entityType: "Brief",
      handler: async () => {
        const shipments = await Shipment.find({ status: "In Transit" }, { shipmentId: 1 }).lean();
        const clocks = [];
        for (const s of shipments) {
          const lc = await coldChain.lifeClockFor(s.shipmentId, nowMs());
          if (lc) clocks.push(lc);
        }
        clocks.sort((a, b) => a.lifeClockH - b.lifeClockH);

        const assets = await FleetAsset.find({}).lean();
        const util = fleet.utilisation(assets, { nowMs: nowMs() });
        const open = await Excursion.find({ status: "Open" }).lean();
        const disruptions = await Disruption.find({ status: "Active" }).lean();

        return json({
          asOf: new Date(nowMs()).toISOString(),
          headline:
            `${clocks.filter((c) => c.state === "red" || c.state === "black").length} shipments need a decision today; ` +
            `${util.idle} assets idle costing $${util.idleCostUsd.toLocaleString()} so far.`,
          needsDecision: clocks.slice(0, 5).map((c) => ({
            shipmentId: c.shipmentId,
            lifeClockH: Number(c.lifeClockH.toFixed(1)),
            state: c.state,
            binding: c.bindingConstraint,
            usdAtRisk: Math.round(c.usdAtRisk),
          })),
          openExcursions: open.map((e) => ({
            shipmentId: e.shipmentId, severity: e.severity,
            cause: e.rootCause?.code, awaitingSignature: e.requiredRole,
          })),
          activeDisruptions: disruptions.map((d) => ({ type: d.type, title: d.title })),
          fleet: {
            utilisationPct: util.utilisationPct,
            idle: util.idle,
            idleCostUsd: util.idleCostUsd,
            longestIdle: util.longestIdle.slice(0, 3),
          },
        });
      },
    },

    // ── Commit — Bob is refused on these, by design ───────────────────────
    {
      name: "approve_recommendation",
      description:
        "Approve a recommendation so it takes effect. Committing action — an agent " +
        "cannot do this; it requires a human in the console.",
      schema: { recommendationId: z.string(), reason: z.string().optional() },
      action: "approve_recommendation",
      entityType: "Recommendation",
      handler: async ({ recommendationId }) => {
        const rec = await Recommendation.findById(recommendationId);
        if (!rec) return text("No such recommendation.");
        rec.status = "Approved";
        await rec.save();
        return text(`Approved ${recommendationId}.`);
      },
    },
    {
      name: "dispatch_asset",
      description:
        "Dispatch a fleet asset to a shipment. Committing action — an agent cannot " +
        "do this; it requires a human in the console.",
      schema: { assetId: z.string(), shipmentId: z.string() },
      action: "dispatch_asset",
      entityType: "FleetAsset",
      handler: async ({ assetId, shipmentId }) => {
        await FleetAsset.updateOne({ assetId }, { $set: { status: "Assigned", assignedShipmentId: shipmentId } });
        return text(`Dispatched ${assetId} to ${shipmentId}.`);
      },
    },
  ];
}

module.exports = { toolDefinitions, guarded, BOB };

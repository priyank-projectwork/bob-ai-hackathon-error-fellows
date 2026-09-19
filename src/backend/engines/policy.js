/**
 * policy.js — who is allowed to do what.
 *
 * The product's central rule: **an agent may propose, only a human may commit.**
 * IBM Bob can read everything, run what-ifs, draft reports and raise a
 * disruption for review. It cannot approve a recommendation, dispatch an asset
 * or sign a disposition. Those are committing actions and they require a human
 * actor. A refusal is not a silent no — it is recorded in the audit chain, so
 * "the agent tried and was stopped" is evidence, not a claim.
 *
 * PURE: no database, no network, no clock.
 */
"use strict";

/**
 * kind:
 *   "read"    — no side effect
 *   "propose" — creates a draft or a suggestion a human must act on
 *   "commit"  — changes the operational world or signs a regulatory record
 */
const ACTIONS = {
  read_world: { kind: "read" },
  read_lifeclock: { kind: "read" },
  read_excursion: { kind: "read" },
  read_fleet: { kind: "read" },
  read_audit: { kind: "read" },

  what_if: { kind: "propose" },
  parse_headline: { kind: "propose" },
  draft_deviation_report: { kind: "propose" },
  write_morning_brief: { kind: "propose" },
  trigger_disruption: { kind: "propose" },

  approve_recommendation: { kind: "commit" },
  reject_recommendation: { kind: "commit" },
  dispatch_asset: { kind: "commit" },
  sign_disposition: { kind: "commit", requiresRole: "qa_rp" },
};

/** Actors carrying this role are software agents, not people. */
const AGENT_ROLE = "operator-agent";

function isAgent(actor) {
  return Boolean(actor && Array.isArray(actor.roles) && actor.roles.includes(AGENT_ROLE));
}

/**
 * @param {object} actor  { sub, roles: [] }
 * @param {string} action key of ACTIONS
 * @returns {{allowed: boolean, code: string|null, message: string|null, kind: string}}
 */
function can(actor, action) {
  const spec = ACTIONS[action];
  if (!spec) {
    return { allowed: false, code: "unknown_action", message: `Unknown action '${action}'`, kind: "unknown" };
  }

  if (spec.kind === "commit" && isAgent(actor)) {
    return {
      allowed: false,
      code: "human_required",
      message:
        "This action commits a change to the operational record. An agent may propose it; a human must approve it.",
      kind: spec.kind,
    };
  }

  if (spec.requiresRole) {
    const roles = (actor && actor.roles) || [];
    if (!roles.includes(spec.requiresRole)) {
      return {
        allowed: false,
        code: "missing_role",
        message: `Requires role '${spec.requiresRole}'`,
        kind: spec.kind,
      };
    }
  }

  return { allowed: true, code: null, message: null, kind: spec.kind };
}

/** HTTP status a refusal should map to. */
function statusFor(code) {
  if (code === "human_required" || code === "missing_role") return 403;
  if (code === "unknown_action") return 400;
  return 403;
}

module.exports = { ACTIONS, AGENT_ROLE, can, isAgent, statusFor };

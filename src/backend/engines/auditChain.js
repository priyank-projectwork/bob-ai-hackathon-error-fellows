/**
 * auditChain.js — tamper-evident append-only audit log.
 *
 * Each event stores the hash of the event before it, so altering any historic
 * row breaks every hash after it. Verification walks the chain and reports the
 * first index where the recomputed hash stops matching.
 *
 * PURE: no database, no network, no wall-clock reads. The caller supplies
 * `at` (epoch ms) and persists whatever this returns.
 *
 * Honest scope: this makes tampering *detectable* by anyone who re-runs the
 * verification. It is not a signature — it does not prove *who* wrote a row,
 * and an attacker who can rewrite the whole collection can also recompute the
 * whole chain. Designed toward 21 CFR Part 11 principles; not a compliance
 * claim. See docs/regulatory-basis.md.
 */
"use strict";

const crypto = require("crypto");

const GENESIS = "0".repeat(64);

/**
 * Canonical JSON: keys sorted at every level so that two objects with the same
 * content always hash the same, whatever order they were built in.
 */
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}

/** The exact fields that are covered by the hash. Anything outside is not protected. */
function digestInput(event) {
  return canonical({
    at: event.at,
    actor: event.actor,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    outcome: event.outcome,
    payload: event.payload ?? null,
    prevHash: event.prevHash,
  });
}

function hashEvent(event) {
  return crypto.createHash("sha256").update(digestInput(event)).digest("hex");
}

/**
 * Build the next link in the chain.
 *
 * @param {object}  args
 * @param {number}  args.at          epoch ms — supplied by the caller, never read here
 * @param {object}  args.actor       { sub, roles } — who or what did it
 * @param {string}  args.action      e.g. "approve_recommendation"
 * @param {string}  args.entityType
 * @param {string}  args.entityId
 * @param {string}  args.outcome     "allowed" | "denied" | "recorded"
 * @param {object} [args.payload]
 * @param {string} [args.prevHash]   hash of the previous event, or null for the first
 * @returns {object} the event to persist, including seq/prevHash/hash
 */
function appendEvent({ at, actor, action, entityType, entityId, outcome, payload, prevHash, seq }) {
  const event = {
    seq: seq ?? 0,
    at,
    actor,
    action,
    entityType,
    entityId,
    outcome: outcome ?? "recorded",
    payload: payload ?? null,
    prevHash: prevHash ?? GENESIS,
  };
  event.hash = hashEvent(event);
  return event;
}

/**
 * Walk a chain in order and report the first break.
 * @returns {{valid: boolean, length: number, brokenAt: number|null, reason: string|null}}
 */
function verifyChain(events) {
  let prev = GENESIS;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.prevHash !== prev) {
      return { valid: false, length: events.length, brokenAt: i, reason: "prevHash mismatch" };
    }
    if (hashEvent(e) !== e.hash) {
      return { valid: false, length: events.length, brokenAt: i, reason: "content altered" };
    }
    prev = e.hash;
  }
  return { valid: true, length: events.length, brokenAt: null, reason: null };
}

module.exports = { appendEvent, verifyChain, hashEvent, canonical, GENESIS };

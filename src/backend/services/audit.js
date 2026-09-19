/**
 * services/audit.js — persistence layer for the hash-chained audit log.
 *
 * The chain maths lives in engines/auditChain.js (pure, tested). This module
 * only does the database part: find the tip, append, read back, verify.
 *
 * Appends are serialised through a promise queue so two concurrent requests
 * cannot both read the same tip and fork the chain.
 */
"use strict";

const AuditEvent = require("../models/AuditEvent");
const { appendEvent, verifyChain, GENESIS } = require("../engines/auditChain");

let queue = Promise.resolve();

/** Serialise appends so the chain cannot fork under concurrency. */
function withLock(fn) {
  const run = queue.then(fn, fn);
  // keep the queue alive even if one append fails
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function tip() {
  const last = await AuditEvent.findOne({ hash: { $ne: null } }).sort({ seq: -1 }).lean();
  return last || null;
}

/**
 * Append one event. `at` defaults to the current time here — this is the
 * persistence boundary, which is the one place a clock read is correct.
 */
async function record({ actor, action, entityType, entityId, outcome, payload, at }) {
  return withLock(async () => {
    const last = await tip();
    const event = appendEvent({
      seq: last ? (last.seq ?? 0) + 1 : 0,
      at: at ?? Date.now(),
      actor: { sub: actor?.sub ?? "system", roles: actor?.roles ?? [] },
      action,
      entityType,
      entityId,
      outcome,
      // Normalise an empty payload to null rather than {}: belt and braces
      // against any store that treats the two as interchangeable.
      payload: payload && Object.keys(payload).length ? payload : null,
      prevHash: last ? last.hash : GENESIS,
    });
    await AuditEvent.create({
      ...event,
      // keep the legacy columns populated so older UI code still renders
      actorType: event.actor.roles[0] || "system",
      actorId: event.actor.sub,
      eventType: action,
    });
    return event;
  });
}

/** Convenience for the refusal path — records that policy said no. */
async function recordDenial({ actor, action, entityType, entityId, reason }) {
  return record({
    actor,
    action,
    entityType,
    entityId,
    outcome: "denied",
    payload: { reason },
  });
}

async function list(limit = 50) {
  return AuditEvent.find().sort({ seq: -1 }).limit(limit).lean();
}

async function verify() {
  const all = await AuditEvent.find({ hash: { $ne: null } }).sort({ seq: 1 }).lean();
  return verifyChain(all);
}

module.exports = { record, recordDenial, list, verify, tip };

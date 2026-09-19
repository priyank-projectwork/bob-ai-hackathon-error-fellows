const mongoose = require("mongoose");

/**
 * Append-only, hash-chained audit event.
 *
 * `prevHash`/`hash` are produced by engines/auditChain.js. Rows are never
 * updated in place — altering one breaks verification from that row onward.
 * Legacy fields (actorType/actorId/eventType) are kept so pre-existing rows
 * still read, but new rows are written through services/audit.js.
 */
const auditEventSchema = new mongoose.Schema({
  seq: { type: Number, index: true },

  // Who or what acted. roles includes "operator-agent" when the actor is IBM Bob.
  actor: {
    sub: { type: String },
    roles: { type: [String], default: [] },
  },

  action: { type: String, index: true },
  entityType: { type: String },
  entityId: { type: String, index: true },

  // allowed  — a permitted action was carried out
  // denied   — policy refused it (this is the Bob-refusal evidence)
  // recorded — an observation, no permission question
  outcome: { type: String, enum: ["allowed", "denied", "recorded"], default: "recorded" },

  payload: { type: Object },

  prevHash: { type: String },
  hash: { type: String, index: true },

  at: { type: Number }, // epoch ms, supplied by the caller

  // ── legacy fields, retained so old rows still render ──
  actorType: { type: String },
  actorId: { type: String },
  eventType: { type: String },

  createdAt: { type: Date, default: Date.now },
}, {
  // Mongoose strips empty objects on save by default (minimize: true). That
  // silently turned a stored payload of {action, args:{}} into {action}, so
  // the hash recomputed on read no longer matched what was written and the
  // chain reported itself tampered with. Keep every key exactly as hashed.
  minimize: false,
});

module.exports = mongoose.model("AuditEvent", auditEventSchema);

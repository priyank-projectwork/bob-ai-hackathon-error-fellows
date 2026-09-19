const mongoose = require("mongoose");

/**
 * A rule profile is versioned DATA, not code.
 *
 * An excursion records the profileKey and version it was judged under and is
 * never re-classified by a later version — otherwise editing a threshold would
 * silently rewrite history, which is the opposite of what a regulated record is
 * for. Publishing a change creates version+1; the old version stays.
 *
 * Seeded from data/rule-profiles.json. `sourceTag` and `confidence` say how
 * much of each profile is a real published number and how much is ours; see
 * docs/regulatory-basis.md.
 */
const bandSchema = new mongoose.Schema({
  key: String,                 // freeze | cold | warm | hot | extreme
  minC: Number,
  maxC: Number,
  kind: { type: String, enum: ["freeze", "cold", "heat"] },
  budgetH: Number,             // cumulative hours allowed in this band
  drainMult: Number,           // DISPLAY ONLY — never enters budget accounting
  sharesBudgetWith: String,    // bands that draw from one pool
}, { _id: false });

const ruleProfileSchema = new mongoose.Schema({
  profileKey: { type: String, index: true },
  version: { type: Number, default: 1 },
  name: { type: String },
  confidence: { type: String, enum: ["verified", "partial", "mixed", "illustrative"] },
  sourceTag: { type: String },

  minTempC: { type: Number },
  maxTempC: { type: Number },
  setpointC: { type: Number },
  warningBandC: { type: Number },

  freeze: {
    sensitive: { type: Boolean, default: false },
    thresholdC: Number,
    sustainedMin: Number,
    note: String,
  },

  bands: [bandSchema],

  mkt: {
    reportWindowH: Number,
    limitC: Number,
    applies: { type: Boolean, default: true },
  },

  qaMarginH: { type: Number, default: 24 },
  packaging: { kind: String, holdQualH: Number, holdQualAmbientC: Number },
  sensor: {
    expectedIntervalMin: Number,
    silenceMultiplier: Number,
    escalateMultiplier: Number,
    spikeDeltaC: Number,
    stuckSamples: Number,
  },

  active: { type: Boolean, default: true },

  // ── legacy v1 fields, kept so older rows still load ──
  productType: { type: String },
  warningBand: { type: Number },
  durationRules: { thresholds: [{ maxMinutes: Number, severity: String }] },
  actions: [String],
});

ruleProfileSchema.index({ profileKey: 1, version: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("RuleProfile", ruleProfileSchema);

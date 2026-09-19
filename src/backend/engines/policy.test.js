"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert");
const { can, isAgent, statusFor, AGENT_ROLE } = require("./policy.js");

const BOB = { sub: "bob", roles: [AGENT_ROLE] };
const CONTROLLER = { sub: "controller-1", roles: ["controller"] };
const QA = { sub: "qa-1", roles: ["controller", "qa_rp"] };

describe("policy", () => {
  it("an agent may read", () => {
    assert.strictEqual(can(BOB, "read_lifeclock").allowed, true);
  });

  it("an agent may propose", () => {
    assert.strictEqual(can(BOB, "parse_headline").allowed, true);
    assert.strictEqual(can(BOB, "what_if").allowed, true);
    assert.strictEqual(can(BOB, "trigger_disruption").allowed, true);
  });

  it("an agent may NOT commit — this is the product's central rule", () => {
    const r = can(BOB, "approve_recommendation");
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(r.code, "human_required");
    assert.strictEqual(statusFor(r.code), 403);
  });

  it("an agent may not dispatch an asset", () => {
    assert.strictEqual(can(BOB, "dispatch_asset").allowed, false);
  });

  it("a human controller may commit an approval", () => {
    assert.strictEqual(can(CONTROLLER, "approve_recommendation").allowed, true);
  });

  it("signing a disposition needs the QA/Responsible Person role", () => {
    const r = can(CONTROLLER, "sign_disposition");
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(r.code, "missing_role");
    assert.strictEqual(can(QA, "sign_disposition").allowed, true);
  });

  it("an agent holding qa_rp is still refused — agency beats role", () => {
    const bobWithRole = { sub: "bob", roles: [AGENT_ROLE, "qa_rp"] };
    const r = can(bobWithRole, "sign_disposition");
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(r.code, "human_required");
  });

  it("unknown actions are refused, not defaulted open", () => {
    const r = can(QA, "launch_missiles");
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(r.code, "unknown_action");
  });

  it("isAgent identifies the agent role", () => {
    assert.strictEqual(isAgent(BOB), true);
    assert.strictEqual(isAgent(CONTROLLER), false);
    assert.strictEqual(isAgent(null), false);
  });
});

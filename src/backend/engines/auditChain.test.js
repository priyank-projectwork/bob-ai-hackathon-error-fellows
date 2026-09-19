"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert");
const { appendEvent, verifyChain, canonical, GENESIS } = require("./auditChain.js");

const AT = 1_700_000_000_000; // fixed epoch, never Date.now()
const HUMAN = { sub: "controller-1", roles: ["controller"] };

function buildChain(n) {
  const events = [];
  let prevHash = GENESIS;
  for (let i = 0; i < n; i++) {
    const e = appendEvent({
      seq: i,
      at: AT + i * 1000,
      actor: HUMAN,
      action: "approve_recommendation",
      entityType: "Recommendation",
      entityId: `REC-${i}`,
      outcome: "allowed",
      payload: { note: `event ${i}` },
      prevHash,
    });
    events.push(e);
    prevHash = e.hash;
  }
  return events;
}

describe("auditChain", () => {
  it("first event links to the genesis hash", () => {
    const [e] = buildChain(1);
    assert.strictEqual(e.prevHash, GENESIS);
    assert.match(e.hash, /^[0-9a-f]{64}$/);
  });

  it("a clean chain verifies", () => {
    const r = verifyChain(buildChain(5));
    assert.strictEqual(r.valid, true);
    assert.strictEqual(r.brokenAt, null);
    assert.strictEqual(r.length, 5);
  });

  it("altering a historic payload breaks the chain at that row", () => {
    const events = buildChain(5);
    events[2].payload = { note: "tampered" };
    const r = verifyChain(events);
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.brokenAt, 2);
    assert.strictEqual(r.reason, "content altered");
  });

  it("deleting a row breaks the link", () => {
    const events = buildChain(5);
    events.splice(2, 1);
    const r = verifyChain(events);
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.brokenAt, 2);
    assert.strictEqual(r.reason, "prevHash mismatch");
  });

  it("changing the actor is detected", () => {
    const events = buildChain(3);
    events[1].actor = { sub: "someone-else", roles: ["controller"] };
    assert.strictEqual(verifyChain(events).valid, false);
  });

  it("is deterministic — same input, same hash", () => {
    const a = buildChain(3);
    const b = buildChain(3);
    assert.deepStrictEqual(a.map((e) => e.hash), b.map((e) => e.hash));
  });

  it("canonical JSON is key-order independent", () => {
    assert.strictEqual(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
    assert.notStrictEqual(canonical({ a: 1 }), canonical({ a: 2 }));
  });

  it("an empty chain is valid", () => {
    assert.strictEqual(verifyChain([]).valid, true);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canClaim,
  canClose,
  canReopen,
  canReply,
  canTransfer,
  canView,
  clampLimit,
  derivePresence,
  formatProtocol,
  normalizePhone,
  previewText,
} from "./rules";

const agent = { memberId: "m1", permissions: ["chat.read", "chat.reply"] };
const other = { memberId: "m2", permissions: ["chat.read", "chat.reply"] };
const supervisor = { memberId: "m3", permissions: ["chat.read", "chat.reply", "chat.transfer"] };
const reader = { memberId: "m4", permissions: ["chat.read"] };

const queued = { assignedMemberId: null, status: "OPEN" as const };
const mine = { assignedMemberId: "m1", status: "OPEN" as const };
const closed = { assignedMemberId: "m1", status: "SOLVED" as const };

describe("inbox rules - visibility and actions", () => {
  it("attendants see the queue and their own conversations only", () => {
    assert.equal(canView(agent, queued), true);
    assert.equal(canView(agent, mine), true);
    assert.equal(canView(other, mine), false);
    assert.equal(canView(supervisor, mine), true);
  });

  it("requires chat.read to view anything", () => {
    assert.equal(canView({ memberId: "x", permissions: [] }, queued), false);
  });

  it("only users with chat.reply can claim, and only unassigned open conversations", () => {
    assert.equal(canClaim(agent, queued), true);
    assert.equal(canClaim(reader, queued), false);
    assert.equal(canClaim(agent, mine), false);
    assert.equal(canClaim(agent, { assignedMemberId: null, status: "SOLVED" }), false);
  });

  it("replies are limited to the assignee or a supervisor, never on closed conversations", () => {
    assert.equal(canReply(agent, mine), true);
    assert.equal(canReply(other, mine), false);
    assert.equal(canReply(supervisor, mine), true);
    assert.equal(canReply(agent, closed), false);
    assert.equal(canReply(reader, mine), false);
  });

  it("transfer: assignee or supervisor; close mirrors reply; reopen only closed", () => {
    assert.equal(canTransfer(agent, mine), true);
    assert.equal(canTransfer(other, mine), false);
    assert.equal(canTransfer(supervisor, mine), true);
    assert.equal(canTransfer(supervisor, closed), false);
    assert.equal(canClose(agent, mine), true);
    assert.equal(canReopen(agent, closed), true);
    assert.equal(canReopen(other, closed), false);
    assert.equal(canReopen(agent, mine), false);
  });
});

describe("inbox rules - helpers", () => {
  it("normalizes phones to digits and rejects implausible values", () => {
    assert.equal(normalizePhone("+55 (11) 99999-0001"), "5511999990001");
    assert.equal(normalizePhone("123"), null);
    assert.equal(normalizePhone("1".repeat(16)), null);
  });

  it("formats protocols deterministically", () => {
    assert.equal(formatProtocol(new Date("2026-03-09T10:00:00Z"), 42), "20260309-00042");
  });

  it("derives presence and treats stale heartbeats as offline", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const fresh = new Date(now.getTime() - 10_000);
    const stale = new Date(now.getTime() - 120_000);
    assert.equal(derivePresence(null, now), "OFFLINE");
    assert.equal(derivePresence({ isOnline: true, status: "ONLINE", lastSeenAt: fresh }, now), "ONLINE");
    assert.equal(derivePresence({ isOnline: true, status: "AWAY", lastSeenAt: fresh }, now), "AWAY");
    assert.equal(derivePresence({ isOnline: true, status: "ONLINE", lastSeenAt: stale }, now), "OFFLINE");
    assert.equal(derivePresence({ isOnline: false, status: "OFFLINE", lastSeenAt: fresh }, now), "OFFLINE");
  });

  it("clamps pagination and trims previews", () => {
    assert.equal(clampLimit(undefined), 30);
    assert.equal(clampLimit(5000), 100);
    assert.equal(clampLimit(-1), 30);
    assert.equal(previewText("  a   b \n c "), "a b c");
    assert.equal(previewText("x".repeat(200)).length, 120);
  });
});

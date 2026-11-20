// Synthetic fixtures test scheduling rules only. These are NOT live travel facts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePlan, validateTravelInput, openingWindows, modeFor } from "./scheduler.ts";
import type { TravelInput, TravelPlace } from "@workspace/api-zod";
import type { Matrix } from "./scheduler.ts";

const names = ["a", "b", "c", "d", "e", "f"];
const places: TravelPlace[] = names.map((id, i) => ({
  id, name: `테스트 장소 ${id}`, area: ["동네1", "동네1", "동네2", "동네2", "동네3", "동네3"][i],
  category: "테스트", description: "QA 전용 합성 데이터", googleId: `test-${id}`,
  openingHours: { periods: [0, 1, 2, 3, 4, 5, 6].map(day => ({ open: { day, hour: 9 }, close: { day, hour: 20 } })) },
}));
const matrix: Matrix = Object.fromEntries(places.flatMap(a => places.filter(b => b.id !== a.id).map(b => [
  `${a.id}:${b.id}`, { fromId: a.id, toId: b.id, status: "connected", distanceMeters: a.area === b.area ? 500 : 5000, durationSeconds: a.area === b.area ? 360 : 3600, polyline: "test-only" },
])));
const input: TravelInput = {
  startDate: "2026-11-16", endDate: "2026-11-18", spontaneity: 20,
  selectedIds: names, requiredIds: [], activityStart: "09:00", activityEnd: "19:00",
};

test("3 days and 6 places spread evenly and cluster by actual fixture routes", () => {
  const plan = generatePlan(input, places, matrix);
  assert.deepEqual(plan.days.map(d => d.visits.length), [2, 2, 2]);
  assert.equal(plan.unscheduled.length, 0);
  assert.ok(plan.days.every(d => new Set(d.visits.map(v => v.place.area)).size === 1));
});

test("fixed required dates/times retained; holiday collision warned, not deleted", () => {
  const modified = places.map(p => p.id === "a" ? {
    ...p, openingHours: { periods: p.openingHours!.periods!.filter(x => x.open?.day !== 1) },
  } : p);
  const plan = generatePlan({
    ...input, requiredIds: ["a", "b"],
    preferences: { a: { date: "2026-11-16", time: "10:00" }, b: { date: "2026-11-17", time: "14:00" } },
  }, modified, matrix);
  assert.equal(plan.days[0].visits.find(v => v.place.id === "a")?.startTime, "10:00");
  assert.ok(plan.days[0].visits.find(v => v.place.id === "a")?.warnings.some(w => w.includes("휴무 충돌")));
  assert.equal(plan.days[1].visits.find(v => v.place.id === "b")?.startTime, "14:00");
});

test("20% and 90% have different real density/free time; 100% has no forced appointments", () => {
  const planned = generatePlan(input, places, matrix);
  const spontaneous = generatePlan({ ...input, spontaneity: 90 }, places, matrix);
  const full = generatePlan({ ...input, spontaneity: 100, requiredIds: ["a", "b"], preferences: { a: { date: "2026-11-16", time: "10:00" } } }, places, matrix);
  assert.ok(spontaneous.days.flatMap(d => d.visits).length < planned.days.flatMap(d => d.visits).length);
  assert.ok(spontaneous.freePercent! > planned.freePercent!);
  assert.equal(full.days.flatMap(d => d.visits).length, 0);
  assert.equal(full.unscheduled.length, 6);
  assert.equal(full.freePercent, 100);
});

test("stay and order changes recalculate visit times and route ordering", () => {
  const fixed: TravelInput = { ...input, selectedIds: ["a", "b", "c"], requiredIds: ["a", "b", "c"], endDate: input.startDate, preferences: {
    a: { order: 0, stayMinutes: 60 }, b: { order: 1 }, c: { order: 2 },
  } };
  const before = generatePlan(fixed, places, matrix);
  const after = generatePlan({ ...fixed, preferences: { a: { order: 2, stayMinutes: 120 }, b: { order: 1 }, c: { order: 0 } } }, places, matrix);
  assert.deepEqual(before.days[0].legs.map(l => l.fromId + l.toId), ["ab", "bc"]);
  assert.deepEqual(after.days[0].legs.map(l => l.fromId + l.toId), ["cb", "ba"]);
  assert.equal(after.days[0].visits.find(v => v.place.id === "a")?.stayMinutes, 120);
  assert.notEqual(before.days[0].freeMinutes, after.days[0].freeMinutes);
});

test("unknown travel times are never fabricated; impossible fixed appointments remain visible", () => {
  const plan = generatePlan({ ...input, endDate: input.startDate, selectedIds: ["a", "b"], requiredIds: ["a", "b"], preferences: {
    a: { date: input.startDate, time: "10:00", stayMinutes: 120, order: 0 },
    b: { date: input.startDate, time: "10:30", order: 1 },
  } }, places, {});
  assert.equal(plan.days[0].freeMinutes, null);
  assert.ok(plan.days[0].visits[1].warnings.some(w => w.includes("충돌")));
  assert.equal(plan.days[0].visits.length, 2);
  assert.equal(plan.days[0].legs[0].status, "error");
  assert.equal(plan.days[0].legs[0].durationSeconds, undefined);
});

test("dates, bounds, hours and mode boundary validation", () => {
  assert.ok(validateTravelInput({ ...input, startDate: "" }, places));
  assert.ok(validateTravelInput({ ...input, endDate: "2026-11-15" }, places));
  assert.ok(validateTravelInput({ ...input, activityStart: "20:00", activityEnd: "09:00" }, places));
  assert.equal(openingWindows(places[0], "2026-11-16").known, true);
  assert.deepEqual([30, 31, 70, 71, 99, 100].map(v => modeFor(v).name), ["계획형", "균형형", "균형형", "즉흥형", "즉흥형", "완전 즉흥형"]);
});

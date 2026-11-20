import assert from "node:assert/strict";
import test from "node:test";
import { extractCastleFacts } from "./official-extract.ts";
import { applicableOfficial, officialUrlAllowed, verifyFact } from "./official-rules.ts";
import { generatePlan, openingWindows } from "./scheduler.ts";
import type { TravelOfficialFact, TravelOfficialResult, TravelPlace } from "@workspace/api-zod";
import { checkOfficial } from "./official.ts";

const dates = ["2026-11-16", "2026-12-28", "2026-12-29", "2027-01-01", "2027-01-02"];
const scope = "오사카성 천수각 일반 입장";
const fixture = {
  url: "https://www.osakacastle.net/guide/",
  text: "開館時間 9:00～18:00（入館は17:30まで） 休館日 12月28日～1月1日",
  html: "",
};
const result = (facts: TravelOfficialFact[]): TravelOfficialResult => ({
  placeId: "osaka-castle", status: "partial", checkedAt: new Date().toISOString(), requestedDates: dates,
  facts, sources: [], warnings: [], cached: false, webSearchUsed: true, model: "test-fixture",
});
const place: TravelPlace = {
  id: "osaka-castle", name: "오사카성", area: "성", category: "관광", description: "합성 검증 자료",
};

test("only exact HTTPS official domains are accepted; lookalike/subdomain/credentials rejected", () => {
  assert.ok(officialUrlAllowed("osaka-castle", fixture.url));
  for (const u of ["http://www.osakacastle.net/", "https://osakacastle.net.evil.com/", "https://evil.osakacastle.net/", "https://user@osakacastle.net/"]) {
    assert.equal(officialUrlAllowed("osaka-castle", u), false);
  }
});

test("labelled freshly fetched source fields distinguish closing/last entry and annual cross-year holidays", () => {
  const facts = extractCastleFacts([fixture], dates);
  assert.equal(facts.find(f => f.field === "openingHours")?.closeTime, "18:00");
  assert.equal(facts.find(f => f.field === "lastAdmission")?.time, "17:30");
  assert.deepEqual(facts.find(f => f.field === "regularClosed")?.closedDates, dates.slice(1, 4));
  assert.deepEqual(extractCastleFacts([{ ...fixture, text: "정보 없음" }], dates), []);
});

test("missing literal evidence and closing masquerading as last admission stay unknown", () => {
  const fact: TravelOfficialFact = {
    field: "lastAdmission", status: "verified", text: "주장", scope, appliesToDates: [dates[0]],
    sourceUrl: fixture.url, quote: "9:00～18:00（入館は17:30まで）", time: "18:00",
  };
  assert.equal(verifyFact(fact, fixture, dates).status, "unknown");
  assert.equal(verifyFact({ ...fact, time: "17:30" }, fixture, dates).status, "verified");
  assert.equal(verifyFact({ ...fact, quote: "임의 생성된 인용문" }, fixture, dates).status, "unknown");
  const quote = "予約販売締切 2025年11月16日";
  assert.equal(verifyFact({
    ...fact, field: "reservationDeadline", quote, time: undefined, deadlineDate: "2026-11-16",
  }, { url: fixture.url, text: quote }, dates).status, "unknown", "last year's deadline must not be reused");
});

test("verified closure and last admission constrain schedule without deleting fixed required visits", () => {
  const facts = extractCastleFacts([fixture], dates);
  const p = { ...place, official: result(facts) };
  assert.deepEqual(openingWindows(p, "2026-12-29"), { known: true, intervals: [], regular: false });
  const input = {
    startDate: dates[0], endDate: dates[0], spontaneity: 20, activityStart: "09:00", activityEnd: "21:00",
    selectedIds: [p.id], requiredIds: [p.id], preferences: { [p.id]: { time: "17:45", stayMinutes: 15 } },
  };
  const plan = generatePlan(input, [p], {});
  assert.equal(plan.days[0].visits.length, 1);
  assert.equal(plan.days[0].visits[0].startTime, "17:45");
  assert.ok(plan.days[0].visits[0].warnings.some(w => w.includes("최종 입장시간 충돌")));
  const holiday = generatePlan({ ...input, startDate: "2026-12-29", endDate: "2026-12-29" }, [p], {});
  assert.ok(holiday.days[0].visits[0].warnings.some(w => w.includes("휴무 충돌")));
});

test("conflicting, out-of-date, wrong travel date and non-general scoped facts cannot become constraints", () => {
  const f = extractCastleFacts([fixture], dates).find(f => f.field === "lastAdmission")!;
  assert.equal(applicableOfficial(result([f]), "lastAdmission", "2026-11-18").length, 0);
  assert.equal(applicableOfficial({ ...result([f]), checkedAt: "2020-01-01T00:00:00Z" }, "lastAdmission", dates[0]).length, 0);
  assert.equal(applicableOfficial(result([f, { ...f, status: "conflict" }]), "lastAdmission", dates[0]).length, 0);
  assert.equal(openingWindows({ ...place, official: result([{ ...f, field: "openingHours", openTime: "09:00", closeTime: "18:00", scope: "단체 프로그램" }]) }, dates[0]).known, false);
});

test("provider failure is explicit, short-cached and leaves rule-based generation usable (simulated outage)", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("{}", { status: 429, headers: { "content-type": "application/json" } }); };
  try {
    await assert.rejects(checkOfficial("kaiyukan", ["2026-11-23"]), /HTTP 429|미연동/);
    const first = calls;
    await assert.rejects(checkOfficial("kaiyukan", ["2026-11-23"]), /HTTP 429|미연동/);
    assert.equal(calls, first, "failure cache must avoid repeated provider requests");
    const plan = generatePlan({
      startDate: dates[0], endDate: dates[0], spontaneity: 20, activityStart: "09:00", activityEnd: "21:00",
      selectedIds: [place.id], requiredIds: [place.id], preferences: {},
    }, [place], {});
    assert.equal(plan.days[0].visits.length, 1);
  } finally { globalThis.fetch = original; }
});

// Run against the existing Preview proxy: node scripts/src/qa-osaka.mjs
// Uses real Places / Routes / Static Maps / one explicit OpenAI preference call.
// No credentials are read, printed or stored by this script.
import assert from "node:assert/strict";
import fs from "node:fs";
const root = process.env.QA_BASE_URL || "http://localhost:80";
const results = [];
async function call(path, data) {
  const r = await fetch(root + "/api/travel" + path, data ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    signal: AbortSignal.timeout(90000),
  } : { signal: AbortSignal.timeout(30000) });
  const body = await r.json();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${body.error ?? "request failed"}`);
  return body;
}
async function scenario(name, check) {
  try { results.push({ name, status: "PASS", evidence: await check() }); }
  catch (e) { results.push({ name, status: "FAIL", error: e.message }); }
}
const input = {
  startDate: "2026-11-16", endDate: "2026-11-18", spontaneity: 20,
  activityStart: "09:00", activityEnd: "21:00",
  selectedIds: ["dotonbori", "osaka-castle", "umeda-sky", "kuromon", "shinsekai", "shinsaibashi"],
  requiredIds: [], preferences: {},
};
let distributed;
await scenario("3일 6곳 날짜별 분산 및 실제 경로 기준 묶기", async () => {
  distributed = await call("/plan", input);
  assert.equal(distributed.days.flatMap(d => d.visits).length, 6);
  assert.ok(distributed.days.every(d => d.visits.length === 2));
  assert.ok(distributed.days.flatMap(d => d.legs).every(l => l.status === "connected"));
  return distributed.days.map(d => ({
    date: d.date, ids: d.visits.map(v => v.place.id), freeMinutes: d.freeMinutes,
    meters: d.legs.map(l => l.distanceMeters), seconds: d.legs.map(l => l.durationSeconds),
  }));
});
await scenario("필수 2곳의 날짜·시간 지정 유지", async () => {
  const p = await call("/plan", { ...input, requiredIds: ["osaka-castle", "umeda-sky"], preferences: {
    "osaka-castle": { date: "2026-11-16", time: "10:00", stayMinutes: 90 },
    "umeda-sky": { date: "2026-11-17", time: "14:00" },
  } });
  assert.equal(p.days[0].visits.find(v => v.place.id === "osaka-castle")?.startTime, "10:00");
  assert.equal(p.days[1].visits.find(v => v.place.id === "umeda-sky")?.startTime, "14:00");
  return p.days.flatMap(d => d.visits.filter(v => v.required).map(v => ({ date: d.date, id: v.place.id, time: v.startTime })));
});
await scenario("같은 6곳의 20%·90% 비교 및 100% 무강제", async () => {
  assert.ok(distributed);
  const p90 = await call("/plan", { ...input, spontaneity: 90 });
  const p100 = await call("/plan", { ...input, spontaneity: 100, requiredIds: ["osaka-castle"] });
  assert.ok(p90.days.flatMap(d => d.visits).length < 6);
  assert.ok(p90.freePercent > distributed.freePercent);
  assert.equal(p100.days.flatMap(d => d.visits).length, 0);
  return { at20: { visits: 6, freePercent: distributed.freePercent }, at90: { visits: p90.days.flatMap(d => d.visits).length, freePercent: p90.freePercent }, at100: { visits: 0, freePercent: p100.freePercent } };
});
const three = {
  ...input, endDate: "2026-11-16", selectedIds: ["dotonbori", "kuromon", "shinsaibashi"],
  requiredIds: ["dotonbori", "kuromon", "shinsaibashi"],
  preferences: { dotonbori: { order: 0 }, kuromon: { order: 1 }, shinsaibashi: { order: 2 } },
};
let route;
await scenario("3곳의 Google 지도·실제 도보 경로·이동시간", async () => {
  route = await call("/plan", three);
  const day = route.days[0];
  assert.equal(day.visits.length, 3);
  assert.equal(day.legs.length, 2);
  assert.ok(day.legs.every(l => l.status === "connected" && l.distanceMeters > 0 && l.durationSeconds > 0 && l.polyline));
  const image = await fetch(root + day.map.imageUrl);
  assert.equal(image.status, 200);
  assert.ok(image.headers.get("content-type").startsWith("image/"));
  const bytes = (await image.arrayBuffer()).byteLength;
  return { mapBytes: bytes, legs: day.legs.map(({ polyline, ...leg }) => leg) };
});
await scenario("체류시간·순서 변경 후 일정·경로 갱신", async () => {
  assert.ok(route);
  const changed = await call("/plan", { ...three, preferences: { shinsaibashi: { order: 0 }, kuromon: { order: 1 }, dotonbori: { order: 2, stayMinutes: 120 } } });
  assert.deepEqual(changed.days[0].visits.map(v => v.place.id), ["shinsaibashi", "kuromon", "dotonbori"]);
  assert.notEqual(changed.days[0].map.imageUrl, route.days[0].map.imageUrl);
  assert.notEqual(changed.days[0].freeMinutes, route.days[0].freeMinutes);
  return { order: changed.days[0].visits.map(v => v.place.id), previousFreeMinutes: route.days[0].freeMinutes, nextFreeMinutes: changed.days[0].freeMinutes };
});
await scenario("OpenAI 실제 요청 및 검증된 Google 사진", async () => {
  const ai = await call("/requests", { text: "활동 시작을 오전 11시로 바꿔 주세요. 다른 조건과 선택한 장소는 그대로 유지해 주세요.", input });
  assert.equal(ai.aiUsed, true);
  assert.equal(ai.input.activityStart, "11:00");
  const cat = await call("/catalog");
  const photoUrl = cat.places.find(p => p.photoUrl)?.photoUrl;
  assert.ok(photoUrl);
  const photo = await fetch(root + photoUrl);
  assert.equal(photo.status, 200);
  assert.ok(photo.headers.get("content-type").startsWith("image/"));
  await photo.arrayBuffer();
  return { aiUsed: ai.aiUsed, newActivityStart: ai.input.activityStart, photoHttp: photo.status };
});
results.push({
  name: "실제 장소의 확정 휴무일 충돌", status: "미실행",
  reason: "현재 조회한 장소에 확정 휴무일이 확인되지 않아 임의로 만들지 않음. 합성 회귀 테스트에서 휴무 충돌 경고·보존을 별도 검증.",
});
const output = { checkedAt: new Date().toISOString(), results };
fs.writeFileSync("/tmp/osaka-qa-live.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
process.exit(results.some(r => r.status === "FAIL") ? 1 : 0);

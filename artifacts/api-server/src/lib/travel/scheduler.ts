import type {
  TravelInput, TravelPlace, TravelLeg, TravelPlan, TravelDay, TravelVisit, TravelHours,
} from "@workspace/api-zod";
import { applicableOfficial } from "./official-rules.ts";

export type Matrix = Record<string, TravelLeg>;
type Windows = { known: boolean; intervals: [number, number][]; regular: boolean };
const DAY = 86_400_000;

export function dateStamp(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date ? value : null;
}

export function clock(value: string | undefined): number | null {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [h, m] = value.split(":").map(Number);
  return h <= 23 && m <= 59 ? h * 60 + m : null;
}
function time(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function modeFor(spontaneity: number) {
  if (spontaneity === 100) return { name: "완전 즉흥형", fraction: 0, capacity: 0 };
  if (spontaneity <= 30) return { name: "계획형", fraction: 0.85 - spontaneity / 30 * 0.15, capacity: 4 };
  if (spontaneity <= 70) return { name: "균형형", fraction: 0.65 - (spontaneity - 31) / 39 * 0.15, capacity: 3 };
  return { name: "즉흥형", fraction: 0.4 - (spontaneity - 71) / 28 * 0.3, capacity: spontaneity >= 85 ? 1 : 2 };
}

export function validateTravelInput(input: TravelInput, places: TravelPlace[]): string | null {
  if (!input.startDate || !input.endDate) return "여행 시작일과 종료일을 모두 선택해 주세요.";
  const start = dateStamp(input.startDate), end = dateStamp(input.endDate);
  if (start === null || end === null) return "올바른 여행 날짜를 입력해 주세요.";
  if (end < start) return "종료일은 시작일보다 빠를 수 없어요.";
  if ((end - start) / DAY >= 366) return "최대 366일의 여행을 지원해요.";
  if (!Number.isFinite(input.spontaneity) || input.spontaneity < 0 || input.spontaneity > 100) return "무계획력은 0~100%로 선택해 주세요.";
  if (!Array.isArray(input.selectedIds) || !Array.isArray(input.requiredIds)) return "장소 선택을 다시 확인해 주세요.";
  if (input.selectedIds.length > places.length || new Set(input.selectedIds).size !== input.selectedIds.length) return "같은 장소는 한 번만 선택해 주세요.";
  if (input.spontaneity < 100 && !input.selectedIds.length) return "한 곳 이상 선택해 주세요. 완전 즉흥형은 선택 없이도 만들 수 있어요.";
  if (input.selectedIds.some(id => !places.some(p => p.id === id))) return "목록에 있는 장소를 선택해 주세요.";
  if (input.requiredIds.some(id => !input.selectedIds.includes(id))) return "필수 장소는 선택한 장소 중에서 지정해 주세요.";
  const begin = clock(input.activityStart ?? "09:00"), finish = clock(input.activityEnd ?? "19:00");
  if (begin === null || finish === null || finish <= begin) return "활동 종료시간은 시작시간보다 늦게 설정해 주세요. 같은 날 기준이에요.";
  for (const [id, pref] of Object.entries(input.preferences ?? {})) {
    if (!input.selectedIds.includes(id)) continue;
    if (pref.date && dateStamp(pref.date) === null) return "장소의 지정 날짜를 확인해 주세요.";
    if (pref.time && clock(pref.time) === null) return "지정 방문시간은 올바른 시:분으로 입력해 주세요.";
    if (pref.stayMinutes !== undefined && (!Number.isFinite(pref.stayMinutes) || pref.stayMinutes < 15 || pref.stayMinutes > 1440)) return "체류시간은 15~1440분으로 설정해 주세요.";
    if (pref.order !== undefined && (!Number.isFinite(pref.order) || pref.order < 0 || pref.order > 1000)) return "방문 순서 값을 확인해 주세요.";
  }
  return null;
}

function pointDate(p: { date?: { year?: number; month?: number; day?: number } } | undefined): number | null {
  const d = p?.date;
  if (!d?.year || !d.month || !d.day) return null;
  return Date.UTC(d.year, d.month - 1, d.day);
}

export function googleOpeningWindows(place: TravelPlace, date: string): Windows {
  const target = dateStamp(date)!;
  const checkedDay = place.checkedAt
    ? dateStamp(new Date(Date.parse(place.checkedAt) + 9 * 3_600_000).toISOString().slice(0, 10))
    : null;
  const useCurrent = checkedDay !== null && target >= checkedDay && target < checkedDay + 7 * DAY &&
    place.currentHours?.periods !== undefined;
  const hours: TravelHours | undefined = useCurrent ? place.currentHours : place.openingHours;
  if (!hours?.periods) return { known: false, intervals: [], regular: !useCurrent };
  const intervals: [number, number][] = [];
  const weekday = new Date(target).getUTCDay();
  for (const period of hours.periods) {
    const open = period.open, close = period.close;
    if (!open) continue;
    // Google's documented always-open representation: Sunday 00:00, no close.
    if (!close && open.day === 0 && !open.hour && !open.minute) return { known: true, intervals: [[0, 1440]], regular: !useCurrent };
    if (!close) return { known: false, intervals: [], regular: !useCurrent };
    const start = (open.hour ?? 0) * 60 + (open.minute ?? 0);
    const end = (close.hour ?? 0) * 60 + (close.minute ?? 0);
    if (useCurrent) {
      const os = pointDate(open), cs = pointDate(close);
      if (os === null || cs === null) continue;
      const a = (os - target) / DAY * 1440 + start;
      const b = (cs - target) / DAY * 1440 + end;
      if (b > 0 && a < 1440) intervals.push([Math.max(a, 0), Math.min(b, 1440)]);
    } else {
      if (open.day === undefined || close.day === undefined) continue;
      for (const offset of [-7, 0, 7]) {
        const a = ((open.day - weekday) + offset) * 1440 + start;
        let duration = ((close.day - open.day + 7) % 7) * 1440 + end - start;
        if (duration <= 0) duration += 7 * 1440;
        const b = a + duration;
        if (b > 0 && a < 1440) intervals.push([Math.max(a, 0), Math.min(b, 1440)]);
      }
    }
  }
  return { known: true, intervals: intervals.sort((a, b) => a[0] - b[0]), regular: !useCurrent };
}

function officialFor(place: TravelPlace, field: "openingHours" | "regularClosed" | "temporaryClosed" | "lastAdmission", date: string) {
  return applicableOfficial(place.official, field, date).filter(f =>
    /(일반|general|normal)/i.test(f.scope) && !/(단체|group|프로그램|program|투어|tour)/i.test(f.scope));
}

export function openingWindows(place: TravelPlace, date: string): Windows {
  const google = googleOpeningWindows(place, date);
  const closed = [...officialFor(place, "regularClosed", date), ...officialFor(place, "temporaryClosed", date)]
    .some(f => f.closedDates?.includes(date));
  if (closed) return google.known && !google.regular && google.intervals.length
    ? { known: false, intervals: [], regular: false } : { known: true, intervals: [], regular: false };
  const hours = officialFor(place, "openingHours", date);
  const intervals = hours.flatMap(f => {
    const open = clock(f.openTime), close = clock(f.closeTime);
    return open !== null && close !== null && close > open ? [[open, close] as [number, number]] : [];
  });
  if (!intervals.length) return google;
  if (google.known && JSON.stringify(intervals) !== JSON.stringify(google.intervals))
    return { known: false, intervals: [], regular: false };
  return { known: true, intervals, regular: false };
}

function routeBetween(matrix: Matrix, from: TravelPlace, to: TravelPlace): TravelLeg {
  return matrix[`${from.id}:${to.id}`] ?? { fromId: from.id, toId: to.id, status: "error", error: "실제 경로 미연동 · 이동거리·시간 확인 필요" };
}
function distance(matrix: Matrix, from: TravelPlace, to: TravelPlace): number | undefined {
  const r = routeBetween(matrix, from, to);
  return r.status === "connected" ? r.distanceMeters : undefined;
}

function orderedVisits(date: string, list: TravelPlace[], input: TravelInput, matrix: Matrix): TravelPlace[] {
  const prefs = input.preferences ?? {};
  if (list.some(p => prefs[p.id]?.order !== undefined)) {
    return [...list].sort((a, b) => (prefs[a.id]?.order ?? 500) - (prefs[b.id]?.order ?? 500));
  }
  const fixed = list.filter(p => prefs[p.id]?.time).sort((a, b) => clock(prefs[a.id].time)! - clock(prefs[b.id].time)!);
  // At most eight places: exhaustive order search respects appointments and actual routes.
  let best = [...list], bestScore = Infinity;
  const dfs = (path: TravelPlace[], left: TravelPlace[], score: number) => {
    if (score >= bestScore) return;
    if (!left.length) {
      let cursor = clock(input.activityStart ?? "09:00")!;
      let penalty = 0;
      path.forEach((p, i) => {
        const pref = prefs[p.id] ?? {};
        if (i) cursor += Math.ceil((routeBetween(matrix, path[i - 1], p).durationSeconds ?? 0) / 60);
        const stay = pref.stayMinutes ?? 60;
        const hours = openingWindows(p, date);
        let begin = pref.time ? clock(pref.time)! : cursor;
        if (!pref.time && hours.known && hours.intervals.length) {
          const interval = hours.intervals.find(([a, b]) => Math.max(a, cursor) + stay <= b);
          if (interval) begin = Math.max(cursor, interval[0]);
        }
        if (begin < cursor) penalty += 10_000_000;
        if (begin + stay > clock(input.activityEnd ?? "19:00")!) penalty += 10_000_000;
        if (hours.known && !hours.intervals.some(([a, b]) => begin >= a && begin + stay <= b)) penalty += 10_000_000;
        const cutoff = officialFor(p, "lastAdmission", date).map(f => clock(f.time)).filter((v): v is number => v !== null);
        if (cutoff.length && begin > Math.min(...cutoff)) penalty += 10_000_000;
        cursor = Math.max(cursor, begin + stay);
      });
      if (score + penalty < bestScore) { best = path; bestScore = score + penalty; }
      return;
    }
    for (const p of left) {
      if (fixed.includes(p) && fixed.some(f => clock(prefs[f.id].time)! < clock(prefs[p.id].time)! && !path.includes(f))) continue;
      const prev = path[path.length - 1];
      const d = prev ? distance(matrix, prev, p) : 0;
      const routeCost = d ?? (prev?.area === p.area ? 1000 : 5000);
      // Unknown-route area grouping is only a heuristic, never presented as distance.
      dfs([...path, p], left.filter(x => x.id !== p.id), score + routeCost + (routeCost >= 10000 ? 1_000_000 : 0));
    }
  };
  dfs([], list, 0);
  return best;
}

export function scheduleDay(date: string, list: TravelPlace[], input: TravelInput, matrix: Matrix): TravelDay {
  const activityStart = clock(input.activityStart ?? "09:00")!;
  const activityEnd = clock(input.activityEnd ?? "19:00")!;
  const mode = modeFor(input.spontaneity);
  const ordered = orderedVisits(date, list, input, matrix);
  const visits: TravelVisit[] = [];
  const legs: TravelLeg[] = [];
  const warnings: string[] = [];
  let cursor = activityStart, stayTotal = 0, travelTotal = 0, hasUnknownTravel = false;
  ordered.forEach((place, index) => {
    const pref = input.preferences?.[place.id] ?? {};
    const stay = Math.round(pref.stayMinutes ?? 60);
    const visitWarnings: string[] = [];
    let arrival = cursor;
    if (index) {
      const leg = routeBetween(matrix, ordered[index - 1], place);
      legs.push(leg);
      if (leg.status === "connected" && leg.durationSeconds !== undefined) {
        const minutes = Math.ceil(leg.durationSeconds / 60);
        arrival += minutes;
        travelTotal += minutes;
        if ((leg.distanceMeters ?? 0) >= 10000) {
          const message = `${ordered[index - 1].name} → ${place.name}: 실제 도보 경로가 10km 이상이에요. 날짜·순서를 조정하거나 다른 교통수단을 확인해 주세요.`;
          warnings.push(message);
          visitWarnings.push(message);
        }
      } else {
        hasUnknownTravel = true;
        visitWarnings.push("실제 이동 경로·시간 미연동. 다음 방문시각과 자유시간을 확정할 수 없어요.");
        warnings.push(leg.error ?? "Google Routes 오류 · 실제 이동시간 확인 필요");
      }
    }
    const hours = openingWindows(place, date);
    let begin = pref.time ? clock(pref.time)! : arrival;
    if (!pref.time && hours.known && hours.intervals.length) {
      const possible = hours.intervals.find(([open, close]) => Math.max(arrival, open) + stay <= close);
      if (possible) begin = Math.max(arrival, possible[0]);
    }
    if (pref.time && begin < arrival) visitWarnings.push("지정시간 충돌: 앞 일정과 실제 이동시간을 고려하면 도착할 수 없어요. 지정시간은 바꾸지 않았어요.");
    if (begin < activityStart || begin + stay > activityEnd) visitWarnings.push("활동시간 충돌: 설정한 활동시간 밖이에요. 임의로 삭제하지 않았어요.");
    if (place.businessStatus && place.businessStatus !== "OPERATIONAL") visitWarnings.push("Google에서 영업 중단 상태로 조회되었어요. 방문 전 확인이 필요해요.");
    if (!hours.known) visitWarnings.push("운영시간·휴무 확인 필요. 방문 가능한 시간으로 확정하지 않았어요.");
    else if (!hours.intervals.length) visitWarnings.push("휴무 충돌: 확인된 Google 또는 공식 운영정보상 이 날짜의 영업 구간이 없어요.");
    else if (!hours.intervals.some(([open, close]) => begin >= open && begin + stay <= close))
      visitWarnings.push("운영 종료시간 충돌: 체류 전체가 확인된 운영시간 안에 들어가지 않아요.");
    if (hours.regular && hours.known) visitWarnings.push("정규 운영시간 기준 초안이에요. 해당 여행일의 임시 휴무는 확인 필요.");
    const officialHours = officialFor(place, "openingHours", date);
    if (!hours.known && googleOpeningWindows(place, date).known && officialHours.length)
      visitWarnings.push("공식·Google 운영정보 충돌: 자동 확정하지 않았어요. 공식 출처와 여행 날짜를 다시 확인해 주세요.");
    const cutoff = officialFor(place, "lastAdmission", date).map(f => clock(f.time)).filter((n): n is number => n !== null);
    if (cutoff.length) {
      if (begin > Math.min(...cutoff)) visitWarnings.push("최종 입장시간 충돌: 공식 출처로 확인된 마지막 입장 시각을 지났어요. 지정 조건은 유지했어요.");
    } else visitWarnings.push("최종 입장시간 확인 필요. 운영 종료시간과는 달라요.");
    const reservation = applicableOfficial(place.official, "reservation", date).find(f => f.reservationStatus && f.reservationStatus !== "unknown");
    if (!reservation) visitWarnings.push("예약 필요 여부·예약 기한 확인 필요.");
    else if (reservation.reservationStatus !== "unnecessary" && !applicableOfficial(place.official, "reservationDeadline", date).length)
      visitWarnings.push("확인된 예약 마감 날짜가 없어요. 공식 예약 페이지에서 확인해 주세요.");
    visits.push({
      place, required: input.requiredIds.includes(place.id), startTime: time(begin), endTime: time(begin + stay),
      stayMinutes: stay, warnings: visitWarnings,
    });
    stayTotal += stay;
    cursor = Math.max(cursor, begin + stay);
  });
  let freeMinutes = hasUnknownTravel ? null : Math.max(0, activityEnd - activityStart - stayTotal - travelTotal);
  const targetFreeMinutes = Math.round((activityEnd - activityStart) * (1 - mode.fraction));
  if (freeMinutes !== null && freeMinutes < targetFreeMinutes && visits.some(v => v.required)) warnings.push("필수·지정 일정을 유지하느라 목표 자유시간보다 적어요. 충돌을 확인해 주세요.");
  const conflicts = visits.filter(v => v.warnings.some(w => w.includes("충돌")));
  if (conflicts.length) {
    warnings.push(`${conflicts.length}곳에 시간·휴무 충돌이 있어요. 입력을 유지했으며 방문 가능으로 확정하지 않았어요.`);
    freeMinutes = null;
  }
  const title = ordered.length ? `${[...new Set(ordered.map(p => p.area))].join(" · ")} ${ordered[0].category === "테마파크" ? "설레는 하루" : "취향 산책"}` : "발길 닿는 대로, 자유로운 하루";
  return { date, title, visits, legs, freeMinutes, targetFreeMinutes, warnings: [...new Set(warnings)] };
}

export function generatePlan(input: TravelInput, places: TravelPlace[], matrix: Matrix): TravelPlan {
  const error = validateTravelInput(input, places);
  if (error) throw new Error(error);
  const start = dateStamp(input.startDate)!, end = dateStamp(input.endDate)!;
  const count = Math.round((end - start) / DAY) + 1;
  const dates = Array.from({ length: count }, (_, i) => new Date(start + i * DAY).toISOString().slice(0, 10));
  const buckets: TravelPlace[][] = dates.map(() => []);
  const selected = input.selectedIds.map(id => places.find(p => p.id === id)!);
  const unscheduled: TravelPlan["unscheduled"] = [];
  const warnings: string[] = [];
  const mode = modeFor(input.spontaneity);
  const prefs = input.preferences ?? {};
  const budget = clock(input.activityEnd ?? "19:00")! - clock(input.activityStart ?? "09:00")!;
  const defer = (place: TravelPlace, reason: string) => unscheduled.push({ place, required: input.requiredIds.includes(place.id), reason });
  if (input.spontaneity === 100) {
    selected.forEach(p => defer(p, "완전 즉흥형: 필수 표시와 지정 조건은 후보에 보관하고 사전 일정은 강제하지 않아요."));
    if (selected.length) warnings.push("100% 완전 즉흥형이에요. 필수 장소와 지정시간도 후보로만 보관했어요. 사전 배치를 원하면 99% 이하로 바꿔 주세요.");
  } else {
    // Explicit dates first. Impossible dates remain visible as unscheduled conflicts.
    const flexible: TravelPlace[] = [];
    for (const p of selected) {
      const date = prefs[p.id]?.date;
      if (date) {
        const day = dates.indexOf(date);
        if (day < 0) defer(p, `지정 날짜 충돌: ${date}는 여행 기간 밖이에요. 장소를 삭제하지 않았어요.`);
        else buckets[day].push(p);
      } else flexible.push(p);
    }
    // Required first; within equal priority, distant seeds separate regions.
    const remaining = [...flexible];
    const ideal = Math.max(1, Math.ceil(Math.min(selected.length, count * mode.capacity) / count));
    while (remaining.length) {
      const requiredPool = remaining.filter(p => input.requiredIds.includes(p.id));
      const pool = requiredPool.length ? requiredPool : remaining;
      const assigned = buckets.flat();
      const p = [...pool].sort((a, b) => {
        const separation = (q: TravelPlace) => assigned.length ? Math.min(...assigned.map(x => distance(matrix, x, q) ?? (x.area === q.area ? 0 : 5000))) : 0;
        return separation(b) - separation(a);
      })[0];
      remaining.splice(remaining.indexOf(p), 1);
      const required = input.requiredIds.includes(p.id);
      const explicit = !!prefs[p.id]?.time;
      const candidates: { index: number; score: number }[] = [];
      for (let i = 0; i < count; i++) {
        const trial = scheduleDay(dates[i], [...buckets[i], p], input, matrix);
        const v = trial.visits.find(v => v.place.id === p.id)!;
        const closed = v.warnings.some(w => w.includes("휴무 충돌") || w.includes("영업 중단"));
        const timeConflict = v.warnings.some(w => w.includes("충돌"));
        const stay = trial.visits.reduce((s, v) => s + v.stayMinutes, 0);
        const routeMinutes = trial.legs.reduce((s, l) => s + Math.ceil((l.durationSeconds ?? 0) / 60), 0);
        if (!required && !explicit && (closed || timeConflict || trial.visits.length > mode.capacity || stay + routeMinutes > budget * mode.fraction)) continue;
        const nearest = buckets[i].length
          ? Math.min(...buckets[i].map(q => distance(matrix, q, p) ?? (q.area === p.area ? 0 : 5000)))
          : 0;
        const routeViolations = trial.legs.filter(l => (l.distanceMeters ?? 0) >= 10000).length;
        const score = (closed ? 100_000_000 : 0) + (timeConflict ? 10_000_000 : 0) + routeViolations * 1_000_000 +
          Math.max(0, trial.visits.length - ideal) * 100_000 + buckets[i].length * 3000 + nearest;
        candidates.push({ index: i, score });
      }
      candidates.sort((a, b) => a.score - b.score);
      if (candidates.length) buckets[candidates[0].index].push(p);
      else defer(p, "운영시간·휴무·활동시간 또는 무계획력의 자유시간 목표에 맞는 자리가 없어요. 후보로 유지했어요.");
    }
    // Refine the greedy balanced grouping using actual route costs. A swap never
    // changes an explicitly pinned date or removes any required/selected place.
    const cost = (list: TravelPlace[], index: number) => {
      const day = scheduleDay(dates[index], list, input, matrix);
      const conflicts = day.visits.reduce((sum, v) => sum + v.warnings.filter(w => w.includes("충돌")).length, 0);
      const longLegs = day.legs.filter(l => (l.distanceMeters ?? 0) >= 10000).length;
      const meters = day.legs.reduce((sum, l) => sum + (l.distanceMeters ?? 5000), 0);
      const stay = day.visits.reduce((sum, v) => sum + v.stayMinutes, 0);
      const travel = day.legs.reduce((sum, l) => sum + Math.ceil((l.durationSeconds ?? 0) / 60), 0);
      const budgetViolation = stay + travel > budget * mode.fraction && list.some(p => !input.requiredIds.includes(p.id) && !prefs[p.id]?.date && !prefs[p.id]?.time);
      return conflicts * 100_000_000 + longLegs * 10_000_000 + (budgetViolation ? 1_000_000 : 0) + meters;
    };
    for (let iteration = 0; iteration < 20; iteration++) {
      let improved = false;
      for (let a = 0; a < count; a++) {
        if (!buckets[a].length) continue;
        for (let b = a + 1; b < count; b++) {
          if (!buckets[b].length) continue;
          const before = cost(buckets[a], a) + cost(buckets[b], b);
          let bestDelta = 0, swap: [number, number] | undefined;
          for (let ai = 0; ai < buckets[a].length; ai++) {
            if (prefs[buckets[a][ai].id]?.date) continue;
            for (let bi = 0; bi < buckets[b].length; bi++) {
              if (prefs[buckets[b][bi].id]?.date) continue;
              const aa = [...buckets[a]], bb = [...buckets[b]];
              [aa[ai], bb[bi]] = [bb[bi], aa[ai]];
              const delta = cost(aa, a) + cost(bb, b) - before;
              if (delta < bestDelta) { bestDelta = delta; swap = [ai, bi]; }
            }
          }
          if (swap) {
            [buckets[a][swap[0]], buckets[b][swap[1]]] = [buckets[b][swap[1]], buckets[a][swap[0]]];
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
  }
  const days = dates.map((date, i) => scheduleDay(date, buckets[i], input, matrix));
  for (const day of days) {
    if (day.visits.length && day.visits.every(v => v.place.lat !== undefined && v.place.lng !== undefined)) {
      // A compact daily route cannot always exist under fixed dates and appointments.
      if (day.legs.some(l => (l.distanceMeters ?? 0) >= 10000))
        day.warnings.push("실제 경로 기준 10km 미만으로 묶지 못한 구간이 있어요. 필수·지정 조건은 임의로 바꾸지 않았어요.");
    }
  }
  if (selected.some(p => !p.googleId)) warnings.push("일부 장소는 Google 정보 미연동이에요. 지역명 기준으로만 임시 묶었으며 실제 거리·운영 여부 확인이 필요해요.");
  return {
    days, unscheduled, warnings, mode: mode.name,
    freePercent: days.some(d => d.freeMinutes === null) ? null : Math.round(days.reduce((s, d) => s + (d.freeMinutes ?? 0), 0) / (budget * count) * 100),
    services: [], generatedAt: new Date().toISOString(),
  };
}

import type { TravelOfficialFact } from "@workspace/api-zod";

type Page = { url: string; text: string; html: string };
const clock = (h: string, m: string) => `${h.padStart(2, "0")}:${m}`;

/** Operator-specific labelled fields, extracted from the freshly fetched source, never seeded facts. */
export function extractCastleFacts(pages: Page[], dates: string[]): TravelOfficialFact[] {
  const guide = pages.find(p => /osakacastle\.net\/guide\/?(?:\?|$)/.test(p.url));
  if (!guide) return [];
  const text = guide.text.normalize("NFKC"), scope = "오사카성 천수각 일반 입장";
  const result: TravelOfficialFact[] = [];
  const closed = text.match(/休館日\s*(\d{1,2})月(\d{1,2})日\s*[~〜～\-]\s*(?:翌年)?(\d{1,2})月(\d{1,2})日/);
  const closedDates = closed ? dates.filter(date => {
    const n = Number(date.slice(5, 7)) * 100 + Number(date.slice(8, 10));
    const a = Number(closed[1]) * 100 + Number(closed[2]), b = Number(closed[3]) * 100 + Number(closed[4]);
    return a <= b ? n >= a && n <= b : n >= a || n <= b;
  }) : [];
  const openDates = dates.filter(d => !closedDates.includes(d));
  if (closed) result.push({
    field: "regularClosed", status: "verified", text: `公式案内: ${closed[0]}（정기 휴관 기간）`,
    scope, sourceUrl: guide.url, quote: closed[0], appliesToDates: dates, closedDates,
  });
  const hours = text.match(/開館時間\s*(\d{1,2})[:：](\d{2})\s*[~〜～\-]\s*(\d{1,2})[:：](\d{2})/);
  if (hours) result.push({
    field: "openingHours", status: "verified", text: `공식 일반 운영시간 ${clock(hours[1], hours[2])}–${clock(hours[3], hours[4])}. 별도 임시 공지 확인 필요.`,
    scope, sourceUrl: guide.url, quote: hours[0], appliesToDates: openDates,
    openTime: clock(hours[1], hours[2]), closeTime: clock(hours[3], hours[4]),
  });
  const last = text.match(/(?:入館は|最終入館)\s*(\d{1,2})[:：](\d{2})まで/);
  if (last) result.push({
    field: "lastAdmission", status: "verified", text: `공식 최종 입장 ${clock(last[1], last[2])}. 혼잡 시 매표 대기줄이 더 일찍 마감될 수 있어요.`,
    scope, sourceUrl: guide.url, quote: last[0], appliesToDates: openDates, time: clock(last[1], last[2]),
  });
  const home = pages.find(p => /osakacastle\.net\/(?:\?.*)?$/.test(p.url));
  const optional = home?.text.match(/予約サイトを通じて入館券の事前購入が可能です。/);
  if (home && optional) result.push({
    field: "reservation", status: "verified", text: "일반 입장권의 온라인 사전 구매는 선택 가능. 단체·감면 신청 및 별도 프로그램에는 적용하지 않아요.",
    scope, sourceUrl: home.url, quote: optional[0], appliesToDates: openDates, reservationStatus: "optional",
  });
  return result;
}

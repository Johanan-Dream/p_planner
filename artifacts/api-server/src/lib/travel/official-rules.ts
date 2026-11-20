import type { TravelOfficialFact, TravelOfficialResult } from "@workspace/api-zod";

// Official domains were independently checked against the operators' public sites.
// Do not broaden this allowlist using URLs supplied by the model.
export const officialSites: Record<string, { home: string; domain: string; scope: string; pages: string[] }> = {
  "osaka-castle": {
    home: "https://www.osakacastle.net/", domain: "osakacastle.net", scope: "오사카성 천수각 일반 입장",
    pages: ["https://www.osakacastle.net/guide/", "https://www.osakacastle.net/"],
  },
  kaiyukan: {
    home: "https://www.kaiyukan.com/", domain: "kaiyukan.com", scope: "가이유칸 일반 입장권",
    pages: ["https://www.kaiyukan.com/info/hours/", "https://www.kaiyukan.com/info/ticket/", "https://www.kaiyukan.com/info/faq/"],
  },
};

export function officialUrlAllowed(placeId: string, raw: string): boolean {
  try {
    const u = new URL(raw), domain = officialSites[placeId]?.domain;
    return !!domain && u.protocol === "https:" && !u.username && !u.password && !u.port &&
      (u.hostname === domain || u.hostname === `www.${domain}`);
  } catch { return false; }
}

export function plainText(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([a-f0-9]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}
export const normalizeEvidence = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

function quotedTime(quote: string, value?: string): boolean {
  if (!value || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
  const [h, m] = value.split(":").map(Number), q = normalizeEvidence(quote);
  return new RegExp(`(?:^|[^0-9])0?${h}(?::|時)0?${m}(?:分|[^0-9]|$)`).test(q);
}
function dateInQuote(date: string, quote: string): boolean {
  const [y, m, d] = date.split("-").map(Number), q = normalizeEvidence(quote);
  // A month/day copied from an old notice is not evidence for the requested year.
  // Annual date ranges are handled separately by the labelled operator-page parser.
  return q.includes(`${y}年${m}月${d}日`) || q.includes(date) ||
    q.includes(`${y}/${m}/${d}`) || q.includes(`${y}.${m}.${d}`);
}

/** A model answer alone is never evidence: verify domain, cited page and literal quote. */
export function verifyFact(fact: TravelOfficialFact, page: { url: string; text: string } | undefined, dates: string[]): TravelOfficialFact {
  const applicable = fact.appliesToDates.filter(d => dates.includes(d));
  const unknown = (reason: string): TravelOfficialFact => ({
    field: fact.field, status: fact.status === "conflict" ? "conflict" : "unknown",
    text: `확인 필요: ${reason}`, scope: fact.scope || "적용 범위 확인 필요", appliesToDates: applicable,
  });
  if (fact.status !== "verified") return unknown(fact.status === "conflict" ? "공식 정보 간 충돌" : "공식 근거 미확보");
  if (!page || !fact.quote || fact.quote.length < 8 || fact.quote.length > 1000 ||
    !normalizeEvidence(page.text).includes(normalizeEvidence(fact.quote))) return unknown("공식 원문에서 인용 근거를 재확인하지 못함");
  if (!fact.scope || !/(천수각|天守閣|museum|가이유칸|海遊館|kaiyukan)/i.test(fact.scope))
    return unknown("입장권·시설의 적용 범위가 불명확함");
  if (fact.field === "openingHours" && (!quotedTime(fact.quote, fact.openTime) || !quotedTime(fact.quote, fact.closeTime)))
    return unknown("운영 시각의 원문 근거 부족");
  if (fact.field === "lastAdmission" && (!quotedTime(fact.quote, fact.time) || !/(入館|入場|admission|entry|입장)/i.test(fact.quote)))
    return unknown("최종 입장 시각의 원문 근거 부족");
  if (fact.field === "lastAdmission" && fact.time) {
    const q = normalizeEvidence(fact.quote), [h, m] = fact.time.split(":").map(Number);
    if (!new RegExp(`(?:入館は|入場は|最終入館|最終入場|最終受付)[^0-9]{0,8}0?${h}[:時]0?${m}`).test(q))
      return unknown("폐장 시각과 별개인 최종 입장 문구를 확인하지 못함");
  }
  if (fact.field.startsWith("reservation") && /(免除|減免|引率|介護)/.test(fact.quote))
    return unknown("일반 입장과 다른 감면·면제 신청 범위임");
  if (fact.field === "reservation" && fact.reservationStatus === "required" && /(当日券|窓口|same.day|counter)/i.test(fact.quote))
    return unknown("현장 구매와 사전 예약 필수 여부의 구분이 불명확함");
  if (fact.field === "reservationDeadline" &&
    (!fact.deadlineDate || !dateInQuote(fact.deadlineDate, fact.quote)))
    return unknown("정확한 예약 마감 날짜가 확인되지 않음");
  const closedDates = (fact.closedDates ?? []).filter(d => dates.includes(d) && dateInQuote(d, fact.quote!));
  if (closedDates.length !== (fact.closedDates ?? []).length) return unknown("휴관일의 정확한 연도·날짜 근거 부족");
  return { ...fact, sourceUrl: page.url, appliesToDates: applicable, closedDates };
}

export function applicableOfficial(result: TravelOfficialResult | undefined, field: TravelOfficialFact["field"], date: string) {
  // Expired server results must not become lasting travel guarantees.
  if (!result || Date.now() - Date.parse(result.checkedAt) > 6 * 3_600_000) return [];
  if (result.facts.some(f => f.field === field && f.status === "conflict" &&
    (!f.appliesToDates.length || f.appliesToDates.includes(date)))) return [];
  return result.facts.filter(f => f.status === "verified" && f.field === field && f.appliesToDates.includes(date));
}

import { useState } from 'react';
import type { ReactNode } from 'react';
import { BadgeCheck, CircleAlert, ExternalLink, HelpCircle, Search, ShieldAlert } from 'lucide-react';
import { checkTravelOfficial } from '@workspace/api-client-react';
import type { TravelPlace, TravelOfficialResult, TravelOfficialFact } from '@workspace/api-client-react';
import { WEEK, travelClosedDates, dday, weeklyClosed } from '@/lib/place-hours';

const OFFICIAL_IDS = ['osaka-castle', 'kaiyukan'] as const;
type OfficialId = (typeof OFFICIAL_IDS)[number];
const MAX_DATES = 31;

const FIELD: Record<string, string> = {
  openingHours: '운영 시간', regularClosed: '정기 휴무', temporaryClosed: '임시 휴무',
  lastAdmission: '마지막 입장', reservation: '예약', reservationOpen: '예약 오픈', reservationDeadline: '예약 마감',
};
const RES: Record<string, string> = { required: '예약 필수', recommended: '예약 권장', optional: '예약 선택', unnecessary: '예약 불필요', unknown: '확인 필요' };

function Badge({ kind }: { kind: 'official' | 'google' | 'unknown' | 'conflict' }) {
  const m = {
    official: ['공식 확인', 'bg-[hsl(214_90%_93%)] text-[hsl(218_80%_32%)]', BadgeCheck],
    google: ['Google 제공', 'bg-[hsl(150_40%_92%)] text-[hsl(155_45%_25%)]', BadgeCheck],
    unknown: ['확인 필요', 'bg-[hsl(40_80%_92%)] text-[hsl(30_70%_30%)]', HelpCircle],
    conflict: ['출처 상충', 'bg-[hsl(4_80%_94%)] text-destructive', ShieldAlert],
  } as const;
  const [t, c, I] = m[kind];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${c}`}><I className="w-3 h-3" />{t}</span>;
}

function Row({ label, badge, children, testId }: { label: string; badge: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <div className="rounded-xl border border-[hsl(218_30%_88%)] bg-[hsl(216_40%_98%)] px-3 py-2" data-testid={testId}>
      <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">{label}</span>{badge}</div>
      <div className="mt-1 font-bold text-foreground">{children}</div>
    </div>
  );
}

const fmt = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : `${d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST`; };

function FactCard({ f, i }: { f: TravelOfficialFact; i: number }) {
  const kind = f.status === 'verified' ? 'official' : f.status === 'conflict' ? 'conflict' : 'unknown';
  const isClose = f.field === 'openingHours';
  return (
    <li className="rounded-xl border border-[hsl(218_30%_88%)] bg-card px-3 py-2" data-testid={`fact-official-${f.field}-${i}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <b>{FIELD[f.field] ?? f.field}</b><Badge kind={kind} />
        {f.field.startsWith('reservation') && f.reservationStatus && <span className="text-[10px] font-bold rounded-full bg-muted px-2 py-0.5">{RES[f.reservationStatus] ?? '확인 필요'}</span>}
      </div>
      <p className="mt-1">{f.status === 'unknown' ? '공식 출처에서 확인하지 못했어요.' : f.text}</p>
      {isClose && (f.openTime || f.closeTime) && <p className="mt-0.5 tabular-nums">개장 {f.openTime ?? '?'} · <b>폐장</b> {f.closeTime ?? '?'} <span className="text-muted-foreground">(폐장은 마지막 입장과 달라요)</span></p>}
      {f.field === 'lastAdmission' && f.time && <p className="mt-0.5 tabular-nums"><b>마지막 입장</b> {f.time}</p>}
      {f.closedDates?.length ? <p className="mt-0.5">휴무일: {f.closedDates.join(', ')}</p> : null}
      {f.field === 'regularClosed' && f.status === 'verified' && !f.closedDates?.length && f.appliesToDates.length > 0 &&
        <p className="mt-0.5">확인한 여행 날짜에는 이 정기 휴관 기간이 해당하지 않아요. 임시 휴관은 별도 확인해 주세요.</p>}
      {f.scope && <p className="mt-0.5 text-muted-foreground">적용 범위: {f.scope}</p>}
      {f.appliesToDates.length > 0 && <p className="text-muted-foreground">{f.field === 'regularClosed' ? '검토한 여행 날짜' : '적용 날짜'}: {f.appliesToDates.join(', ')}</p>}
      {f.appliesToDates.length === 0 && <p className="text-muted-foreground">적용 날짜 미확인 · 일정에는 반영하지 않아요.</p>}
      {f.quote && <blockquote className="mt-1 border-l-2 border-[hsl(218_60%_70%)] pl-2 italic text-muted-foreground">"{f.quote}"</blockquote>}
      {f.sourceUrl && <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-primary font-bold underline underline-offset-2 break-all" data-testid={`link-fact-source-${i}`}>출처 열기 <ExternalLink className="w-3 h-3" /></a>}
    </li>
  );
}

export function PlaceFacts({ p, tripDates, onVerified }: { p: TravelPlace; tripDates: string[]; onVerified: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<TravelOfficialResult | null>(null);
  const official = res ?? p.official ?? null;
  const canSearch = (OFFICIAL_IDS as readonly string[]).includes(p.id);
  const over = tripDates.length > MAX_DATES;

  const current = p.currentHours?.weekdayDescriptions;
  const regular = p.openingHours?.weekdayDescriptions;
  const weekly = weeklyClosed(p.openingHours);
  const closedDates = travelClosedDates(p, tripDates);

  const run = async () => {
    if (tripDates.length === 0) { setErr('여행 날짜를 먼저 정해 주세요. 날짜 없이 공식 정보를 찾지 않아요.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await checkTravelOfficial({ placeId: p.id as OfficialId, dates: tripDates.slice(0, MAX_DATES) });
      setRes(r); onVerified();
    } catch (e) {
      const d = (e as { data?: { error?: unknown } } | null)?.data;
      setErr(d && typeof d.error === 'string' ? d.error : e instanceof Error && e.message ? e.message : '공식 정보를 찾지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally { setBusy(false); }
  };

  const applies = (f: TravelOfficialFact) => f.appliesToDates.some(d => tripDates.includes(d));
  const resFact = official?.facts.find((f) => f.field === 'reservation' && applies(f));
  const resStatus = resFact?.status === 'verified' ? resFact.reservationStatus ?? 'unknown' : 'unknown';
  const deadline = official?.facts.find((f) => f.field === 'reservationDeadline' && f.status === 'verified' && applies(f) && f.deadlineDate && (f.reservationStatus ?? resStatus) !== 'unnecessary');
  const dd = deadline?.deadlineDate ? dday(deadline.deadlineDate) : null;

  return (
    <div className="mt-3 space-y-2 text-xs pop" data-testid={`facts-${p.id}`}>
      {p.error && <div className="rounded-xl bg-[hsl(40_80%_94%)] px-3 py-2 flex gap-1.5"><CircleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />실시간 정보 조회 실패: {p.error}</div>}
      {p.address && <p><span className="text-muted-foreground">주소 </span>{p.address}</p>}
      {p.businessStatus && <p><span className="text-muted-foreground">영업 상태 </span>{p.businessStatus === 'OPERATIONAL' ? '운영 중' : p.businessStatus} <Badge kind="google" /></p>}

      <div className="grid sm:grid-cols-2 gap-2">
        <Row label="조회 시점부터 7일 운영시간" badge={current?.length ? <Badge kind="google" /> : <Badge kind="unknown" />} testId={`hours-current-${p.id}`}>
          {current?.length ? <ul className="font-normal">{current.map((h) => <li key={h}>{h}</li>)}</ul> : '확인 필요'}
        </Row>
        <Row label="평소 운영 시간" badge={regular?.length ? <Badge kind="google" /> : <Badge kind="unknown" />} testId={`hours-regular-${p.id}`}>
          {regular?.length ? <ul className="font-normal">{regular.map((h) => <li key={h}>{h}</li>)}</ul> : '확인 필요'}
        </Row>
      </div>
      <Row label="정기 휴무 요일" badge={weekly.kind === 'unknown' ? <Badge kind="unknown" /> : <Badge kind="google" />} testId={`text-regular-closed-${p.id}`}>
        {weekly.kind === 'alwaysOpen' ? '요일별 운영시간에 24시간으로 등록 (특별 휴무 별도 확인)' : weekly.kind === 'closedDays' ? (weekly.days.length ? weekly.days.map((d) => WEEK[d] + '요일').join(', ') : '등록된 정기 휴무 요일 없음') : '확인 필요'}
      </Row>
      {closedDates.length > 0 && <div className="rounded-xl bg-[hsl(4_80%_95%)] text-destructive font-bold px-3 py-2" data-testid={`warning-closed-dates-${p.id}`}>선택한 날짜 중 Google 운영시간상 영업 구간 없음 (휴무 충돌): {closedDates.join(', ')}</div>}
      <p className="text-muted-foreground">임시 휴무·예약 여부는 Google 정보로 추측하지 않아요. 공식 출처에서 확인된 것만 보여 드려요.</p>

      <dl className="grid grid-cols-3 gap-1.5">
        <div className="rounded-xl bg-muted px-2 py-1.5"><dt className="text-muted-foreground">예약</dt><dd className="font-bold" data-testid={`text-reservation-${p.id}`}>{RES[resStatus]}</dd>{resFact?.status === 'verified' && resFact.scope && <dd className="text-[10px] text-muted-foreground">{resFact.scope}</dd>}</div>
        {resStatus !== 'unnecessary' && <div className="rounded-xl bg-muted px-2 py-1.5"><dt className="text-muted-foreground">예약 마감</dt><dd className="font-bold" data-testid={`text-deadline-${p.id}`}>{deadline?.deadlineDate ? <>{deadline.deadlineDate}{dd != null && <span className="ml-1 text-primary">{dd > 0 ? `D-${dd}` : dd === 0 ? 'D-DAY' : '마감 지남'}</span>}</> : '확인 필요'}</dd></div>}
        <div className="rounded-xl bg-muted px-2 py-1.5"><dt className="text-muted-foreground">마지막 입장</dt><dd className="font-bold">{official?.facts.find((f) => f.field === 'lastAdmission' && f.status === 'verified' && applies(f))?.time ?? '확인 필요'}</dd></div>
      </dl>

      <div className="flex flex-wrap gap-3">
        {p.officialUrl && <a href={p.officialUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-primary" data-testid={`link-official-${p.id}`}>공식 홈페이지 <ExternalLink className="w-3 h-3" /></a>}
        {p.websiteUrl && p.websiteUrl !== p.officialUrl && <a href={p.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-muted-foreground" data-testid={`link-website-${p.id}`}>Google 등록 웹사이트 (공식 여부 확인 필요) <ExternalLink className="w-3 h-3" /></a>}
        {official?.bookingUrl && <a href={official.bookingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-primary" data-testid={`link-booking-${p.id}`}>공식 예약 페이지 <ExternalLink className="w-3 h-3" /></a>}
      </div>

      {canSearch && (
        <div className="rounded-2xl border border-[hsl(218_50%_82%)] bg-[hsl(214_80%_97%)] p-3 space-y-2">
          <p className="font-bold text-sm text-foreground">공식 출처로 한 번 더 확인하기</p>
          <p className="text-muted-foreground">버튼을 눌렀을 때만 공식 사이트를 찾아봐요. 확인 결과는 초안을 바로 바꾸지 않고, 다음에 초안을 만들 때 조건으로 들어가요.</p>
          {over && <p className="font-bold text-[hsl(30_70%_30%)]" data-testid={`notice-max-dates-${p.id}`}>여행 날짜가 {tripDates.length}일이라 앞의 {MAX_DATES}일만 확인해요.</p>}
          <button type="button" onClick={run} disabled={busy} data-testid={`button-official-${p.id}`}
            className="rounded-full bg-primary text-primary-foreground px-4 py-2 font-bold inline-flex items-center gap-1.5 disabled:opacity-50 active:scale-95 transition-transform">
            <Search className="w-3.5 h-3.5" />{busy ? '공식 정보 찾는 중…' : '공식 정보 확인'}
          </button>
          {busy && <div className="skel h-14 rounded-xl" data-testid={`status-official-loading-${p.id}`} />}
          {err && <div role="alert" className="rounded-xl bg-[hsl(4_80%_95%)] text-destructive font-bold px-3 py-2" data-testid={`status-official-error-${p.id}`}>{err}</div>}
        </div>
      )}

      {official && (
        <div className="space-y-2" data-testid={`section-official-${p.id}`}>
          <p className="text-muted-foreground">공식 확인 {fmt(official.checkedAt)}{official.cached ? ' · 저장된 결과' : ''}{official.webSearchUsed ? ' · 웹 검색 사용' : ''}{official.model ? ` · ${official.model}` : ''}</p>
          {official.requestedDates.length > 0 && <p className="text-muted-foreground">확인한 날짜: {official.requestedDates.join(', ')}</p>}
          {official.warnings.length > 0 && <ul className="rounded-xl bg-[hsl(40_80%_94%)] px-3 py-2 list-disc pl-6">{official.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          {official.facts.length ? <ul className="space-y-1.5">{official.facts.filter(f => resStatus !== 'unnecessary' || f.field !== 'reservationDeadline').map((f, i) => <FactCard key={`${f.field}-${i}`} f={f} i={i} />)}</ul> : <p className="font-bold">확인된 공식 정보가 없어요. 모두 확인 필요예요.</p>}
          {official.sources.length > 0 && (
            <div><p className="text-muted-foreground">출처</p>
              <ol className="mt-1 space-y-1">{official.sources.map((s, i) => (
                <li key={s.url + i}><a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-2 break-all" data-testid={`link-source-${p.id}-${i}`}>[{i + 1}] {s.title || s.url} <ExternalLink className="w-3 h-3 shrink-0" /></a> <span className="text-muted-foreground">{s.verified ? '공식 확인' : '미확인 출처'} · {fmt(s.checkedAt)}</span></li>
              ))}</ol>
            </div>
          )}
        </div>
      )}
      {p.checkedAt && <p className="text-muted-foreground">Google 확인 시각 {fmt(p.checkedAt)}</p>}
    </div>
  );
}

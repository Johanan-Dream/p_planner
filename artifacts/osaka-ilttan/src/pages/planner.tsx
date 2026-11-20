import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Check, Plane, Search, X, CircleAlert, ExternalLink, Footprints, Info, MapPinOff, Plus, RotateCcw, Star, Sparkles, CalendarDays, Clock, Wand2 } from 'lucide-react';
import { PlaceFacts } from '@/components/place-facts';
import { ResetTripDialog } from '@/components/reset-trip-dialog';
import { places as localPlaces, validateInput } from '@/lib/planner';
import { buildTravelPlan, interpretTravelRequest, useGetTravelCatalog } from '@workspace/api-client-react';
import type { TravelInput, TravelPlan, TravelPlace, TravelService, TravelDay, TravelPreference } from '@workspace/api-client-react';

const KEY_V1 = 'ilttan-osaka-input-v1';
const KEY = 'ilttan-osaka-input-v2';
const DEFAULT: TravelInput = { startDate: '', endDate: '', spontaneity: 50, selectedIds: [], requiredIds: [], activityStart: '09:00', activityEnd: '21:00', preferences: {} };
const STEPS = ['날짜와 즉흥도', '장소 고르기', '꼭 갈 곳', '초안 보기'];
const TINTS = ['bg-[hsl(46_95%_82%)]', 'bg-[hsl(214_80%_90%)]', 'bg-[hsl(46_80%_90%)]', 'bg-[hsl(220_60%_86%)]'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function loadInput(): { input: TravelInput; error: string | null; restored: boolean } {
  try {
    const raw = window.localStorage.getItem(KEY) ?? window.localStorage.getItem(KEY_V1);
    if (!raw) return { input: DEFAULT, error: null, restored: false };
    const p = JSON.parse(raw);
    const ids = new Set(localPlaces.map((x) => x.id));
    const sel: string[] = Array.isArray(p.selectedIds) ? p.selectedIds.filter((i: unknown) => typeof i === 'string' && ids.has(i)) : [];
    const prefs: Record<string, TravelPreference> = {};
    if (p.preferences && typeof p.preferences === 'object') {
      for (const [k, v] of Object.entries(p.preferences as Record<string, TravelPreference>)) {
        if (!ids.has(k) || !v || typeof v !== 'object') continue;
        prefs[k] = {
          ...(typeof v.date === 'string' && v.date ? { date: v.date } : {}),
          ...(typeof v.time === 'string' && HHMM.test(v.time) ? { time: v.time } : {}),
          ...(typeof v.stayMinutes === 'number' && v.stayMinutes > 0 ? { stayMinutes: v.stayMinutes } : {}),
          ...(typeof v.order === 'number' ? { order: v.order } : {}),
        };
      }
    }
    return {
      input: {
        startDate: typeof p.startDate === 'string' ? p.startDate : '',
        endDate: typeof p.endDate === 'string' ? p.endDate : '',
        spontaneity: typeof p.spontaneity === 'number' ? Math.round(Math.min(100, Math.max(0, p.spontaneity))) : 50,
        selectedIds: sel,
        requiredIds: Array.isArray(p.requiredIds) ? p.requiredIds.filter((i: unknown) => sel.includes(i as string)) : [],
        activityStart: typeof p.activityStart === 'string' && HHMM.test(p.activityStart) ? p.activityStart : '09:00',
        activityEnd: typeof p.activityEnd === 'string' && HHMM.test(p.activityEnd) ? p.activityEnd : '21:00',
        preferences: prefs,
      },
      error: null,
      restored: true,
    };
  } catch {
    return { input: DEFAULT, error: '저장된 입력을 불러오지 못했어요. 이 브라우저에서는 입력이 저장되지 않을 수 있어요.', restored: false };
  }
}

function fmtDate(d: string) {
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt.getTime())) return d;
  return `${dt.getMonth() + 1}월 ${dt.getDate()}일 (${'일월화수목금토'[dt.getDay()]})`;
}
function tripDates(a: string, b: string) {
  const out: string[] = [];
  const s = Date.parse(a + 'T00:00:00Z'), e = Date.parse(b + 'T00:00:00Z');
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return out;
  for (let t = s; t <= e && out.length < 366; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
function mins(n: number) { const h = Math.floor(n / 60), m = n % 60; return h ? `${h}시간${m ? ` ${m}분` : ''}` : `${m}분`; }

export function modeOf(v: number) {
  if (v <= 30) return { t: '꼼꼼 플래너', d: '골라둔 곳을 촘촘히 배치하고 빈 시간을 적게 남겨요.' };
  if (v <= 70) return { t: '반반 여행자', d: '방문과 자유 시간을 반반 정도로 섞어요.' };
  if (v <= 99) return { t: '발길 따라', d: '꼭 갈 곳 위주로 넣고 빈 시간을 넉넉히 남겨요.' };
  return { t: '오늘의 기분대로', d: '억지로 방문지를 넣지 않아요. 장소를 하나도 안 골라도 괜찮아요.' };
}

function errMsg(e: unknown, fb: string) {
  const d = (e as { data?: { error?: unknown } } | null)?.data;
  if (d && typeof d.error === 'string') return d.error;
  return e instanceof Error && e.message ? e.message : fb;
}

function Mascot({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden>
      <ellipse cx="60" cy="108" rx="34" ry="5" fill="hsl(330 25% 22% / .08)" />
      <circle cx="60" cy="62" r="40" fill="hsl(28 70% 80%)" />
      <path d="M24 56 Q60 26 96 56 Q86 46 60 44 Q34 46 24 56Z" fill="hsl(330 30% 32%)" />
      <path d="M34 50 q6 -6 12 0 q6 -6 12 0 q6 -6 12 0 q6 -6 12 0" stroke="hsl(42 90% 75%)" strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle cx="46" cy="68" r="4" fill="hsl(330 25% 22%)" />
      <circle cx="74" cy="68" r="4" fill="hsl(330 25% 22%)" />
      <circle cx="38" cy="78" r="6" fill="hsl(352 80% 78%)" opacity=".8" />
      <circle cx="82" cy="78" r="6" fill="hsl(352 80% 78%)" opacity=".8" />
      <path d="M54 78 q6 6 12 0" stroke="hsl(330 25% 22%)" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M58 24 l4 -12 l6 4" stroke="hsl(160 40% 45%)" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Pill({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'blue' | 'muted' | 'bad' }) {
  const c = tone === 'warn' ? 'bg-[hsl(40_90%_94%)] text-[hsl(30_70%_30%)]' : tone === 'blue' ? 'bg-[hsl(218_80%_95%)] text-primary' : tone === 'bad' ? 'bg-[hsl(4_80%_95%)] text-destructive' : 'bg-[hsl(218_30%_94%)] text-muted-foreground';
  return <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${c}`}>{children}</span>;
}

function Alert({ children, tone = 'bad', testId }: { children: ReactNode; tone?: 'bad' | 'warn'; testId?: string }) {
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} data-testid={testId} className={`rounded-lg px-3.5 py-2.5 text-xs leading-relaxed flex gap-2 border ${tone === 'bad' ? 'bg-[hsl(4_80%_96%)] border-[hsl(4_70%_85%)] text-destructive font-bold' : 'bg-[hsl(40_90%_96%)] border-[hsl(40_70%_82%)] text-[hsl(30_60%_28%)]'}`}>
      <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" /><div className="min-w-0">{children}</div>
    </div>
  );
}

const serviceLabel = (s: TravelService) => {
  const ok = s.status === 'connected';
  const ai = /openai|ai/i.test(s.name);
  if (ai && ok) return '실제 요청 성공 · 선택 사용';
  if (ai && s.status === 'available') return '인증 확인 · AI 생성 미사용';
  if (s.status === 'partial') return '일부 연결 · 확인 필요';
  if (s.status === 'unchecked') return '아직 요청 전';
  return ok ? '연결됨' : s.status === 'unconfigured' || s.status === 'disabled' ? '미연동' : '오류';
};

function ServiceBar({ services, loading, failed }: { services?: TravelService[]; loading: boolean; failed: boolean }) {
  return (
    <details className="rounded-[10px] border border-[hsl(218_30%_88%)] bg-white px-4 py-2.5 text-xs" data-testid="status-integrations" open={failed || services?.some((s) => s.status === 'error') || undefined}>
      <summary className="cursor-pointer flex flex-wrap items-center gap-2 text-muted-foreground"><span className="font-bold text-foreground">데이터 연결 상태</span>{failed ? <Pill tone="bad"><MapPinOff className="w-3 h-3" />서버 연결 실패</Pill> : loading ? <span className="skel h-4 w-24 rounded" /> : <span>{services?.length ?? 0}개 서비스 · 펼쳐서 확인</span>}</summary>
      <p className="text-xs text-muted-foreground">일정 배치는 서버 <b className="text-foreground">규칙 기반</b>이에요. Google 장소·도보 경로·지도 정보를 붙이고, AI는 <b className="text-foreground">'AI로 요청 반영'·'공식 정보 확인'</b> 버튼을 눌렀을 때만 써요.</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {loading && <span className="skel h-5 w-48 rounded-full" />}
        {failed && <Pill tone="bad"><MapPinOff className="w-3 h-3" />서버 연결 실패 · 기본 장소 목록만 표시</Pill>}
        {services?.map((s) => (
          <span key={s.name} title={s.message} data-testid={`status-service-${s.name}`}>
            <Pill tone={s.status === 'connected' || s.status === 'available' ? 'blue' : s.status === 'unchecked' ? 'muted' : 'bad'}>{s.name} · {serviceLabel(s)}</Pill>
          </span>
        ))}
      </div>
      {!!services?.length && <ul className="mt-2 space-y-1 text-muted-foreground">{services.map(s => <li key={s.name}><b>{s.name}:</b> {s.message}</li>)}</ul>}
    </details>
  );
}

function project(lat: number, lng: number, zoom: number) {
  const s = Math.min(0.9999, Math.max(-0.9999, Math.sin((lat * Math.PI) / 180)));
  const scale = 256 * 2 ** zoom;
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
}

function directionsUrl(day: TravelDay) {
  const pts = day.visits.map((v) => (v.place.lat != null && v.place.lng != null ? `${v.place.lat},${v.place.lng}` : `${v.place.name} 오사카`));
  if (pts.length === 0) return null;
  if (pts.length === 1) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pts[0])}`;
  const q = new URLSearchParams({ api: '1', origin: pts[0], destination: pts[pts.length - 1], travelmode: 'walking' });
  if (pts.length > 2) q.set('waypoints', pts.slice(1, -1).join('|'));
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}

function DayMap({ day, di, active, onPick }: { day: TravelDay; di: number; active: string | null; onPick: (id: string) => void }) {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const url = directionsUrl(day);
  const m = day.map;
  useEffect(() => setStatus('loading'), [m?.imageUrl]);
  if (day.visits.length === 0) return null;
  const fallback = url && (
    <a href={url} target="_blank" rel="noreferrer" data-testid={`link-directions-${di}`} className="inline-flex items-center gap-1 text-xs font-bold text-primary underline underline-offset-4">
      Google 지도에서 도보 경로 열기 <ExternalLink className="w-3 h-3" />
    </a>
  );
  if (!m) return <div className="mx-4 mt-4 rounded-lg border border-dashed p-4 text-sm space-y-2" data-testid={`status-map-${di}`}><p className="font-bold flex gap-1.5 items-center"><MapPinOff className="w-4 h-4" />이 날의 지도는 연결되지 않았어요.</p>{fallback}</div>;
  const c = project(m.lat, m.lng, m.zoom);
  return (
    <div className="mx-4 mt-4">
      <div className="relative w-full overflow-hidden rounded-lg border bg-muted" style={{ aspectRatio: '640 / 360' }}>
        {status === 'loading' && <div className="absolute inset-0 skel" />}
        {status !== 'error' && (
          <img src={m.imageUrl} alt={`${di + 1}일차 도보 경로 지도`} className="absolute inset-0 w-full h-full object-cover" onLoad={() => setStatus('ok')} onError={() => setStatus('error')} data-testid={`img-map-${di}`} />
        )}
        {status === 'error' && <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm" data-testid={`status-map-${di}`}><div className="space-y-2"><p className="font-bold text-destructive">지도 이미지를 불러오지 못했어요.</p>{fallback}</div></div>}
        {status === 'ok' && day.visits.map((v, i) => {
          if (v.place.lat == null || v.place.lng == null) return null;
          const w = project(v.place.lat, v.place.lng, m.zoom);
          const px = w.x - c.x + 320, py = w.y - c.y + 180;
          if (px < 0 || px > 640 || py < 0 || py > 360) return null;
          const on = active === v.place.id;
          return (
            <button key={v.place.id} type="button" onClick={() => onPick(v.place.id)} aria-label={`${i + 1}번 ${v.place.name} 일정으로 이동`} aria-pressed={on} data-testid={`button-marker-${di}-${v.place.id}`}
              style={{ left: `${(px / 640) * 100}%`, top: `${(py / 360) * 100}%` }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 grid place-items-center rounded-full font-bold border-2 border-white shadow-md transition-transform focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary ${on ? 'w-9 h-9 text-base bg-[hsl(224_55%_13%)] text-white scale-110 z-10' : 'w-7 h-7 text-sm bg-primary text-primary-foreground'}`}>
              {i + 1}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{day.legs.some(l => l.status !== 'connected') ? '일부 실제 경로 미연동 · 확인된 구간만 표시해요.' : day.legs.length ? '선은 Google의 실제 도보 경로, 번호는 장소 좌표예요.' : '장소 좌표만 표시해요. 방문지 간 이동 구간은 없어요.'}</span>
        {status === 'ok' && fallback}
      </div>
    </div>
  );
}

function AiRequest({ input, disabled, onApply }: { input: TravelInput; disabled: boolean; onApply: (next: TravelInput) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; ai: boolean } | null>(null);
  const currentInput = useRef(input);
  currentInput.current = input;
  const run = async () => {
    if (!text.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const requestKey = JSON.stringify(input);
      const r = await interpretTravelRequest({ text: text.trim().slice(0, 1000), input });
      if (JSON.stringify(currentInput.current) !== requestKey) {
        setMsg({ ok: false, ai: r.aiUsed, text: 'AI 처리 중 입력이 바뀌어서 응답을 적용하지 않았어요. 최신 조건으로 다시 요청해 주세요.' });
        return;
      }
      onApply(r.input);
      setMsg({ ok: true, ai: r.aiUsed, text: r.message });
    } catch (e) {
      setMsg({ ok: false, ai: false, text: errMsg(e, 'AI 요청을 반영하지 못했어요. 입력은 그대로예요.') });
    } finally { setBusy(false); }
  };
  return (
    <div className="rounded-[10px] border border-[hsl(218_30%_88%)] bg-white p-4 md:p-5">
      <p className="font-bold text-sm flex items-center gap-1.5"><Wand2 className="w-4 h-4 text-primary" />추가 요청 (선택)</p>
      <p className="text-xs text-muted-foreground mt-0.5">예: "둘째 날은 오사카성 오전에" · 이 칸은 아래 버튼을 눌러야만 AI로 보내요. 일반 초안 생성에는 AI를 쓰지 않아요.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={2} data-testid="input-ai-request"
        className="mt-2 w-full rounded-lg border border-[hsl(218_30%_86%)] bg-white px-3 py-2 text-sm outline-none focus:border-primary" placeholder="원하는 걸 자유롭게 적어 주세요" />
      <button type="button" onClick={run} disabled={busy || disabled || !text.trim()} data-testid="button-ai-request"
        className="mt-2 rounded-lg px-4 min-h-[44px] bg-[hsl(218_80%_95%)] text-primary text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
        <Sparkles className="w-4 h-4" />{busy ? 'AI가 읽는 중…' : 'AI로 요청 반영'}
      </button>
      {msg && <div className="mt-2" data-testid="status-ai-request">{msg.ok
        ? <Alert tone="warn">{msg.ai ? 'AI가 해석해 입력을 바꿨어요. ' : 'AI를 사용하지 못해 규칙으로만 처리했어요. '}{msg.text}</Alert>
        : <Alert>{msg.text}</Alert>}</div>}
    </div>
  );
}

const haversine = (a: TravelPlace, b: TravelPlace) => {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return Infinity;
  const r = Math.PI / 180, dl = (b.lat - a.lat) * r, dg = (b.lng - a.lng) * r;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dg / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
};

export default function PlannerPage() {
  const initial = useMemo(loadInput, []);
  const [input, setInput] = useState<TravelInput>(initial.input);
  const [showRestored, setShowRestored] = useState(initial.restored && Boolean(
    initial.input.startDate || initial.input.endDate || initial.input.selectedIds.length ||
    initial.input.requiredIds.length || initial.input.spontaneity !== DEFAULT.spontaneity ||
    initial.input.activityStart !== DEFAULT.activityStart || initial.input.activityEnd !== DEFAULT.activityEnd ||
    Object.keys(initial.input.preferences ?? {}).length
  ));
  const [loadError] = useState(initial.error);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ plan: TravelPlan; key: string } | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [cat, setCat] = useState('전체');
  const [active, setActive] = useState<string | null>(null);
  const [confirmAdd, setConfirmAdd] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [dayIdx, setDayIdx] = useState(0);
  const [q, setQ] = useState('');
  const reqId = useRef(0);

  const catalogQ = useGetTravelCatalog({ query: { staleTime: 5 * 60_000, retry: 1 } });
  const catalog: TravelPlace[] = catalogQ.data?.places?.length ? catalogQ.data.places : localPlaces;
  const services = plan?.plan.services?.length ? plan.plan.services : catalogQ.data?.services;

  useEffect(() => {
    try { window.localStorage.setItem(KEY, JSON.stringify(input)); setSaveError(null); }
    catch { setSaveError('입력 내용을 이 브라우저에 저장하지 못했어요. 새로고침하면 사라질 수 있어요.'); }
  }, [input]);

  const inputKey = JSON.stringify(input);
  const stale = plan && plan.key !== inputKey;
  const prefs = input.preferences ?? {};
  const dates = tripDates(input.startDate, input.endDate);

  const generate = async (next: TravelInput) => {
    const id = ++reqId.current;
    setGenerating(true); setGenError(null);
    try {
      const res = await buildTravelPlan(next);
      if (id !== reqId.current) return;
      setPlan({ plan: res, key: JSON.stringify(next) });
    } catch (e) {
      if (id !== reqId.current) return;
      setGenError(errMsg(e, '초안을 만들지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      if (id === reqId.current) setGenerating(false);
    }
  };
  const commit = (next: TravelInput, regen = false) => { setInput(next); setError(null); if (regen) void generate(next); };
  const set = (patch: Partial<TravelInput>) => commit({ ...input, ...patch });
  const setPref = (id: string, patch: Partial<TravelPreference>, regen = false) => {
    const cur = { ...(prefs[id] ?? {}), ...patch };
    (Object.keys(cur) as (keyof TravelPreference)[]).forEach((k) => (cur[k] === undefined || cur[k] === '') && delete cur[k]);
    commit({ ...input, preferences: { ...prefs, [id]: cur } }, regen);
  };
  const toggleSel = (id: string) => {
    const on = input.selectedIds.includes(id);
    set({ selectedIds: on ? input.selectedIds.filter((x) => x !== id) : [...input.selectedIds, id], requiredIds: on ? input.requiredIds.filter((x) => x !== id) : input.requiredIds });
  };
  const toggleReq = (id: string) => set({ requiredIds: input.requiredIds.includes(id) ? input.requiredIds.filter((x) => x !== id) : [...input.requiredIds, id] });

  const timeError = () => {
    const a = input.activityStart ?? '', b = input.activityEnd ?? '';
    if (!HHMM.test(a) || !HHMM.test(b)) return '활동 시작·종료 시간을 HH:mm 형식으로 입력해 주세요.';
    if (b <= a) return '활동 종료 시간은 시작 시간보다 늦어야 해요.';
    return null;
  };
  const go = (to: number) => {
    if (to > step) {
      const e = validateInput(input, false) ?? timeError();
      if (e) return setError(e);
      if (step >= 1 && input.spontaneity < 100 && input.selectedIds.length === 0) return setError('한 곳 이상 골라 주세요. 슬라이더를 끝까지 밀면(오늘의 기분대로) 안 골라도 돼요.');
      if (to === 3) void generate(input);
    }
    setError(null); setStep(to);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const reset = () => {
    setResetOpen(false);
    reqId.current++; setGenerating(false);
    setInput(DEFAULT); setPlan(null); setStep(0); setError(null); setGenError(null);
    setShowRestored(false);
    setDayIdx(0); setActive(null); setOpenId(null); setConfirmAdd(null); setCat('전체'); setQ('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const move = (day: TravelDay, idx: number, dir: -1 | 1) => {
    const ids = day.visits.map((v) => v.place.id);
    const j = idx + dir; if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    const np = { ...prefs };
    ids.forEach((id, i) => { np[id] = { ...(np[id] ?? {}), order: i, date: day.date }; });
    commit({ ...input, preferences: np }, true);
  };
  const pick = (di: number, id: string) => {
    setActive(id);
    document.getElementById(`visit-${di}-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const selected = catalog.filter((p) => input.selectedIds.includes(p.id));
  const mood = modeOf(input.spontaneity);
  const cats = ['전체', ...Array.from(new Set(catalog.map((p) => p.category)))];
  const shown = cat === '전체' ? catalog : catalog.filter((p) => p.category === cat);
  const unschedWarn = new Map((plan?.plan.unscheduled ?? []).map((u) => [u.place.id, u.reason]));

  const suggestions = useMemo(() => {
    if (!plan) return [];
    const inPlan = plan.plan.days.flatMap((d) => d.visits.map((v) => v.place));
    return catalog.filter((p) => !input.selectedIds.includes(p.id))
      .map((p) => ({ p, d: Math.min(...inPlan.map((q) => haversine(p, q)), Infinity) }))
      .filter((x) => x.d < 3000 || inPlan.some((q) => q.area === x.p.area))
      .sort((a, b) => a.d - b.d).slice(0, 3);
  }, [plan, catalog, input.selectedIds]);

  const nights = Math.max(0, dates.length - 1);
  const img = import.meta.env.BASE_URL;
  const renderRequestId = reqId.current;
  const days = plan?.plan.days ?? [];
  const di = Math.min(dayIdx, Math.max(0, days.length - 1));
  const ql = q.trim().toLowerCase();
  const visible = ql ? shown.filter((p) => [p.name, p.area, p.category].some((x) => x.toLowerCase().includes(ql))) : shown;
  const card = 'rounded-[10px] border border-[hsl(218_30%_88%)] bg-white';
  const field = 'mt-1 w-full border-0 border-b border-[hsl(218_25%_82%)] bg-transparent px-0 py-1.5 text-lg md:text-xl font-semibold tabular-nums text-foreground outline-none focus:border-primary transition-colors min-h-[44px]';
  const small = 'mt-1 w-full rounded-lg border border-[hsl(218_30%_86%)] bg-white px-2.5 min-h-[44px] text-sm outline-none focus:border-primary';
  const Eyebrow = ({ children }: { children: ReactNode }) => <p className="text-[11px] font-bold tracking-[0.2em] text-primary">{children}</p>;
  const summary = <p className="text-xs text-muted-foreground mt-2 flex flex-wrap gap-x-2">{input.startDate && <span className="tabular-nums">{input.startDate.replaceAll('-', '.')} – {input.endDate.replaceAll('-', '.')}</span>}{dates.length > 0 && <span>{nights}박 {dates.length}일</span>}<span className="text-primary font-bold">{mood.t} · 무계획력 {input.spontaneity}%</span><span>{selected.length}곳 선택</span></p>;

  return (
    <div className="min-h-[100dvh] lg:grid lg:grid-cols-[39%_61%] bg-[#f7f9fc]">
      <aside className="hidden lg:block sticky top-0 h-[100dvh] overflow-hidden bg-[hsl(224_50%_10%)] text-white" data-testid="section-hero">
        <img src={`${img}osaka-castle-night.jpg`} alt="밤의 오사카성" className="absolute inset-0 w-full h-full object-cover object-top hero-zoom" />
        <div className="absolute inset-0 bg-gradient-to-b from-[hsl(224_60%_8%/.55)] via-transparent to-[hsl(224_60%_6%/.95)]" />
        <div className="relative h-full flex flex-col justify-between p-10 xl:p-12">
          <div className="flex items-center justify-between">
            <button onClick={() => go(0)} data-testid="button-home" className="flex items-center gap-2.5 font-bold text-lg"><span className="grid place-items-center w-7 h-7 rounded-full border border-white/80"><ArrowUpRight className="w-4 h-4" /></span>피플랜</button>
            <span className="text-[10px] tracking-[0.25em] opacity-80">A LITTLE LESS PLANNED.</span>
          </div>
          <div>
            <p className="text-[11px] tracking-[0.25em] opacity-75">YOUR NEXT CHAPTER, OSAKA</p>
            <h2 className="text-4xl xl:text-5xl font-bold leading-[1.25] mt-3 tracking-tight">계획은 가볍게.<br />여행은 멀리.</h2>
            <p className="mt-4 text-sm opacity-75 leading-relaxed">창밖을 바라보는 설렘부터 시작해요.<br />빈칸이 있는 여행도, 충분히 멋질 테니까.</p>
            <div className="mt-8 pt-6 border-t border-white/25 flex items-end justify-between">
              <div><p className="text-3xl font-light">ICN</p><p className="text-[10px] opacity-70 mt-1">SEOUL · 출발하는 마음</p></div>
              <span className="mb-4 flex items-center gap-2 opacity-80 text-xs tracking-[0.3em]">····<Plane className="w-4 h-4" />····</span>
              <div className="text-right"><p className="text-3xl font-light">KIX</p><p className="text-[10px] opacity-70 mt-1">OSAKA · 새로운 장면</p></div>
            </div>
          </div>
        </div>
      </aside>

      <div className="min-h-[100dvh] flex flex-col min-w-0">
        <header className="lg:hidden sticky top-0 z-20 h-[54px] bg-[hsl(224_55%_13%)] text-white px-4 flex items-center justify-between">
          <button onClick={() => go(0)} data-testid="button-home-mobile" className="flex items-center gap-2 font-bold min-h-[44px]"><span className="grid place-items-center w-6 h-6 rounded-full border border-white/80"><ArrowUpRight className="w-3.5 h-3.5" /></span>피플랜</button>
          <span className="text-[11px] tracking-[0.2em] opacity-85">OSAKA, JP</span>
        </header>
        {step === 0 && (
          <div className="lg:hidden relative h-[190px] overflow-hidden bg-[hsl(224_50%_12%)] text-white">
            <img src={`${img}osaka-castle-mobile.png`} alt="밤의 오사카성" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-[hsl(224_60%_8%/.9)] to-transparent" />
            <div className="absolute inset-x-4 bottom-4 flex items-end justify-between">
              <div><p className="text-[10px] tracking-[0.22em] opacity-80">YOUR NEXT CHAPTER, OSAKA</p><p className="text-[26px] font-bold leading-tight mt-1">계획은 가볍게.<br />여행은 멀리.</p></div>
              <p className="text-[11px] tracking-[0.2em] opacity-85 mb-1">ICN → KIX</p>
            </div>
          </div>
        )}

        <div className="w-full max-w-[800px] mx-auto px-4 md:px-10 flex-1 flex flex-col">
          <div className="hidden lg:flex pt-8 justify-between text-[11px] tracking-[0.15em] text-muted-foreground">
            <span>OSAKA TRAVEL PLANNER / VOL. 01</span>
            <span data-testid="text-save-status" className={saveError || loadError ? 'text-destructive font-bold' : ''}>{saveError ? '저장 실패' : loadError ? '불러오기 실패' : '설정은 자동으로 저장돼요'}</span>
          </div>

          <nav className="pt-4 lg:pt-6" aria-label="단계">
            <ol className="flex items-center">
              {STEPS.map((s, i) => (
                <li key={s} className={`flex items-center ${i < STEPS.length - 1 ? 'flex-1' : ''}`}>
                  <button data-testid={`button-step-${i}`} onClick={() => i < step && go(i)} disabled={i > step} aria-current={i === step ? 'step' : undefined}
                    className="flex flex-col md:flex-row items-center gap-1 md:gap-2 min-h-[44px] shrink-0">
                    <span className={`grid place-items-center w-6 h-6 rounded-full text-[10px] font-bold tabular-nums ${i === step ? 'bg-primary text-white' : i < step ? 'border border-[hsl(218_30%_80%)] text-muted-foreground' : 'border border-[hsl(218_30%_86%)] text-[hsl(218_15%_65%)]'}`}>
                      {i < step ? <Check className="w-3 h-3" /> : String(i + 1).padStart(2, '0')}
                    </span>
                    <span className={`text-[11px] md:text-xs whitespace-nowrap ${i === step ? 'text-primary font-bold' : 'text-muted-foreground'}`}>{s}</span>
                  </button>
                  {i < STEPS.length - 1 && <span className="flex-1 h-px bg-[hsl(218_30%_86%)] mx-2 mb-5 md:mb-0" />}
                </li>
              ))}
            </ol>
          </nav>

          {(loadError || saveError) && <div className="mt-3"><Alert testId="status-storage-error">{saveError ?? loadError}</Alert></div>}
          {showRestored && !loadError && step === 0 && <p className="mt-3 text-xs text-muted-foreground" data-testid="text-restored">지난번에 입력하던 내용을 불러왔어요.</p>}

          <section key={step} className="rise min-w-0 py-6 flex-1">
            {step === 0 && (
              <div className="space-y-4">
                <div>
                  <Eyebrow>LET'S GET YOU ON BOARD</Eyebrow>
                  <h1 className="text-2xl md:text-[32px] font-bold leading-tight mt-2 tracking-tight">떠날 날짜만 정해볼까요?</h1>
                  <p className="text-sm text-muted-foreground mt-2">언제 떠나는지, 얼마나 자유롭고 싶은지만 알려주세요.</p>
                </div>
                <div className={`${card} overflow-hidden`} data-testid="card-boarding-pass">
                  <div className="flex items-center justify-between bg-[hsl(218_80%_96%)] border-b border-[hsl(218_50%_90%)] px-4 md:px-5 py-3 text-[11px] tracking-[0.15em]">
                    <span className="flex items-center gap-2 font-bold text-primary"><Plane className="w-3.5 h-3.5" />YOUR BOARDING PASS</span>
                    <span className="text-muted-foreground">DESTINATION <b className="font-medium text-foreground/70 ml-1">OSAKA, JP</b></span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 md:gap-x-6 gap-y-5 p-4 md:p-5">
                    {(['startDate', 'endDate'] as const).map((k) => (
                      <label key={k} className="block min-w-0">
                        <span className="flex justify-between text-xs"><span className="font-medium flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5 text-primary md:hidden" />{k === 'startDate' ? '여행 시작일' : '여행 종료일'}</span><span className="hidden md:inline text-[10px] tracking-[0.15em] text-muted-foreground">{k === 'startDate' ? 'DEPARTURE' : 'RETURN'}</span></span>
                        <input type="date" value={input[k]} onChange={(e) => set({ [k]: e.target.value })} data-testid={`input-${k}`} className={field} />
                      </label>
                    ))}
                    {(['activityStart', 'activityEnd'] as const).map((k) => (
                      <label key={k} className="block min-w-0">
                        <span className="flex justify-between text-xs"><span className="font-medium flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-primary md:hidden" />{k === 'activityStart' ? '하루 일정 시작' : '하루 일정 종료'}</span><span className="hidden md:inline text-[10px] tracking-[0.15em] text-muted-foreground">{k === 'activityStart' ? 'DAY START' : 'DAY END'}</span></span>
                        <input type="time" value={input[k] ?? ''} onChange={(e) => set({ [k]: e.target.value })} data-testid={`input-${k}`} className={field} />
                      </label>
                    ))}
                  </div>
                  <div className="mx-4 md:mx-5 border-t border-[hsl(218_30%_90%)] py-3 flex justify-between text-[11px] text-muted-foreground">
                    <span>현지 시간 기준 · 일본 표준시 (JST)</span>
                    <span className="text-primary font-bold" data-testid="text-duration">{dates.length ? `${nights}박 ${dates.length}일` : '날짜를 골라 주세요'}</span>
                  </div>
                </div>
                <div className={`${card} p-4 md:p-5`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold flex items-center gap-2 flex-wrap">나의 무계획력 <span className="rounded bg-[hsl(218_80%_95%)] text-primary text-[11px] px-1.5 py-0.5" data-testid="text-mood">{mood.t}</span></p>
                      <p className="text-xs text-muted-foreground mt-1">{mood.d}</p>
                    </div>
                    <span className="text-4xl font-light text-primary tabular-nums" data-testid="text-spontaneity">{input.spontaneity}<span className="text-base">%</span></span>
                  </div>
                  <input type="range" aria-label="무계획력" min={0} max={100} value={input.spontaneity} onChange={(e) => set({ spontaneity: Number(e.target.value) })} data-testid="input-spontaneity"
                    className="mt-5 w-full accent-[#2d50e8] h-2 cursor-pointer min-h-[24px]" />
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1"><span>촘촘한 계획</span><span>적당한 균형</span><span>발길 닿는 대로</span></div>
                  <p className="mt-3 text-xs flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-primary" />꼭 가고 싶은 곳만 정하고, 나머지는 자유롭게.</p>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <Eyebrow>PICK YOUR NEXT SCENE</Eyebrow>
                  <h1 className="text-2xl md:text-[32px] font-bold leading-tight mt-2 tracking-tight">끌리는 곳만 콕콕.</h1>
                  <p className="text-sm text-muted-foreground mt-2">{input.spontaneity === 100 ? '오늘의 기분대로라 하나도 안 골라도 돼요. 고른 곳도 억지로 넣지 않아요.' : '한 곳만 골라도 괜찮아요. 고르지 않은 곳은 초안에 넣지 않아요.'}</p>
                </div>
                <label className="relative block">
                  <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="가고 싶은 장소를 검색해 보세요" data-testid="input-search" className="w-full rounded-[10px] border border-[hsl(218_30%_86%)] bg-white pl-10 pr-3 min-h-[46px] text-sm outline-none focus:border-primary" />
                </label>
                <div className="flex flex-wrap gap-1.5 items-center" role="group" aria-label="카테고리">
                  {cats.map((c) => (
                    <button key={c} onClick={() => setCat(c)} aria-pressed={cat === c} data-testid={`button-category-${c}`}
                      className={`rounded-lg px-3 min-h-[36px] text-xs font-medium border transition-colors ${cat === c ? 'bg-primary text-white border-primary' : 'bg-white border-[hsl(218_30%_86%)] hover:border-primary/50'}`}>{c}</button>
                  ))}
                  <span className="text-xs ml-auto" data-testid="text-selected-count"><b className="text-primary">{selected.length}곳</b> 선택</span>
                </div>
                <p className="text-[11px] text-muted-foreground">시연용 대표 장소 목록 · 사진·평점·운영정보는 조회된 Google 정보만 표시해요.</p>
                {catalogQ.isLoading ? (
                  <div className="grid md:grid-cols-2 gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="skel h-28 md:h-56 rounded-[10px]" />)}</div>
                ) : visible.length === 0 ? (
                  <div className={`${card} p-6 text-center text-sm text-muted-foreground`}>'{q}'에 맞는 장소가 없어요. <button onClick={() => setQ('')} className="text-primary font-bold underline">검색 지우기</button></div>
                ) : (
                  <div className="grid md:grid-cols-2 gap-3">
                    {visible.map((p, i) => {
                      const on = input.selectedIds.includes(p.id);
                      const open = openId === p.id;
                      return (
                        <div key={p.id} className={`rounded-[10px] border bg-white overflow-hidden transition-colors ${on ? 'border-primary ring-1 ring-primary' : 'border-[hsl(218_30%_88%)]'}`} data-testid={`card-place-${p.id}`}>
                          <div className="flex md:block">
                            {p.photoUrl ? (
                              <figure className="relative w-[92px] md:w-full shrink-0 self-stretch">
                                <img src={p.photoUrl} alt={p.name} loading="lazy" className="w-full h-full md:h-auto md:aspect-[16/7] object-cover bg-muted" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} />
                                {p.photoAuthors?.length ? <figcaption className="absolute bottom-0 inset-x-0 bg-[hsl(224_45%_12%/.6)] text-[9px] text-white px-1.5 py-0.5 truncate">사진: {p.photoAuthors.join(', ')} · Google</figcaption> : null}
                              </figure>
                            ) : <div className={`w-[92px] md:w-full md:h-20 shrink-0 grid place-items-center text-xl font-bold text-[hsl(224_45%_30%)] ${TINTS[i % TINTS.length]}`}>{p.name.slice(0, 1)}</div>}
                            <div className="flex-1 min-w-0 p-3 md:p-4">
                              <div className="flex gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="font-bold leading-tight">{p.name}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5">{p.area} · {p.category}{p.rating != null && <> · <Star className="inline w-3 h-3 fill-primary text-primary" /> {p.rating.toFixed(1)}</>}</p>
                                </div>
                                <button onClick={() => toggleSel(p.id)} data-testid={`button-select-${p.id}`} aria-label={`${p.name} ${on ? '선택 해제' : '선택'}`} aria-pressed={on}
                                  className={`w-11 h-11 rounded-full grid place-items-center shrink-0 transition-all active:scale-90 ${on ? 'bg-primary text-white' : 'bg-white border border-[hsl(218_30%_84%)] text-muted-foreground hover:border-primary'}`}>
                                  {on ? <Check className="w-4 h-4 pop" /> : <Plus className="w-4 h-4" />}
                                </button>
                              </div>
                              <p className="text-sm mt-1.5 text-muted-foreground line-clamp-2">{p.description}</p>
                              <div className="mt-2 flex flex-wrap gap-3 items-center">
                                <button onClick={() => setOpenId(open ? null : p.id)} className="text-xs font-bold text-primary min-h-[32px]" data-testid={`button-details-${p.id}`}>{open ? '운영 정보 접기' : '운영 정보 보기'}</button>
                                {p.mapsUrl && <a href={p.mapsUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-primary inline-flex items-center gap-1" data-testid={`link-maps-${p.id}`}>Google 지도 <ExternalLink className="w-3 h-3" /></a>}
                              </div>
                            </div>
                          </div>
                          {open && <div className="border-t border-[hsl(218_30%_90%)] px-3 md:px-4 pb-3"><PlaceFacts p={p} tripDates={dates} onVerified={() => { void catalogQ.refetch(); }} /></div>}
                        </div>
                      );
                    })}
                  </div>
                )}
                {selected.length > 0 && (
                  <div className={`${card} p-4`} data-testid="tray-selected">
                    <p className="flex justify-between text-sm font-bold">여행에 담은 장소 <span className="text-primary">{selected.length}곳</span></p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {selected.map((p) => (
                        <button key={p.id} onClick={() => toggleSel(p.id)} data-testid={`button-tray-remove-${p.id}`} aria-label={`${p.name} 빼기`} className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(218_30%_86%)] px-2.5 min-h-[36px] text-xs hover:border-destructive">{p.name}<X className="w-3 h-3" /></button>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-3">선택하지 않은 장소는 자동으로 일정에 추가하지 않아요.</p>
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <Eyebrow>SET YOUR MUST-SEES</Eyebrow>
                  <h1 className="text-2xl md:text-[32px] font-bold leading-tight mt-2 tracking-tight">이건 꼭, 싶은 곳은?</h1>
                  <p className="text-sm text-muted-foreground mt-2">별을 누르면 먼저 일정에 넣어요. 날짜·시간은 비워 두면 알아서 정해요. 머무는 시간 60분은 기본값일 뿐 실제 소요 시간이 아니니 바꿔 주세요.</p>
                </div>
                <div className="rounded-[10px] bg-[hsl(218_80%_96%)] px-4 py-3">{summary}</div>
                {selected.length === 0 && <div className={`${card} border-dashed p-6 text-center text-sm text-muted-foreground`}>고른 곳이 없어요. 오늘의 기분대로 빈 하루를 만들게요.</div>}
                <ul className="space-y-2.5">
                  {selected.map((p) => {
                    const req = input.requiredIds.includes(p.id);
                    const pr = prefs[p.id] ?? {};
                    const outOfRange = pr.date && !dates.includes(pr.date);
                    const warn = unschedWarn.get(p.id);
                    return (
                      <li key={p.id} className={`rounded-[10px] border bg-white p-4 transition-colors ${req ? 'border-primary' : 'border-[hsl(218_30%_88%)]'}`} data-testid={`row-pref-${p.id}`}>
                        <button onClick={() => toggleReq(p.id)} data-testid={`button-required-${p.id}`} aria-pressed={req} className="w-full flex items-center gap-3 text-left min-h-[44px]">
                          <Star className={`w-5 h-5 transition-all ${req ? 'fill-primary text-primary' : 'text-[hsl(218_20%_70%)]'}`} />
                          <span className="flex-1"><b>{p.name}</b><span className="block text-xs text-muted-foreground">{p.area}</span></span>
                          <Pill tone={req ? 'blue' : 'muted'}>{req ? '꼭 갈 곳' : '가능하면'}</Pill>
                        </button>
                        <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-muted-foreground">
                          <label className="col-span-2 md:col-span-1">고정 날짜
                            <select value={pr.date ?? ''} onChange={(e) => setPref(p.id, { date: e.target.value || undefined })} data-testid={`select-date-${p.id}`} className={small}>
                              <option value="">자동</option>
                              {pr.date && !dates.includes(pr.date) && <option value={pr.date}>{pr.date} (범위 밖)</option>}
                              {dates.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}
                            </select>
                          </label>
                          <label>고정 시간
                            <input type="time" value={pr.time ?? ''} onChange={(e) => setPref(p.id, { time: e.target.value || undefined })} data-testid={`input-time-${p.id}`} className={small} />
                          </label>
                          <label>머무는 시간(분)
                            <input type="number" min={15} max={1440} step={15} value={pr.stayMinutes ?? 60} onChange={(e) => setPref(p.id, { stayMinutes: Math.min(1440, Math.max(15, Number(e.target.value) || 60)) })} data-testid={`input-stay-${p.id}`} className={small} />
                          </label>
                        </div>
                        {(outOfRange || warn) && <div className="mt-2"><Alert tone="warn">{outOfRange ? '고정 날짜가 여행 기간 밖이에요. ' : ''}{warn ?? ''}</Alert></div>}
                      </li>
                    );
                  })}
                </ul>
                <AiRequest input={input} disabled={generating} onApply={(n) => commit(n)} />
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <div>
                  <Eyebrow>YOUR JOURNEY, WITH ROOM TO WANDER</Eyebrow>
                  <h1 className="text-2xl md:text-[32px] font-bold leading-tight mt-2 tracking-tight">자, 여행의 윤곽이 나왔어요.</h1>
                  <p className="text-sm text-muted-foreground mt-2">꼭 가고 싶은 곳부터, 나머지는 발길 닿는 대로.{plan && <> 자유 시간 <b className="text-foreground" data-testid="text-free-percent">{plan.plan.freePercent == null ? '확인 필요' : `약 ${Math.round(plan.plan.freePercent)}%`}</b></>}</p>
                  {summary}
                </div>

                {generating && <div className="space-y-3" data-testid="status-generating"><p className="text-sm font-bold text-primary">경로를 확인하며 초안을 만드는 중…</p><div className="skel h-12 rounded-[10px]" /><div className="skel h-72 rounded-[10px]" /></div>}
                {genError && !generating && <Alert testId="text-gen-error">{genError} <button onClick={() => generate(input)} className="underline ml-1" data-testid="button-retry">다시 시도</button></Alert>}
                {stale && !generating && <Alert tone="warn" testId="status-stale">입력이 바뀌어서 아래 초안은 예전 기준이에요. <button onClick={() => generate(input)} className="underline font-bold" data-testid="button-regenerate">새로 만들기</button></Alert>}

                {plan && !generating && (
                  <>
                    {plan.plan.warnings.length > 0 && <Alert tone="warn" testId="list-plan-warnings"><ul className="list-disc pl-4">{plan.plan.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Alert>}
                    <div className="rounded-[10px] bg-[hsl(218_80%_96%)] px-4 py-3 text-xs text-[hsl(224_45%_28%)] flex gap-2">
                      <Info className="w-4 h-4 shrink-0 text-primary" />
                      <p>규칙 기반으로 구성한 예시 초안이에요(이번 생성에 AI 사용 안 함, 방식: {plan.plan.mode}). 도보 시간·거리는 Google 추정치이며 보장되지 않아요. 운영·예약 정보는 방문 전 확인해 주세요.</p>
                    </div>
                    {days.length > 0 && (
                      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="여행 날짜">
                        {days.map((d, i) => (
                          <button key={d.date} role="tab" aria-selected={i === di} onClick={() => { setDayIdx(i); setActive(null); }} data-testid={`tab-day-${i}`}
                            className={`shrink-0 min-w-[92px] rounded-lg border px-3 py-2 text-left min-h-[44px] transition-colors ${i === di ? 'bg-primary border-primary text-white' : 'bg-white border-[hsl(218_30%_86%)] hover:border-primary/50'}`}>
                            <p className="text-xs font-bold">DAY {String(i + 1).padStart(2, '0')}</p>
                            <p className={`text-[10px] tabular-nums ${i === di ? 'opacity-80' : 'text-muted-foreground'}`}>{d.date.slice(5).replace('-', '.')} ({'일월화수목금토'[new Date(d.date + 'T00:00:00').getDay()]})</p>
                          </button>
                        ))}
                      </div>
                    )}
                    {days[di] && (() => { const d = days[di]; return (
                      <article key={`${d.date}-${di}`} className="rounded-[10px] border border-[hsl(218_30%_86%)] bg-white overflow-hidden rise" data-testid={`card-day-${di}`}>
                        <div className="flex items-end justify-between gap-2 px-4 md:px-5 py-3.5 bg-primary text-white">
                          <div className="min-w-0">
                            <p className="text-[10px] opacity-80 tracking-[0.15em]">DAY {String(di + 1).padStart(2, '0')} / {fmtDate(d.date)}</p>
                            <h2 className="font-bold text-lg truncate" data-testid={`text-day-title-${di}`}>{d.title}</h2>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[10px] opacity-80">남겨둔 자유시간 · 목표 {mins(d.targetFreeMinutes)}</p>
                            <p className="font-bold">{d.freeMinutes == null ? '확인 필요' : mins(d.freeMinutes)}</p>
                          </div>
                        </div>
                        {d.warnings.length > 0 && <div className="mx-4 mt-3"><Alert tone="warn"><ul className="list-disc pl-4">{d.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Alert></div>}
                        <DayMap key={`${plan.plan.generatedAt}-${di}`} day={d} di={di} active={active} onPick={(id) => pick(di, id)} />
                        <ol className="p-4 space-y-1">
                          {d.visits.length === 0 && <li className="text-sm text-muted-foreground px-2 py-3">정해진 곳 없이 자유롭게 걷는 날이에요.</li>}
                          {d.visits.length === 1 && <li className="text-xs text-muted-foreground px-1">한 곳만 가는 날이라 이동 구간이 없어요.</li>}
                          {d.visits.map((v, vi) => {
                            const leg = vi > 0 ? d.legs.find((l) => l.fromId === d.visits[vi - 1].place.id && l.toId === v.place.id) : undefined;
                            const on = active === v.place.id;
                            const pr = prefs[v.place.id] ?? {};
                            return (
                              <li key={v.place.id}>
                                {vi > 0 && (
                                  <div className="flex items-center gap-2 pl-4 py-1.5 text-xs text-muted-foreground" data-testid={`text-leg-${di}-${vi}`}>
                                    <Footprints className="w-3.5 h-3.5 text-primary" />
                                    {!leg ? <span className="text-destructive font-bold">경로 정보 없음 · 직접 확인 필요</span>
                                      : leg.status === 'connected' && leg.distanceMeters != null ? (
                                        <span>도보 {leg.durationSeconds != null ? `약 ${Math.round(leg.durationSeconds / 60)}분` : '시간 확인 필요'} · {leg.distanceMeters >= 1000 ? `${(leg.distanceMeters / 1000).toFixed(1)}km` : `${leg.distanceMeters}m`} (Google 추정)
                                          {leg.distanceMeters >= 10000 && <b className="text-destructive ml-1">10km 이상 · 대중교통 확인 필요</b>}</span>
                                      ) : <span className="text-destructive font-bold">경로 조회 실패{leg.error ? `: ${leg.error}` : ''}</span>}
                                  </div>
                                )}
                                <div id={`visit-${di}-${v.place.id}`} onClick={() => setActive(v.place.id)} data-testid={`row-visit-${di}-${v.place.id}`}
                                  className={`rounded-lg border p-3 cursor-pointer transition-colors ${on ? 'border-primary bg-[hsl(218_80%_97%)]' : 'border-transparent hover:bg-[hsl(218_40%_98%)]'}`}>
                                  <div className="flex items-center gap-3">
                                    <span className="grid place-items-center w-7 h-7 rounded-full text-xs font-bold shrink-0 bg-primary text-white">{vi + 1}</span>
                                    <span className="flex-1 min-w-0">
                                      <b className="block truncate">{v.place.name}</b>
                                      <span className="text-xs tabular-nums text-muted-foreground" data-testid={`text-time-${di}-${v.place.id}`}><b className="text-foreground font-medium">{v.startTime}–{v.endTime}</b> · 머무름 {mins(v.stayMinutes)}</span>
                                    </span>
                                    {v.required && <Pill tone="blue">꼭 갈 곳</Pill>}
                                    <span className="flex">
                                      <button onClick={(e) => { e.stopPropagation(); move(d, vi, -1); }} disabled={vi === 0} aria-label={`${v.place.name} 위로`} data-testid={`button-up-${di}-${v.place.id}`} className="w-9 h-11 grid place-items-center rounded hover:bg-muted disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
                                      <button onClick={(e) => { e.stopPropagation(); move(d, vi, 1); }} disabled={vi === d.visits.length - 1} aria-label={`${v.place.name} 아래로`} data-testid={`button-down-${di}-${v.place.id}`} className="w-9 h-11 grid place-items-center rounded hover:bg-muted disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
                                    </span>
                                  </div>
                                  {v.warnings.length > 0 && <div className="mt-2"><Alert tone="warn"><ul>{v.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Alert></div>}
                                  {on && (
                                    <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-muted-foreground pop" onClick={(e) => e.stopPropagation()}>
                                      <label className="col-span-2 md:col-span-1">날짜
                                        <select defaultValue={pr.date ?? ''} onChange={(e) => setPref(v.place.id, { date: e.target.value || undefined, order: undefined }, true)} data-testid={`select-result-date-${v.place.id}`} className={small}>
                                          <option value="">자동</option>{dates.map((x) => <option key={x} value={x}>{fmtDate(x)}</option>)}
                                        </select>
                                      </label>
                                      <label>시작 시간
                                        <input type="time" defaultValue={pr.time ?? ''} onBlur={(e) => e.target.value !== (pr.time ?? '') && setPref(v.place.id, { time: e.target.value || undefined }, true)} data-testid={`input-result-time-${v.place.id}`} className={small} />
                                      </label>
                                      <label>머무름(분)
                                        <input type="number" min={15} max={1440} step={15} defaultValue={v.stayMinutes} onBlur={(e) => { const n = Math.min(1440, Math.max(15, Number(e.target.value) || 60)); if (n !== v.stayMinutes) setPref(v.place.id, { stayMinutes: n }, true); }} data-testid={`input-result-stay-${v.place.id}`} className={small} />
                                      </label>
                                      {v.place.mapsUrl && <a href={v.place.mapsUrl} target="_blank" rel="noreferrer" className="col-span-2 md:col-span-3 text-primary font-bold inline-flex items-center gap-1">Google 지도 <ExternalLink className="w-3 h-3" /></a>}
                                      <p className="col-span-2 md:col-span-3">시간·체류시간 입력 후 다른 곳을 누르면 경로를 다시 계산해요. 예약·마감·마지막 입장: 확인 필요</p>
                                    </div>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      </article>
                    ); })()}

                    {plan.plan.unscheduled.length > 0 && (
                      <div className={`${card} p-4 md:p-5`} data-testid="section-unscheduled">
                        <h3 className="font-bold">이번 초안에 담지 못한 곳</h3>
                        <ul className="mt-3 space-y-2">{plan.plan.unscheduled.map((u) => (
                          <li key={u.place.id} className="rounded-lg bg-[hsl(218_40%_97%)] px-3 py-2.5 text-sm"><b>{u.place.name}</b>{u.required && <span className="ml-2"><Pill tone="bad">꼭 갈 곳 · 배치 불가</Pill></span>}<p className="text-xs text-muted-foreground mt-0.5">{u.reason}</p></li>
                        ))}</ul>
                      </div>
                    )}

                    {suggestions.length > 0 && (
                      <div className={`${card} p-4 md:p-5`} data-testid="section-suggestions">
                        <h3 className="font-bold">근처에 이런 곳도 있어요</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">제안일 뿐 일정에 들어간 곳이 아니에요. 추가를 확인해야만 넣고 다시 만들어요.</p>
                        <ul className="mt-3 space-y-2">{suggestions.map(({ p, d }) => (
                          <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-[hsl(218_80%_97%)] px-3 py-2 text-sm">
                            <Pill tone="muted">제안</Pill><b>{p.name}</b><span className="text-xs text-muted-foreground">{p.area}{Number.isFinite(d) ? ` · 직선 약 ${d >= 1000 ? (d / 1000).toFixed(1) + 'km' : Math.round(d) + 'm'}` : ''}</span>
                            <span className="ml-auto flex gap-1.5">
                              {confirmAdd === p.id ? (<>
                                <button onClick={() => { setConfirmAdd(null); commit({ ...input, selectedIds: [...input.selectedIds, p.id] }, true); }} disabled={generating} data-testid={`button-confirm-add-${p.id}`} className="rounded-lg bg-primary text-white px-3 min-h-[36px] text-xs font-bold">추가하고 다시 만들기</button>
                                <button onClick={() => setConfirmAdd(null)} className="rounded-lg bg-white border px-3 min-h-[36px] text-xs font-bold">취소</button>
                              </>) : <button onClick={() => setConfirmAdd(p.id)} data-testid={`button-add-${p.id}`} className="rounded-lg text-primary px-2 min-h-[36px] text-xs font-bold">선택해 추가 +</button>}
                            </span>
                          </li>
                        ))}</ul>
                      </div>
                    )}
                    <AiRequest input={input} disabled={generating} onApply={(n) => { if (reqId.current === renderRequestId) commit(n, true); }} />
                  </>
                )}
                <div className="flex flex-wrap justify-between gap-4 pt-2">
                  <button onClick={() => go(2)} data-testid="button-back-edit" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary min-h-[44px]"><ArrowLeft className="w-4 h-4" />조건 수정</button>
                  <button onClick={() => setResetOpen(true)} data-testid="button-reset" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground min-h-[44px]"><RotateCcw className="w-4 h-4" />처음부터 다시</button>
                </div>
              </div>
            )}

            {error && <div className="mt-5 pop"><Alert testId="text-error">{error}</Alert></div>}

            {step < 3 && (
              <div className="mt-6 flex flex-col-reverse md:flex-row md:items-center gap-3">
                {step > 0 ? (
                  <button onClick={() => go(step - 1)} data-testid="button-prev" className="self-center md:self-auto inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary min-h-[44px]"><ArrowLeft className="w-4 h-4" />{STEPS[step - 1]}</button>
                ) : <p className="hidden md:block text-[11px] text-muted-foreground leading-relaxed">다음은 가고 싶은 장소를 고르는 시간.<br />여행 설정은 나중에 바꿀 수 있어요.</p>}
                <button onClick={() => go(step + 1)} disabled={generating} data-testid="button-next"
                  className="md:ml-auto w-full md:w-auto md:min-w-[240px] rounded-lg px-6 min-h-[54px] bg-primary text-white font-bold inline-flex items-center justify-between gap-6 hover:bg-[hsl(228_80%_48%)] active:scale-[.99] transition-all disabled:opacity-50">
                  <span>{step === 0 ? '가고 싶은 곳 고르기' : step === 1 ? '방문 조건 정하기' : '일정 만들기'}</span>{step === 2 ? <Sparkles className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}
                </button>
              </div>
            )}
          </section>

          <div className="pb-4"><ServiceBar services={services} loading={catalogQ.isLoading} failed={catalogQ.isError} /></div>

          <footer className="py-5 border-t border-[hsl(218_30%_88%)] text-[11px] text-muted-foreground" data-testid="text-footer">
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-2"><p>피플랜 · © 2026 · Team 14 미리보기</p><p className="tracking-[0.15em]">MADE FOR YOUR OWN PACE.</p></div>
            <details className="mt-2"><summary className="cursor-pointer">데이터와 AI 사용 안내</summary><p className="mt-1 leading-relaxed">일정은 서버 규칙으로 만들고 장소·도보 경로·지도는 Google 정보를 서버를 거쳐 받아요. 입력은 이 브라우저에도 저장돼요. AI(OpenAI)는 'AI로 요청 반영'이나 공식 정보 확인을 누를 때만 호출되며, 앱 제작에는 Replit Agent가 활용되었습니다.</p></details>
          </footer>
        </div>
      </div>
      <ResetTripDialog open={resetOpen} onOpenChange={setResetOpen} onConfirm={reset} />
    </div>
  );
}

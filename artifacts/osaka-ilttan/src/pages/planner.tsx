import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleAlert, Info, MapPinOff, RotateCcw, Star, Sun, Moon, Sparkles, CalendarDays } from 'lucide-react';
import { places, validateInput, generateItinerary, type PlannerInput } from '@/lib/planner';

type Place = (typeof places)[number];
type Result = ReturnType<typeof generateItinerary>;

const KEY = 'ilttan-osaka-input-v1';
const DEFAULT: PlannerInput = { startDate: '', endDate: '', spontaneity: 50, selectedIds: [], requiredIds: [] };
const STEPS = ['날짜와 즉흥도', '장소 고르기', '꼭 갈 곳', '초안 보기'];
const TINTS = ['bg-[hsl(352_80%_92%)]', 'bg-[hsl(160_45%_88%)]', 'bg-[hsl(262_60%_92%)]', 'bg-[hsl(42_90%_88%)]', 'bg-[hsl(200_60%_90%)]'];

function loadInput(): { input: PlannerInput; error: string | null; restored: boolean } {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { input: DEFAULT, error: null, restored: false };
    const p = JSON.parse(raw);
    const ids = new Set(places.map((x) => x.id));
    const sel = Array.isArray(p.selectedIds) ? p.selectedIds.filter((i: unknown) => typeof i === 'string' && ids.has(i)) : [];
    return {
      input: {
        startDate: typeof p.startDate === 'string' ? p.startDate : '',
        endDate: typeof p.endDate === 'string' ? p.endDate : '',
        spontaneity: typeof p.spontaneity === 'number' ? Math.min(100, Math.max(0, p.spontaneity)) : 50,
        selectedIds: sel,
        requiredIds: Array.isArray(p.requiredIds) ? p.requiredIds.filter((i: unknown) => sel.includes(i as string)) : [],
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

function moodText(v: number) {
  if (v < 25) return { t: '꼼꼼 모드', d: '빈틈 적게, 골라둔 곳 위주로 채워요.' };
  if (v < 50) return { t: '살짝 여유', d: '쉬는 시간을 조금 섞어요.' };
  if (v < 75) return { t: '반반 모드', d: '계획 반, 발길 닿는 대로 반.' };
  return { t: '일단 가보자', d: '빈 시간을 넉넉히 남겨 둬요.' };
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

function Pill({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'mint' | 'lav' }) {
  const c = tone === 'warn' ? 'bg-[hsl(42_90%_88%)] text-[hsl(30_60%_30%)]' : tone === 'mint' ? 'bg-secondary text-secondary-foreground' : 'bg-accent text-accent-foreground';
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap ${c}`}>{children}</span>;
}

export default function PlannerPage() {
  const initial = useMemo(loadInput, []);
  const [input, setInput] = useState<PlannerInput>(initial.input);
  const [loadError] = useState(initial.error);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(input));
      setSaveError(null);
    } catch {
      setSaveError('입력 내용을 이 브라우저에 저장하지 못했어요. 새로고침하면 사라질 수 있어요.');
    }
  }, [input]);

  const set = (patch: Partial<PlannerInput>) => { setInput((p) => ({ ...p, ...patch })); setError(null); };
  const toggleSel = (id: string) => {
    const on = input.selectedIds.includes(id);
    set({ selectedIds: on ? input.selectedIds.filter((x) => x !== id) : [...input.selectedIds, id], requiredIds: on ? input.requiredIds.filter((x) => x !== id) : input.requiredIds });
  };
  const toggleReq = (id: string) => set({ requiredIds: input.requiredIds.includes(id) ? input.requiredIds.filter((x) => x !== id) : [...input.requiredIds, id] });

  const go = (to: number) => {
    if (to > step) {
      if (step === 0) { const e = validateInput(input, false); if (e) return setError(e); }
      if (step >= 1) { const e = validateInput(input, true); if (e) return setError(e); }
      if (to === 3) {
        try { setResult(generateItinerary(input)); } catch (e) { return setError(e instanceof Error ? e.message : '초안을 만들지 못했어요.'); }
      }
    }
    setError(null);
    setStep(to);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const reset = () => {
    if (!window.confirm('저장된 날짜와 장소 선택을 지우고 처음부터 시작할까요?')) return;
    setInput(DEFAULT); setResult(null); setStep(0); setError(null);
  };

  const selected = places.filter((p) => input.selectedIds.includes(p.id));
  const mood = moodText(input.spontaneity);

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <header className="mx-auto w-full max-w-5xl px-5 pt-6 flex items-center justify-between">
        <button onClick={() => go(0)} data-testid="button-home" className="flex items-center gap-2 group">
          <Mascot className="w-10 h-10 transition-transform group-hover:rotate-[-8deg]" />
          <span className="font-display text-2xl">일단, 오사카</span>
        </button>
        <Pill tone="lav">규칙 기반 · 기기 안에서만 계산</Pill>
      </header>

      <div className="mx-auto w-full max-w-5xl px-5 mt-4">
        <div className="rounded-2xl border border-dashed border-[hsl(42_70%_70%)] bg-[hsl(42_90%_94%)] px-4 py-2.5 text-sm text-[hsl(30_50%_28%)] flex gap-2 items-start" data-testid="status-integrations">
          <MapPinOff className="w-4 h-4 mt-0.5 shrink-0" />
          <span><b>Google 지도 · 실제 이동 경로 · 실시간 정보 미연동</b> — 초안을 만드는 데는 지장 없어요. 출발 전 직접 확인해 주세요.</span>
        </div>
        {(loadError || saveError) && (
          <div className="mt-2 rounded-2xl bg-[hsl(4_80%_94%)] text-destructive px-4 py-2.5 text-sm flex gap-2" data-testid="status-storage-error">
            <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />{saveError ?? loadError}
          </div>
        )}
        {initial.restored && !loadError && step === 0 && (
          <p className="mt-2 text-xs text-muted-foreground" data-testid="text-restored">지난번에 입력하던 내용을 불러왔어요.</p>
        )}
      </div>

      <main className="mx-auto w-full max-w-5xl px-5 py-6 flex-1 grid gap-6 md:grid-cols-[220px_1fr]">
        <nav className="md:sticky md:top-6 self-start">
          <ol className="flex md:flex-col gap-2">
            {STEPS.map((s, i) => (
              <li key={s} className="flex-1">
                <button
                  data-testid={`button-step-${i}`}
                  onClick={() => i < step && go(i)}
                  disabled={i > step}
                  className={`w-full flex items-center gap-2 rounded-2xl px-3 py-2 text-left transition-all ${i === step ? 'bg-card shadow-[0_6px_0_hsl(352_60%_85%)] -translate-y-0.5' : i < step ? 'hover:bg-card/70' : 'opacity-50'}`}
                >
                  <span className={`grid place-items-center w-7 h-7 rounded-full text-sm font-display shrink-0 ${i < step ? 'bg-secondary text-secondary-foreground' : i === step ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                    {i < step ? <Check className="w-4 h-4" /> : i + 1}
                  </span>
                  <span className="hidden sm:inline text-sm font-bold">{s}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="hidden md:block mt-8 text-center">
            <Mascot className="w-28 h-28 mx-auto bob" />
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">타코 군이 옆에서<br />같이 고민해 줄게요.</p>
          </div>
        </nav>

        <section key={step} className="rise">
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <p className="text-primary font-bold text-sm">STEP 1</p>
                <h1 className="font-display text-4xl md:text-5xl leading-tight mt-1">계획은 귀찮으니까,<br />일단 날짜부터요.</h1>
              </div>
              <div className="rounded-3xl bg-card border p-5 grid sm:grid-cols-2 gap-4">
                {(['startDate', 'endDate'] as const).map((k) => (
                  <label key={k} className="block">
                    <span className="text-sm font-bold flex items-center gap-1.5"><CalendarDays className="w-4 h-4 text-primary" />{k === 'startDate' ? '도착하는 날' : '떠나는 날'}</span>
                    <input type="date" value={input[k]} onChange={(e) => set({ [k]: e.target.value })} data-testid={`input-${k}`}
                      className="mt-1.5 w-full rounded-2xl border-2 border-input bg-background px-3 py-2.5 outline-none focus:border-primary transition-colors" />
                  </label>
                ))}
              </div>
              <div className="rounded-3xl bg-card border p-5">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold">무계획력 (즉흥도)</p>
                    <p className="font-display text-2xl mt-1" data-testid="text-mood">{mood.t}</p>
                    <p className="text-sm text-muted-foreground">{mood.d}</p>
                  </div>
                  <span className="font-display text-5xl text-primary tabular-nums" data-testid="text-spontaneity">{input.spontaneity}<span className="text-2xl">%</span></span>
                </div>
                <input type="range" aria-label="무계획력" min={0} max={100} value={input.spontaneity} onChange={(e) => set({ spontaneity: Number(e.target.value) })} data-testid="input-spontaneity"
                  className="mt-4 w-full accent-[hsl(352_72%_64%)] h-2 cursor-pointer" />
                <div className="flex justify-between text-xs text-muted-foreground mt-1"><span>꽉 채워서</span><span>느슨하게</span></div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <p className="text-primary font-bold text-sm">STEP 2</p>
                <h1 className="font-display text-4xl leading-tight mt-1">끌리는 곳만 콕콕.</h1>
                <p className="text-muted-foreground mt-1">다섯 곳 정도면 딱 좋아요. 한 곳만 골라도 괜찮아요. 고르지 않은 곳은 초안에 절대 넣지 않아요.</p>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <Pill tone="lav">시연용 장소 목록</Pill>
                <Pill>모든 운영 정보 확인 필요</Pill>
                <span className="text-sm ml-auto font-bold" data-testid="text-selected-count">{selected.length}곳 선택</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {places.map((p, i) => {
                  const on = input.selectedIds.includes(p.id);
                  const open = openId === p.id;
                  return (
                    <div key={p.id} className={`rounded-3xl border-2 bg-card p-4 transition-all ${on ? 'border-primary shadow-[0_6px_0_hsl(352_60%_86%)] -translate-y-0.5' : 'border-transparent hover:border-border'}`} data-testid={`card-place-${p.id}`}>
                      <div className="flex gap-3">
                        <div className={`w-11 h-11 rounded-2xl shrink-0 grid place-items-center font-display text-lg ${TINTS[i % TINTS.length]}`}>{p.name.slice(0, 1)}</div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold leading-tight">{p.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{p.area} · {p.category}</p>
                        </div>
                        <button onClick={() => toggleSel(p.id)} data-testid={`button-select-${p.id}`} aria-label={`${p.name} ${on ? '선택 해제' : '선택'}`} aria-pressed={on}
                          className={`w-9 h-9 rounded-full grid place-items-center shrink-0 transition-all active:scale-90 ${on ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-[hsl(352_80%_92%)]'}`}>
                          {on ? <Check className="w-4 h-4 pop" /> : <span className="text-lg leading-none">+</span>}
                        </button>
                      </div>
                      <p className="text-sm mt-2 text-muted-foreground">{p.description}</p>
                      <button onClick={() => setOpenId(open ? null : p.id)} className="mt-2 text-xs font-bold text-accent-foreground underline underline-offset-4" data-testid={`button-details-${p.id}`}>
                        {open ? '운영 정보 접기' : '운영 정보 보기'}
                      </button>
                      {open && (
                        <dl className="mt-2 grid grid-cols-2 gap-1.5 text-xs pop">
                          {['운영 시간', '휴무일', '예약 필요 여부', '예약 마감'].map((f) => (
                            <div key={f} className="rounded-xl bg-muted px-2.5 py-1.5"><dt className="text-muted-foreground">{f}</dt><dd className="font-bold text-[hsl(30_60%_32%)]">확인 필요</dd></div>
                          ))}
                        </dl>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <p className="text-primary font-bold text-sm">STEP 3</p>
                <h1 className="font-display text-4xl leading-tight mt-1">이건 꼭, 싶은 곳은?</h1>
                <p className="text-muted-foreground mt-1">별을 누르면 먼저 일정에 넣어요. 표시 안 한 곳은 자리가 남을 때만 들어가요.</p>
              </div>
              <ul className="space-y-2">
                {selected.map((p) => {
                  const req = input.requiredIds.includes(p.id);
                  return (
                    <li key={p.id}>
                      <button onClick={() => toggleReq(p.id)} data-testid={`button-required-${p.id}`} aria-pressed={req}
                        className={`w-full flex items-center gap-3 rounded-3xl p-4 text-left border-2 transition-all active:scale-[.99] ${req ? 'bg-[hsl(42_90%_92%)] border-[hsl(42_80%_70%)]' : 'bg-card border-transparent hover:border-border'}`}>
                        <Star className={`w-6 h-6 transition-all ${req ? 'fill-[hsl(42_90%_60%)] text-[hsl(38_80%_50%)] scale-110' : 'text-muted-foreground'}`} />
                        <span className="flex-1"><b>{p.name}</b><span className="block text-xs text-muted-foreground">{p.area}</span></span>
                        <Pill tone={req ? 'warn' : 'mint'}>{req ? '꼭 갈 곳' : '가능하면'}</Pill>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {step === 3 && result && (
            <div className="space-y-5">
              <div>
                <p className="text-primary font-bold text-sm">STEP 4</p>
                <h1 className="font-display text-4xl leading-tight mt-1">짠, 일단 초안이에요.</h1>
                <p className="text-muted-foreground mt-1">{fmtDate(input.startDate)} – {fmtDate(input.endDate)} · 자유 시간 약 <b className="text-foreground" data-testid="text-free-percent">{Math.round(result.freePercent)}%</b></p>
              </div>
              <div className="rounded-3xl bg-accent/60 p-4 text-sm text-accent-foreground flex gap-2">
                <Info className="w-4 h-4 mt-0.5 shrink-0" />
                <p>이 초안은 앱 안의 간단한 규칙으로 만들었어요(AI 호출 없음). 하루를 <b>예시용 8시간</b>으로 보고 무계획력이 높을수록 자유 시간을 늘리며, 꼭 갈 곳부터 배치해요. 자유 시간은 배분 값일 뿐 이동·체류 시간 추정이 아니에요. 오전·오후 표시는 예시 순서이며, 실제 방문 가능 시간이나 운영·예약 가능 여부를 보장하지 않아요. 필수 장소가 많으면 자유 시간과 함께 모두 소화하기 어려울 수 있어요.</p>
              </div>
              <div className="space-y-4">
                {result.days.map((d, di) => (
                  <article key={d.date} className="rounded-3xl bg-card border overflow-hidden rise" style={{ animationDelay: `${di * 80}ms` }} data-testid={`card-day-${di}`}>
                    <div className="flex items-center justify-between px-5 py-3 bg-[hsl(352_80%_94%)]">
                      <h2 className="font-display text-xl">{di + 1}일차 <span className="text-sm text-muted-foreground font-sans">{fmtDate(d.date)}</span></h2>
                      <Pill tone="mint">자유 시간 {Math.floor(d.freeMinutes / 60)}시간{d.freeMinutes % 60 ? ` ${d.freeMinutes % 60}분` : ''}</Pill>
                    </div>
                    <ol className="p-4 space-y-2 dotgrid">
                      {d.visits.length === 0 && <li className="text-sm text-muted-foreground px-2 py-3">정해진 곳 없이 자유롭게 걷는 날이에요.</li>}
                      {d.visits.map((v, vi) => (
                        <li key={v.place.id} className="flex items-center gap-3 rounded-2xl bg-card border p-3" data-testid={`row-visit-${di}-${v.place.id}`}>
                          <span className="flex flex-col items-center text-xs text-muted-foreground w-12 shrink-0">
                            {vi < Math.ceil(d.visits.length / 2) ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                            {vi < Math.ceil(d.visits.length / 2) ? '오전쯤' : '오후쯤'}
                          </span>
                          <span className="flex-1 min-w-0"><b className="block truncate">{v.place.name}</b><span className="text-xs text-muted-foreground">{v.place.area}</span></span>
                          <span className="flex flex-col items-end gap-1">
                            {v.required && <Pill>꼭 갈 곳</Pill>}
                            <Pill tone="lav">확인 필요 초안</Pill>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </article>
                ))}
              </div>
              {result.unscheduled.length > 0 && (
                <div className="rounded-3xl border-2 border-dashed p-5" data-testid="section-unscheduled">
                  <h3 className="font-display text-xl">이번 초안엔 못 넣었어요</h3>
                  <p className="text-sm text-muted-foreground mt-1">일정이 짧거나 즉흥도가 높아서 하루 방문 수가 줄었고, 꼭 갈 곳을 먼저 채우다 보니 자리가 없었어요. 즉흥도를 낮추거나 날짜를 늘리면 들어갈 수 있어요.</p>
                  <div className="flex flex-wrap gap-2 mt-3">{result.unscheduled.map((p) => <span key={p.id} className="rounded-full bg-muted px-3 py-1 text-sm">{p.name}</span>)}</div>
                </div>
              )}
              <button onClick={reset} data-testid="button-reset" className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-foreground">
                <RotateCcw className="w-4 h-4" /> 처음부터 다시
              </button>
            </div>
          )}

          {error && (
            <div role="alert" className="mt-5 rounded-2xl bg-[hsl(4_80%_94%)] text-destructive px-4 py-3 text-sm font-bold flex gap-2 pop" data-testid="text-error">
              <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />{error}
            </div>
          )}

          {step < 3 && (
            <div className="mt-6 flex gap-3">
              {step > 0 && (
                <button onClick={() => go(step - 1)} data-testid="button-prev" className="rounded-full px-5 py-3 bg-card border font-bold inline-flex items-center gap-1.5 active:scale-95 transition-transform">
                  <ArrowLeft className="w-4 h-4" />이전
                </button>
              )}
              <button onClick={() => go(step + 1)} data-testid="button-next"
                className="flex-1 sm:flex-none rounded-full px-7 py-3 bg-primary text-primary-foreground font-display text-lg inline-flex items-center justify-center gap-2 shadow-[0_5px_0_hsl(352_55%_50%)] hover:-translate-y-0.5 active:translate-y-1 active:shadow-[0_1px_0_hsl(352_55%_50%)] transition-all">
                {step === 2 ? <><Sparkles className="w-5 h-5" />초안 만들기</> : <>다음<ArrowRight className="w-5 h-5" /></>}
              </button>
            </div>
          )}
        </section>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-5 pb-8 pt-4 text-xs text-muted-foreground border-t border-dashed" data-testid="text-footer">
        <p>일단, 오사카 · Team 14 · 미리보기 버전</p>
        <p className="mt-1">AI는 Replit Agent가 제작에 활용되었으며 앱 내 AI 호출은 없습니다.</p>
      </footer>
    </div>
  );
}

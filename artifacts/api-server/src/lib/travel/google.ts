import type { TravelCatalog, TravelPlace, TravelLeg, TravelService } from "@workspace/api-zod";
import { seedPlaces } from "./catalog";
import { attachOfficial } from "./official";

const TTL = 15 * 60_000;
const services = new Map<string, TravelService>();
const photoNames = new Map<string, string>();
const routeCache = new Map<string, { expires: number; leg: TravelLeg }>();
let catalogCache: { expires: number; value: TravelCatalog } | undefined;
let catalogPending: Promise<TravelCatalog> | undefined;
let probesAt = 0;

function status(name: string, state: string, message: string) {
  services.set(name, { name, status: state, message });
}

export function serviceSnapshot(): TravelService[] {
  return ["Google Places", "Google Routes", "Google 지도", "OpenAI"].map(name =>
    services.get(name) ?? {
      name, status: "unchecked", message: name === "OpenAI" ? "실제 AI 요청은 버튼을 누를 때만 실행합니다." : "아직 실제 요청을 확인하지 않았어요.",
    });
}

function safeError(service: string, error: unknown): string {
  const key = process.env.GOOGLE_MAP_KEY;
  const aiKey = process.env.OPENAI_API_KEY;
  let message = error instanceof Error ? error.message : "NETWORK_ERROR";
  if (key) message = message.replaceAll(key, "[비공개]");
  if (aiKey) message = message.replaceAll(aiKey, "[비공개]");
  return `${service} 미연동/오류: ${message.slice(0, 350)}. API 활성화·결제·키의 서버 요청 권한을 확인해 주세요.`;
}

async function googleJson(url: string, body: object, fields: string): Promise<any> {
  if (!process.env.GOOGLE_MAP_KEY) throw new Error("키 없음");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_MAP_KEY,
      "X-Goog-FieldMask": fields,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json() as { error?: { status?: string; details?: { reason?: string }[] } };
  if (!response.ok) {
    const reason = data.error?.details?.find(x => x.reason)?.reason;
    throw new Error(`HTTP ${response.status} ${data.error?.status ?? ""} ${reason ?? ""}`);
  }
  return data;
}

async function mapProbe() {
  if (!process.env.GOOGLE_MAP_KEY) { status("Google 지도", "error", "GOOGLE_MAP_KEY 없음 · 지도 미연동"); return; }
  try {
    const u = new URL("https://maps.googleapis.com/maps/api/staticmap");
    u.search = new URLSearchParams({ center: "34.68,135.50", zoom: "11", size: "160x100", key: process.env.GOOGLE_MAP_KEY }).toString();
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    if (!r.ok || !r.headers.get("content-type")?.startsWith("image/")) throw new Error(`HTTP ${r.status}`);
    await r.arrayBuffer();
    status("Google 지도", "connected", "Google 지도 이미지 응답 확인 · 서버 프록시 사용, 키는 화면에 전달하지 않음");
  } catch (e) { status("Google 지도", "error", safeError("Google 지도", e)); }
}

async function aiProbe() {
  if (!process.env.OPENAI_API_KEY) { status("OpenAI", "error", "OPENAI_API_KEY 없음 · AI 미연동, 직접 입력은 사용 가능"); return; }
  try {
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await r.arrayBuffer();
    status("OpenAI", "available", "인증·모델 조회 확인. AI 요청 반영·공식 정보 확인 버튼에서만 AI를 호출하며, 일정 배치는 규칙 기반입니다.");
  } catch (e) { status("OpenAI", "error", safeError("OpenAI", e)); }
}

async function mapLimit<T, R>(items: T[], fn: (item: T) => Promise<R>, limit = 4): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}

export async function getCatalog(): Promise<TravelCatalog> {
  const enriched = (c: TravelCatalog): TravelCatalog => ({ ...c, places: c.places.map(attachOfficial), services: serviceSnapshot() });
  if (catalogCache && catalogCache.expires > Date.now()) return enriched(catalogCache.value);
  if (catalogPending) return enriched(await catalogPending);
  catalogPending = (async () => {
    const checkedAt = new Date().toISOString();
    const probes = Date.now() - probesAt > TTL ? Promise.all([mapProbe(), aiProbe()]) : Promise.resolve();
    probesAt = Date.now();
    const places = await mapLimit(seedPlaces, async ({ search, ...base }): Promise<TravelPlace> => {
      try {
        const d = await googleJson("https://places.googleapis.com/v1/places:searchText", {
          textQuery: search, languageCode: "ko", pageSize: 1,
          locationBias: { circle: { center: { latitude: 34.68, longitude: 135.50 }, radius: 20000 } },
        }, "places.id,places.displayName,places.location,places.formattedAddress,places.googleMapsUri,places.websiteUri,places.regularOpeningHours,places.currentOpeningHours,places.rating,places.photos,places.businessStatus");
        const p = d.places?.[0];
        if (!p?.id || !p.location || Math.abs(p.location.latitude - 34.68) > 0.2 || Math.abs(p.location.longitude - 135.5) > 0.3)
          throw new Error("오사카 내 일치 장소를 확인하지 못함");
        if (p.photos?.[0]?.name) photoNames.set(base.id, p.photos[0].name);
        return {
          ...base, googleId: p.id, lat: p.location.latitude, lng: p.location.longitude,
          address: p.formattedAddress, mapsUrl: p.googleMapsUri, websiteUrl: p.websiteUri, rating: p.rating,
          openingHours: p.regularOpeningHours, currentHours: p.currentOpeningHours,
          businessStatus: p.businessStatus, checkedAt,
          ...(p.photos?.[0]?.name ? {
            photoUrl: `/api/travel/photo/${encodeURIComponent(base.id)}`,
            photoAuthors: (p.photos[0].authorAttributions ?? []).map((a: any) => a.displayName).filter(Boolean),
          } : {}),
        };
      } catch (e) {
        return { ...base, error: safeError("Google Places", e), mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(search)}` };
      }
    });
    await probes;
    const count = places.filter(p => p.googleId).length;
    status("Google Places", count === places.length ? "connected" : count ? "partial" : "error",
      `${count}/${places.length}개 장소 실제 조회. ${count < places.length ? places.find(p => p.error)?.error : "운영시간은 Google 제공 정보이며 여행일의 임시 휴무·입장 마감은 별도 확인 필요."}`);
    const value: TravelCatalog = { places, checkedAt, services: serviceSnapshot() };
    catalogCache = { expires: Date.now() + TTL, value };
    return value;
  })();
  try { return enriched(await catalogPending); } finally { catalogPending = undefined; }
}

export async function getLeg(from: TravelPlace, to: TravelPlace): Promise<TravelLeg> {
  const cacheKey = `${from.id}:${to.id}`;
  const cached = routeCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.leg;
  let leg: TravelLeg;
  try {
    if (from.lat === undefined || to.lat === undefined || from.lng === undefined || to.lng === undefined) throw new Error("장소 좌표 확인 필요");
    const d = await googleJson("https://routes.googleapis.com/directions/v2:computeRoutes", {
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: "WALK", languageCode: "ko", units: "METRIC",
    }, "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline");
    const r = d.routes?.[0];
    const seconds = Number(String(r?.duration ?? "").replace(/s$/, ""));
    if (!r || !Number.isFinite(r.distanceMeters) || !Number.isFinite(seconds) || !r.polyline?.encodedPolyline) throw new Error("실제 도보 경로 없음");
    leg = { fromId: from.id, toId: to.id, status: "connected", distanceMeters: r.distanceMeters, durationSeconds: seconds, polyline: r.polyline.encodedPolyline };
  } catch (e) {
    leg = { fromId: from.id, toId: to.id, status: "error", error: safeError("Google Routes", e) };
  }
  routeCache.set(cacheKey, { expires: Date.now() + (leg.status === "connected" ? 30 * 60_000 : 60_000), leg });
  return leg;
}

export async function getRouteMatrix(places: TravelPlace[]): Promise<Record<string, TravelLeg>> {
  const pairs = places.flatMap(from => places.filter(to => to.id !== from.id).map(to => ({ from, to })));
  const legs = await mapLimit(pairs, ({ from, to }) => getLeg(from, to));
  const count = legs.filter(l => l.status === "connected").length;
  status("Google Routes", !legs.length ? "unchecked" : count === legs.length ? "connected" : count ? "partial" : "error",
    !legs.length ? "두 장소 이상 배치할 때 실제 도보 경로를 계산해요." : `${count}/${legs.length}방향 도보 경로 확인. ${count < legs.length ? legs.find(l => l.error)?.error : "거리·시간은 Google 예측값이며 실시간 교통·현장 통행은 보장하지 않아요."}`);
  return Object.fromEntries(legs.map(leg => [`${leg.fromId}:${leg.toId}`, leg]));
}

export function mapViewport(places: TravelPlace[]): { lat: number; lng: number; zoom: number } | undefined {
  const points = places.filter(p => p.lat !== undefined && p.lng !== undefined);
  if (!points.length) return undefined;
  const lat = (Math.min(...points.map(p => p.lat!)) + Math.max(...points.map(p => p.lat!))) / 2;
  const lng = (Math.min(...points.map(p => p.lng!)) + Math.max(...points.map(p => p.lng!))) / 2;
  let zoom = 15;
  const project = (latitude: number) => {
    const s = Math.sin(latitude * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256;
  };
  while (zoom > 7) {
    const scale = 2 ** zoom;
    const w = (Math.max(...points.map(p => p.lng!)) - Math.min(...points.map(p => p.lng!))) / 360 * 256 * scale;
    const ys = points.map(p => project(p.lat!));
    const h = (Math.max(...ys) - Math.min(...ys)) * scale;
    if (w < 520 && h < 240) break;
    zoom--;
  }
  return { lat, lng, zoom };
}

export async function fetchMap(ids: string[]): Promise<{ content: Buffer; contentType: string }> {
  const cat = await getCatalog();
  const selected = ids.map(id => cat.places.find(p => p.id === id)).filter((p): p is TravelPlace => !!p);
  const view = mapViewport(selected);
  if (!view || !process.env.GOOGLE_MAP_KEY) throw new Error("좌표 또는 지도 키 확인 필요");
  const u = new URL("https://maps.googleapis.com/maps/api/staticmap");
  u.search = new URLSearchParams({
    center: `${view.lat},${view.lng}`, zoom: String(view.zoom), size: "640x360", scale: "1",
    maptype: "roadmap", language: "ko", key: process.env.GOOGLE_MAP_KEY,
  }).toString();
  for (let i = 1; i < selected.length; i++) {
    const leg = await getLeg(selected[i - 1], selected[i]);
    if (leg.status === "connected" && leg.polyline) u.searchParams.append("path", `color:0x2563ebff|weight:4|enc:${leg.polyline}`);
  }
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
  if (!r.ok || !r.headers.get("content-type")?.startsWith("image/")) {
    status("Google 지도", "error", `지도 미연동 · HTTP ${r.status}. Maps Static API 권한 확인 필요`);
    throw new Error("Google 지도 이미지 요청 실패");
  }
  return { content: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get("content-type") ?? "image/png" };
}

export async function fetchPhoto(id: string): Promise<{ content: Buffer; contentType: string } | null> {
  await getCatalog();
  const name = photoNames.get(id);
  if (!name || !/^places\/[^/]+\/photos\/[^/]+$/.test(name) || !process.env.GOOGLE_MAP_KEY) return null;
  const u = new URL(`https://places.googleapis.com/v1/${name}/media`);
  u.searchParams.set("maxWidthPx", "640");
  const r = await fetch(u, {
    headers: { "X-Goog-Api-Key": process.env.GOOGLE_MAP_KEY },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok || !r.headers.get("content-type")?.startsWith("image/")) return null;
  return { content: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get("content-type") ?? "image/jpeg" };
}

export function setAiResult(ok: boolean, message: string) {
  status("OpenAI", ok ? "connected" : "error", message);
}

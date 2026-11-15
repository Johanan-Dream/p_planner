export type Place = {
  id: string;
  name: string;
  area: string;
  category: string;
  description: string;
};

export const places: Place[] = [
  { id: 'dotonbori', name: '도톤보리', area: '난바', category: '거리', description: '오사카를 떠올리게 하는 강변과 화려한 간판' },
  { id: 'osaka-castle', name: '오사카성', area: '오사카성', category: '명소', description: '성곽과 공원 풍경을 만나고 싶은 날' },
  { id: 'usj', name: '유니버설 스튜디오 재팬', area: '베이 에어리어', category: '테마파크', description: '마음에 담아둔 테마파크에서의 하루' },
  { id: 'umeda-sky', name: '우메다 스카이 빌딩', area: '우메다', category: '전망', description: '도시를 다른 높이에서 바라보는 시간' },
  { id: 'kuromon', name: '구로몬 시장', area: '난바', category: '시장', description: '골목을 둘러보며 시장 분위기를 느끼는 곳' },
  { id: 'shinsekai', name: '신세카이', area: '신세카이', category: '거리', description: '오사카의 오래된 간판과 거리 풍경' },
  { id: 'kaiyukan', name: '가이유칸', area: '베이 에어리어', category: '수족관', description: '바다 생물을 만나고 싶은 여행자를 위한 선택' },
  { id: 'shinsaibashi', name: '신사이바시', area: '신사이바시', category: '쇼핑', description: '취향에 맞는 가게를 천천히 구경하는 거리' },
];

export type PlannerInput = {
  startDate: string;
  endDate: string;
  spontaneity: number;
  selectedIds: string[];
  requiredIds: string[];
};

function parseDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) return null;
  return stamp;
}

export function validateInput(input: PlannerInput, requirePlaces = false): string | null {
  if (!input.startDate || !input.endDate) return '여행 시작일과 종료일을 모두 선택해 주세요.';
  const start = parseDate(input.startDate);
  const end = parseDate(input.endDate);
  if (start === null || end === null) return '올바른 여행 날짜를 입력해 주세요.';
  if (end < start) return '종료일은 시작일보다 빠를 수 없어요. 날짜를 다시 확인해 주세요.';
  if ((end - start) / 86400000 >= 366) return '이번 시제품은 최대 366일의 여행을 지원해요. 기간을 줄여 주세요.';
  if (!Number.isFinite(input.spontaneity) || input.spontaneity < 0 || input.spontaneity > 100) return '무계획력은 0~100% 사이로 선택해 주세요.';
  if (!Array.isArray(input.selectedIds) || !Array.isArray(input.requiredIds)) return '장소 선택을 다시 확인해 주세요.';
  const known = new Set(places.map(place => place.id));
  if (input.selectedIds.some(id => !known.has(id))) return '시연용 목록에 있는 장소를 선택해 주세요.';
  if (input.requiredIds.some(id => !input.selectedIds.includes(id))) return '필수 장소는 선택한 장소 중에서 지정해 주세요.';
  if (requirePlaces && input.selectedIds.length === 0) return '가고 싶은 장소를 한 곳 이상 선택해 주세요.';
  return null;
}

export function generateItinerary(input: PlannerInput) {
  const error = validateInput(input, true);
  if (error) throw new Error(error);
  const start = parseDate(input.startDate)!;
  const count = Math.round((parseDate(input.endDate)! - start) / 86400000) + 1;
  const selected = places.filter(place => input.selectedIds.includes(place.id));
  const required = selected.filter(place => input.requiredIds.includes(place.id));
  const optional = selected.filter(place => !input.requiredIds.includes(place.id));
  const days = Array.from({ length: count }, (_, i) => ({
    date: new Date(start + i * 86400000).toISOString().slice(0, 10),
    visits: [] as { place: Place; required: boolean }[],
    freeMinutes: 480,
  }));
  // Required places are retained regardless of the preferred daily density.
  required.forEach((place, i) => days[i % count].visits.push({ place, required: true }));
  const capacity = Math.max(1, 4 - Math.floor(input.spontaneity / 34));
  const unscheduled: Place[] = [];
  optional.forEach(place => {
    const day = days.find(day => day.visits.length < capacity);
    if (day) day.visits.push({ place, required: false });
    else unscheduled.push(place);
  });
  // This is a planning allowance, not an assertion about visit or travel duration.
  days.forEach(day => {
    day.freeMinutes = day.visits.length ? Math.round(60 + input.spontaneity * 3) : 480;
  });
  const freePercent = Math.round(days.reduce((sum, day) => sum + day.freeMinutes, 0) / (count * 480) * 100);
  return { days, unscheduled, freePercent };
}

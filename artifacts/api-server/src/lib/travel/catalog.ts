import type { TravelPlace } from "@workspace/api-zod";

export const seedPlaces: (TravelPlace & { search: string })[] = [
  { id: "dotonbori", name: "도톤보리", area: "난바", category: "거리", description: "강변과 오사카의 간판 풍경", search: "道頓堀 大阪 観光" },
  { id: "osaka-castle", name: "오사카성", area: "오사카성", category: "명소", description: "성곽과 공원에서 만나는 오사카", search: "大阪城 天守閣 大阪" },
  { id: "usj", name: "유니버설 스튜디오 재팬", area: "베이 에어리어", category: "테마파크", description: "여행에 특별한 하루를 더하는 테마파크", search: "Universal Studios Japan Osaka" },
  { id: "umeda-sky", name: "우메다 스카이 빌딩", area: "우메다", category: "전망", description: "높은 곳에서 바라보는 도시", search: "梅田スカイビル 大阪" },
  { id: "kuromon", name: "구로몬 시장", area: "난바", category: "시장", description: "시장의 가게와 골목 둘러보기", search: "黒門市場 大阪" },
  { id: "shinsekai", name: "신세카이", area: "신세카이", category: "거리", description: "오래된 간판이 반기는 거리", search: "新世界 大阪" },
  { id: "kaiyukan", name: "가이유칸", area: "베이 에어리어", category: "수족관", description: "바다 생물을 만나는 수족관", search: "海遊館 大阪" },
  { id: "shinsaibashi", name: "신사이바시", area: "신사이바시", category: "쇼핑", description: "취향에 맞는 가게를 찾는 쇼핑 거리", search: "心斎橋筋商店街 大阪" },
];

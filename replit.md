# 피플랜

팀 14의 한국인 오사카 자유여행자용 모바일 우선 일정 초안 시제품. 공개 게시 없이 Preview에서만 검토한다.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

- 날짜·무계획력·선택/필수 장소·활동시간·장소별 지정시간 및 체류시간으로 날짜별 초안을 만든다.
- Google Places 운영정보와 Routes의 도보 경로를 서버에서 조회한다. Google 정적 지도 이미지 위 번호 선택을 일정과 연동한다.
- 추가 요청 해석은 선택적인 명시적 OpenAI 호출이다. 일정 배치는 규칙 기반이며 미선택 장소는 사용자 확정 없이 추가하지 않는다.
- 예약·입장 마감 등 검증되지 않은 정보는 ‘확인 필요’. 충돌하는 필수 조건은 삭제하지 않는다. 100% 완전 즉흥형은 사전 배치를 강제하지 않는다.
- QA 범위·실제 결과·한계는 `docs/qa-2026-11-15.md`에 기록했다.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

# naver-database-api

네이버 데이터랩 API 전체 수집/분석 서버. 검색어 트렌드 + 쇼핑인사이트의 모든 필터 경우의 수를 12시간마다 자동 수집하여 DB에 축적합니다.

## 네이버 데이터랩 API 커버리지

### 검색어 트렌드 (1개 엔드포인트)
- 통합 검색어 트렌드 조회 — 모든 필터 조합 (기기×성별×연령×시간단위)

### 쇼핑인사이트 (8개 엔드포인트)
- 분야별 트렌드 조회
- 분야 내 기기별 트렌드
- 분야 내 성별 트렌드
- 분야 내 연령별 트렌드
- 키워드별 트렌드 조회
- 키워드 기기별 트렌드
- 키워드 성별 트렌드
- 키워드 연령별 트렌드

### 필터 경우의 수 (검색어 트렌드)
| 필터 | 옵션 수 |
|------|---------|
| 시간단위 | 3 (일/주/월) |
| 기기 | 3 (전체/PC/모바일) |
| 성별 | 3 (전체/남/여) |
| 연령 | 12 (전체 + 11개 연령대) |
| **합계** | **324 조합 × 키워드 그룹** |

## 기술 스택
- TypeScript, Express
- SQLite (better-sqlite3)
- Croner (12시간 주기 스케줄링)

## 시작하기

### 1. 네이버 API 키 발급
[네이버 개발자센터](https://developers.naver.com/apps/) → 애플리케이션 등록 → 데이터랩(검색어트렌드) + 쇼핑인사이트 선택

### 2. 설치
```bash
npm install
cp .env.example .env
# .env 파일에 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET 입력
```

### 3. DB 초기화
```bash
npm run db:init
```

### 4. 키워드/카테고리 등록
```bash
# 키워드 등록
curl -X POST http://localhost:3100/api/keywords \
  -H "Content-Type: application/json" \
  -d '{"groupName":"AI","keywords":["인공지능","ChatGPT","클로드"]}'

# 쇼핑 카테고리 등록 (네이버 쇼핑 카테고리 코드)
curl -X POST http://localhost:3100/api/categories \
  -H "Content-Type: application/json" \
  -d '{"name":"패션의류","code":"50000000"}'
```

### 5. 실행
```bash
# 서버 시작 (12시간 자동 수집 포함)
npm run dev

# 수동 수집
npm run collect
```

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/status` | 서버 상태 + 수집 통계 |
| GET | `/api/jobs` | 수집 이력 |
| GET/POST | `/api/keywords` | 추적 키워드 관리 |
| DELETE | `/api/keywords/:id` | 키워드 비활성화 |
| GET/POST | `/api/categories` | 추적 카테고리 관리 |
| GET | `/api/trends/search` | 검색어 트렌드 조회 |
| GET | `/api/trends/shopping` | 쇼핑 트렌드 조회 |

### 트렌드 조회 쿼리 파라미터
```
GET /api/trends/search?keyword=AI&timeUnit=month&device=mo&gender=f&age=3&limit=50
GET /api/trends/shopping?categoryCode=50000000&limit=50
```

## 향후 계획
- Viewtory 프로젝트 연동 API
- 트렌드 상승/하락 자동 감지
- 키워드 추천 엔진

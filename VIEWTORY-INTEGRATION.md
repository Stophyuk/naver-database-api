# Viewtory ↔ 데이터센터 연동 가이드

## 1. 데이터센터 API 목록

Base URL: `http://localhost:3100/api`

### 1-1. 통합 분석 `GET /api/keyword-analysis/:keyword`

키워드의 모든 수집/분석 데이터를 한 번에 반환.

```bash
curl http://localhost:3100/api/keyword-analysis/캠핑용품
```

**응답:**
```json
{
  "keyword": "캠핑용품",
  "cached": true,
  "stats": {
    "monthlyPcCnt": 12000,
    "monthlyMobileCnt": 45000,
    "monthlyPcClk": 800,
    "monthlyMobileClk": 3200,
    "pcCtr": 0.066,
    "mobileCtr": 0.071,
    "compIdx": "중간",
    "plAvgDepth": 15,
    "collectedAt": "2026-02-28T03:00:00Z"
  },
  "trend": {
    "direction": "rising",
    "recentWeekAvg": 72.5,
    "previousWeekAvg": 65.3,
    "changePercent": 11.0,
    "weeklyData": [{"period": "2026-02-21", "ratio": 75}]
  },
  "saturation": {
    "blogTotal": 123000,
    "newsTotal": 45000,
    "shopTotal": 89000,
    "cafeTotal": 23000,
    "kinTotal": 5600
  },
  "suggestions": ["캠핑용품 추천", "캠핑용품 리스트"],
  "relatedKeywords": [
    {"keyword": "캠핑텐트", "monthlyPcCnt": 8000, "monthlyMobileCnt": 32000, "compIdx": "중간"}
  ],
  "analysis": {
    "blueOceanScore": 72.5,
    "opportunityScore": 68.3,
    "trending": {"direction": "rising", "changeRatio": 1.11}
  },
  "updatedAt": "2026-02-28T03:00:00Z"
}
```

`cached: false`이면 데이터 없음 → Viewtory가 직접 수집 후 POST /api/keyword-request로 등록.

### 1-2. 키워드 등록 `POST /api/keyword-request`

```bash
curl -X POST http://localhost:3100/api/keyword-request \
  -H "Content-Type: application/json" \
  -d '{"keywords": ["캠핑용품", "백패킹"]}'
```

**응답:**
```json
{
  "registered": ["캠핑용품"],
  "alreadyTracked": ["백패킹"],
  "nextCollection": "2026-02-28T15:00:00Z"
}
```

### 1-3. AI Verdict `GET /api/keyword-verdict/:keyword`

```bash
curl http://localhost:3100/api/keyword-verdict/캠핑용품
```

**응답:**
```json
{
  "keyword": "캠핑용품",
  "verdict": "GO",
  "ranking": "월 57,000 검색, 경쟁도 중간, 블루오션 점수 75점. 충분한 검색량 대비 경쟁이 적정 수준.",
  "strategy": "모바일 비중 80%, 안정 트렌드. 블로그 경쟁 5,230건 — 차별화된 앵글 필요. 정보성 콘텐츠로 빠른 진입 추천.",
  "impact": "상위 3위 진입 시 월 약 600명 유입 예상. 꾸준한 검색량으로 장기 트래픽원 가능.",
  "estimatedMonthlyTraffic": 600,
  "analyzedAt": "2026-02-28T03:00:00Z"
}
```

---

## 2. Viewtory `analyze/route.ts` 수정 가이드

### Phase 0: 데이터센터 조회 추가

```typescript
// app/analyze/route.ts (서버 액션 또는 API route)

const DATACENTER_URL = process.env.DATACENTER_URL || "http://localhost:3100/api";

async function fetchFromDatacenter(keyword: string) {
  try {
    const [analysisRes, verdictRes] = await Promise.all([
      fetch(`${DATACENTER_URL}/keyword-analysis/${encodeURIComponent(keyword)}`, {
        signal: AbortSignal.timeout(3000),
      }),
      fetch(`${DATACENTER_URL}/keyword-verdict/${encodeURIComponent(keyword)}`, {
        signal: AbortSignal.timeout(3000),
      }),
    ]);

    const analysis = await analysisRes.json();
    const verdict = await verdictRes.json();

    if (analysis.cached) {
      return { hit: true, analysis, verdict };
    }
    return { hit: false };
  } catch {
    return { hit: false };
  }
}

// 기존 analyze 함수에서:
export async function analyzeKeyword(keyword: string) {
  // Phase 0: 데이터센터 캐시 확인
  const dc = await fetchFromDatacenter(keyword);

  if (dc.hit) {
    // 캐시 히트 → 데이터센터 데이터 사용
    return {
      source: "datacenter",
      ...dc.analysis,
      verdict: dc.verdict,
    };
  }

  // Phase 1~3: 기존 로직 (직접 API 호출)
  const result = await existingAnalyzeLogic(keyword);

  // 분석 완료 후 데이터센터에 등록 (비동기, fire-and-forget)
  fetch(`${DATACENTER_URL}/keyword-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keywords: [keyword] }),
  }).catch(() => {});

  return result;
}
```

---

## 3. `claude.ts` 프롬프트 수정 가이드

Verdict 데이터가 있으면 Claude 프롬프트에 포함:

```typescript
// claude.ts에서 프롬프트 구성 시

function buildPrompt(keyword: string, data: any, verdict: any) {
  let prompt = `키워드 "${keyword}" 분석:\n`;

  // 기존 데이터 섹션...

  if (verdict?.verdict) {
    prompt += `\n## AI 사전 판정\n`;
    prompt += `- 판정: ${verdict.verdict}\n`;
    prompt += `- 근거: ${verdict.ranking}\n`;
    prompt += `- 전략: ${verdict.strategy}\n`;
    prompt += `- 기대효과: ${verdict.impact}\n`;
    prompt += `- 예상 월 유입: ${verdict.estimatedMonthlyTraffic}명\n`;
    prompt += `\n위 사전 판정을 참고하되, 추가 분석 데이터를 종합하여 최종 판단해주세요.\n`;
  }

  return prompt;
}
```

---

## 4. `KeywordTab.tsx` UI 수정 가이드 (3-Section 카드)

### Section 1: Verdict 카드 (상단)
```tsx
function VerdictCard({ verdict }: { verdict: VerdictData }) {
  const color = verdict.verdict === "GO" ? "green"
    : verdict.verdict === "CAUTION" ? "yellow" : "red";

  return (
    <div className={`border-l-4 border-${color}-500 p-4 rounded`}>
      <div className="flex items-center gap-2">
        <span className={`text-2xl font-bold text-${color}-600`}>
          {verdict.verdict}
        </span>
        <span className="text-sm text-gray-500">
          예상 월 {verdict.estimatedMonthlyTraffic}명 유입
        </span>
      </div>
      <p className="mt-2 text-sm">{verdict.ranking}</p>
      <p className="mt-1 text-sm text-gray-600">{verdict.strategy}</p>
      <p className="mt-1 text-sm text-gray-500">{verdict.impact}</p>
    </div>
  );
}
```

### Section 2: 핵심 지표 (stats + trend + saturation)
```tsx
function MetricsSection({ data }: { data: AnalysisData }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {/* 검색량 */}
      <div className="p-3 bg-gray-50 rounded">
        <div className="text-xs text-gray-500">월 검색량</div>
        <div className="text-lg font-semibold">
          {(data.stats.monthlyPcCnt + data.stats.monthlyMobileCnt).toLocaleString()}
        </div>
      </div>
      {/* 경쟁도 */}
      <div className="p-3 bg-gray-50 rounded">
        <div className="text-xs text-gray-500">경쟁도</div>
        <div className="text-lg font-semibold">{data.stats.compIdx}</div>
      </div>
      {/* 트렌드 */}
      <div className="p-3 bg-gray-50 rounded">
        <div className="text-xs text-gray-500">트렌드</div>
        <div className="text-lg font-semibold">
          {data.trend?.direction === "rising" ? "📈" : data.trend?.direction === "falling" ? "📉" : "➡️"}
          {data.trend?.changePercent}%
        </div>
      </div>
    </div>
  );
}
```

### Section 3: 연관 키워드 + 자동완성
```tsx
function RelatedSection({ data }: { data: AnalysisData }) {
  return (
    <div className="grid grid-cols-2 gap-4 mt-4">
      <div>
        <h4 className="text-sm font-medium mb-2">연관 키워드</h4>
        {data.relatedKeywords?.slice(0, 10).map(rk => (
          <div key={rk.keyword} className="flex justify-between text-sm py-1">
            <span>{rk.keyword}</span>
            <span className="text-gray-400">
              {(rk.monthlyPcCnt + rk.monthlyMobileCnt).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
      <div>
        <h4 className="text-sm font-medium mb-2">자동완성</h4>
        {data.suggestions?.slice(0, 10).map(s => (
          <div key={s} className="text-sm py-1">{s}</div>
        ))}
      </div>
    </div>
  );
}
```

---

## 5. 환경 변수

Viewtory `.env`에 추가:
```
DATACENTER_URL=http://localhost:3100/api
```

## 6. 주의사항

- 데이터센터 API 타임아웃: 3초 권장 (장애 시 기존 로직 fallback)
- API 호출 한도: Naver 1000/day (Viewtory와 공유), SearchAd는 별도
- Demographics 수집: 1일1회, 00:00 KST
- 키워드 등록 후 실제 데이터 수집은 다음 크론 실행 시 (12시간 간격)

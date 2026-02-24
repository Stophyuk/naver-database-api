import { config, RATE_LIMIT } from "../config";

let dailyCallCount = 0;
let lastResetDate = new Date().toDateString();

function checkDailyLimit() {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    dailyCallCount = 0;
    lastResetDate = today;
  }
  if (dailyCallCount >= RATE_LIMIT.dailyMax) {
    throw new Error(`일일 API 호출 한도 초과 (${RATE_LIMIT.dailyMax}회)`);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callNaverAPI(url: string, body: object): Promise<any> {
  checkDailyLimit();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Naver-Client-Id": config.naver.clientId,
      "X-Naver-Client-Secret": config.naver.clientSecret,
    },
    body: JSON.stringify(body),
  });

  dailyCallCount++;

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`네이버 API 오류 (${res.status}): ${errText}`);
  }

  await sleep(RATE_LIMIT.delayMs);
  return res.json();
}

export function getDailyCallCount() {
  return dailyCallCount;
}

import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GAMES = ["대항해시대 오리진", "언디셈버", "창세기전 모바일"];

if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY 환경변수가 없습니다.");
  process.exit(1);
}

// 사용 가능한 모델 목록 동적 조회
async function getAvailableModels() {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.models || [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace("models/", ""));
}

// 우선순위 모델 목록 (실제 사용 가능한 것만 필터링됨)
// gemini-2.0-flash / gemini-2.0-flash-lite 는 이 프로젝트에서 limit:0 → 제외
const PREFERRED_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-3.5-flash",
  "gemini-flash-lite-latest",
  "gemini-flash-latest",
];

const availableModels = await getAvailableModels();
console.log("사용 가능한 모델:", availableModels.join(", "));

const GEMINI_MODELS = PREFERRED_MODELS.filter((m) =>
  availableModels.length === 0 || availableModels.includes(m)
);

async function callGemini(prompt) {
  let lastErr;
  for (const model of GEMINI_MODELS) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
        })
      }
    );
    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      console.log(`  → 모델 사용: ${model}`);
      return text;
    }
    const errText = await res.text();
    console.warn(`  [${model}] 실패 (${res.status}): ${errText.slice(0, 200)}`);
    lastErr = new Error(`Gemini API ${res.status} (${model}): ${errText}`);
    if (res.status === 503) {
      // 일시적 과부하 — 같은 모델 10초 후 1회 재시도
      console.warn(`  [${model}] 10초 후 재시도...`);
      await new Promise((r) => setTimeout(r, 10000));
      const retry = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 2048 } }) }
      );
      if (retry.ok) {
        const data = await retry.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
    }
    // 다음 모델 시도: 404, 429, 400, 503
    if (![404, 429, 400, 503].includes(res.status)) throw lastErr;
    if (res.status === 429) await new Promise((r) => setTimeout(r, 3000));
  }
  throw lastErr;
}

function buildPrompt(game, posts, period, dateLabel) {
  const lines = posts.map((p) =>
    `- [${p.sentiment === "positive" ? "긍정" : p.sentiment === "negative" ? "부정" : "중립"}] ${p.title}${p.badges.length ? ` (키워드: ${p.badges.join(", ")})` : ""}`
  ).join("\n");

  return `당신은 모바일 게임 커뮤니티 동향 분석가입니다.
아래는 "${game}" 게임 커뮤니티에서 ${dateLabel} 수집된 게시글 목록입니다.

${lines}

다음 형식으로 한국어 요약을 작성해주세요. 각 항목은 2~3문장 이내로 간결하게 작성하세요.

**주요 이슈**: 오늘 가장 많이 언급된 문제나 화제
**유저 반응**: 전반적인 긍부정 분위기와 이유
**주목할 키워드**: 반복 등장한 키워드와 맥락
**한줄 요약**: 전체 분위기를 한 문장으로`;
}

async function summarizeGame(game, posts, period, dateLabel) {
  if (!posts.length) return { summary: "수집된 게시글이 없습니다.", postCount: 0 };
  try {
    const prompt = buildPrompt(game, posts.slice(0, 80), period, dateLabel);
    const text = await callGemini(prompt);
    return { summary: text, postCount: posts.length };
  } catch (err) {
    console.error(`[${game}] 요약 실패:`, err.message);
    return { summary: "요약 생성 중 오류가 발생했습니다.", postCount: posts.length, error: err.message };
  }
}

// history.json 로드
const historyPath = join(__dirname, "../history.json");
let allPosts = [];
try {
  const raw = await readFile(historyPath, "utf-8");
  allPosts = JSON.parse(raw).posts || [];
} catch {
  console.error("history.json을 읽지 못했습니다.");
  process.exit(1);
}

// ── app.js의 parsePostDate와 동일한 로직 ─────────────
function parsePostDate(post) {
  const date = String(post.date || "");
  if (!date) return null;
  const base = new Date(post.fetchedAt || Date.now());
  let match;
  match = date.match(/(\d+)\s*분\s*전/);
  if (match) return new Date(base.getTime() - Number(match[1]) * 60_000);
  match = date.match(/(\d+)\s*시간\s*전/);
  if (match) return new Date(base.getTime() - Number(match[1]) * 3_600_000);
  match = date.match(/(\d+)\s*일\s*전/);
  if (match) return new Date(base.getTime() - Number(match[1]) * 86_400_000);
  if (/방금/.test(date)) return base;
  // 네이버 카페: '2026. 06. 08. PM 02:16'
  match = date.match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})\D+(AM|PM)\s+(\d{1,2}):(\d{2})/i);
  if (match) {
    let h = Number(match[5]);
    const pm = match[4].toUpperCase() === "PM";
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), h, Number(match[6]));
  }
  // 일반: '2026-06-10 11:35' / '2026-06-10 11:35:22' / '2026.06.10 11:35:22'
  match = date.match(/(20\d{2})[-.]\s*(\d{1,2})[-.]\s*(\d{1,2})(?:\D+(\d{1,2}):(\d{1,2}))?/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0));
  return null;
}

// KST 기준 날짜 비교용 날짜 문자열 반환
function postDateKST(post) {
  const d = parsePostDate(post);
  if (!d || isNaN(d)) return null;
  // parsePostDate는 로컬 new Date() 사용 → Actions(UTC)에서 KST로 보정 필요
  // fetchedAt 기반 상대시각은 이미 UTC 기준이므로 +9h 보정
  const isRelative = /방금|분\s*전|시간\s*전|일\s*전/.test(post.date || "");
  const kst = isRelative ? new Date(d.getTime() + 9 * 3_600_000) : d;
  const p = (n) => String(n).padStart(2, "0");
  return `${kst.getFullYear()}-${p(kst.getMonth() + 1)}-${p(kst.getDate())}`;
}

// KST 기준 날짜 범위 계산
const now = new Date();
const kstNow = new Date(now.getTime() + 9 * 3_600_000);
const p2 = (n) => String(n).padStart(2, "0");
const kstTodayStr = `${kstNow.getUTCFullYear()}-${p2(kstNow.getUTCMonth() + 1)}-${p2(kstNow.getUTCDate())}`;
// 일간: 전날 하루 (매일 09:00 KST 생성 기준, 전일 00:00~23:59)
const kstYesterday = new Date(kstNow.getTime() - 86_400_000);
const kstYesterdayStr = `${kstYesterday.getUTCFullYear()}-${p2(kstYesterday.getUTCMonth() + 1)}-${p2(kstYesterday.getUTCDate())}`;
// 주간: 7일 전 이후
const kstWeekAgoStr = new Date(kstNow.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);

console.log(`KST 기준 — 어제: ${kstYesterdayStr}, 7일 전: ${kstWeekAgoStr}`);

const dailyResult = {};
const weeklyResult = {};

for (const game of GAMES) {
  const gamePosts = allPosts.filter((p) => p.game === game);
  const dailyPosts = gamePosts.filter((p) => postDateKST(p) === kstYesterdayStr);
  const weekPosts  = gamePosts.filter((p) => { const d = postDateKST(p); return d && d >= kstWeekAgoStr; });

  console.log(`[${game}] 전일: ${dailyPosts.length}건, 주간: ${weekPosts.length}건`);

  const dailyLabel = `${kstYesterdayStr} 하루 동안`;
  const weeklyLabel = `${kstWeekAgoStr} ~ ${kstTodayStr} 주간`;
  dailyResult[game]  = await summarizeGame(game, dailyPosts, "daily",  dailyLabel);
  weeklyResult[game] = await summarizeGame(game, weekPosts,  "weekly", weeklyLabel);

  // Gemini 무료 tier rate limit 방지
  await new Promise((r) => setTimeout(r, 2000));
}

const summary = {
  generatedAt: new Date().toISOString(),
  kstDate: kstTodayStr,
  daily: dailyResult,
  weekly: weeklyResult
};

const outPath = join(__dirname, "../summary.json");
await writeFile(outPath, JSON.stringify(summary, null, 2));
console.log(`✓ summary.json 생성 완료 (${kstTodayStr} KST 기준)`);

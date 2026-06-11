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
const PREFERRED_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-preview-05-20",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash-exp",
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
    // 다음 모델 시도: 404(없는 모델), 429(할당량 초과), 400(잘못된 요청)
    // 그 외(401 인증오류 등)는 즉시 throw
    if (res.status !== 404 && res.status !== 429 && res.status !== 400) throw lastErr;
    if (res.status === 429) await new Promise((r) => setTimeout(r, 3000));
  }
  throw lastErr;
}

function buildPrompt(game, posts, period) {
  const lines = posts.map((p) =>
    `- [${p.sentiment === "positive" ? "긍정" : p.sentiment === "negative" ? "부정" : "중립"}] ${p.title}${p.badges.length ? ` (키워드: ${p.badges.join(", ")})` : ""}`
  ).join("\n");

  return `당신은 모바일 게임 커뮤니티 동향 분석가입니다.
아래는 "${game}" 게임 커뮤니티에서 ${period === "daily" ? "오늘" : "이번 주"} 수집된 게시글 목록입니다.

${lines}

다음 형식으로 한국어 요약을 작성해주세요. 각 항목은 2~3문장 이내로 간결하게 작성하세요.

**주요 이슈**: 오늘 가장 많이 언급된 문제나 화제
**유저 반응**: 전반적인 긍부정 분위기와 이유
**주목할 키워드**: 반복 등장한 키워드와 맥락
**한줄 요약**: 전체 분위기를 한 문장으로`;
}

async function summarizeGame(game, posts, period) {
  if (!posts.length) return { summary: "수집된 게시글이 없습니다.", postCount: 0 };
  try {
    const prompt = buildPrompt(game, posts.slice(0, 80), period); // 토큰 절약
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

// 날짜 필터
const now = new Date();
const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC 기준, KST+9 보정)
const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
const kstTodayStr = kstNow.toISOString().slice(0, 10);
const kstWeekAgo = new Date(kstNow.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function getPostDate(post) {
  // date 필드: "YYYY-MM-DD HH:mm" 형식(KST) — 앞 10자리가 날짜
  if (post.date && post.date.length >= 10) return post.date.slice(0, 10);
  // fallback: fetchedAt
  if (post.fetchedAt) {
    return new Date(new Date(post.fetchedAt).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  return "";
}

const dailyResult = {};
const weeklyResult = {};

for (const game of GAMES) {
  const gamePosts = allPosts.filter((p) => p.game === game);
  const todayPosts = gamePosts.filter((p) => getPostDate(p) === kstTodayStr);
  const weekPosts  = gamePosts.filter((p) => getPostDate(p) >= kstWeekAgo);

  console.log(`[${game}] 오늘: ${todayPosts.length}건, 주간: ${weekPosts.length}건`);

  dailyResult[game]  = await summarizeGame(game, todayPosts, "daily");
  weeklyResult[game] = await summarizeGame(game, weekPosts,  "weekly");

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

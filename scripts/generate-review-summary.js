import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const GAMES = ["대항해시대 오리진", "언디셈버", "창세기전 모바일"];
const API_KEY = process.env.GEMINI_API_KEY;

// ── Gemini API 호출 ───────────────────────────────────
async function callGemini(prompt) {
  const models = ["gemini-2.5-flash", "gemini-1.5-flash"];
  let lastErr;
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 600 }
        }),
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) {
        const err = await res.text().catch(() => "");
        lastErr = new Error(`Gemini API ${res.status} (${model}): ${err.slice(0, 200)}`);
        console.warn(`  [${model}] 실패:`, lastErr.message);
        continue;
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      if (!text) { lastErr = new Error(`Empty response (${model})`); continue; }
      console.log(`  → 모델 사용: ${model}`);
      return text;
    } catch (e) {
      lastErr = e;
      console.warn(`  [${model}] 예외:`, e.message);
    }
  }
  throw lastErr || new Error("모든 모델 실패");
}

// ── 게임별 요약 생성 ──────────────────────────────────
async function summarizeGame(game, reviews) {
  if (!reviews.length) {
    return { positive: null, negative: null, urgent: null };
  }

  const reviewText = reviews.slice(0, 60).map((r) => {
    const sent = r.store === "steam"
      ? (r.rating >= 4 ? "긍정" : "부정")
      : (r.rating >= 4 ? "긍정" : r.rating <= 2 ? "부정" : "중립");
    const body = (r.title ? `[${r.title}] ${r.content}` : r.content).slice(0, 180);
    return `[${sent}] ${body}`;
  }).join("\n");

  const prompt = `다음은 모바일 게임 "${game}"의 최근 30일 스토어 리뷰입니다.

${reviewText}

아래 JSON 형식으로만 응답하세요. 마크다운 없이 순수 JSON만 출력하세요.
각 값은 한국어로 핵심 내용을 1~2문장으로 요약하세요.
즉각 대응이 필요한 심각한 이슈가 없으면 urgent는 null로 하세요.

{"positive":"긍정 반응 요약","negative":"부정 반응 요약","urgent":null}`;

  try {
    const raw = await callGemini(prompt);
    // ```json ... ``` 래핑 제거
    const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(text);
    const clean = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
    return {
      positive: clean(parsed.positive),
      negative: clean(parsed.negative),
      urgent:   clean(parsed.urgent)
    };
  } catch (err) {
    console.error(`  [${game}] 요약 실패:`, err.message);
    return { positive: null, negative: null, urgent: null };
  }
}

// ── 감성 판정 ─────────────────────────────────────────
function sentiment(r) {
  if (r.store === "steam") return r.rating >= 4 ? "positive" : "negative";
  if (r.rating >= 4) return "positive";
  if (r.rating <= 2) return "negative";
  return "neutral";
}

// ── Main ─────────────────────────────────────────────
if (!API_KEY) {
  console.error("GEMINI_API_KEY가 설정되지 않았습니다.");
  process.exit(1);
}

const reviewsPath = join(__dirname, "../reviews.json");
let allReviews = [];
try {
  allReviews = JSON.parse(await readFile(reviewsPath, "utf-8")).reviews || [];
} catch (err) {
  console.error("reviews.json 읽기 실패:", err.message);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const recentReviews = allReviews.filter(r => r.date && r.date >= cutoff);

console.log(`\n최근 30일(${cutoff} ~ ${today}) 리뷰 ${recentReviews.length}개`);

const summaries = [];

for (const game of GAMES) {
  const gameReviews = recentReviews.filter(r => r.game === game);
  const posCount = gameReviews.filter(r => sentiment(r) === "positive").length;
  const negCount = gameReviews.filter(r => sentiment(r) === "negative").length;
  const ratings  = gameReviews.map(r => r.rating).filter(n => n > 0);
  const avgRating = ratings.length
    ? parseFloat((ratings.reduce((s, n) => s + n, 0) / ratings.length).toFixed(1))
    : null;

  console.log(`\n[${game}] ${gameReviews.length}개 (긍정 ${posCount}, 부정 ${negCount})`);

  const { positive, negative, urgent } = gameReviews.length > 0
    ? await summarizeGame(game, gameReviews)
    : { positive: null, negative: null, urgent: null };

  summaries.push({ game, reviewCount: gameReviews.length, posCount, negCount, avgRating, positive, negative, urgent });

  if (GAMES.indexOf(game) < GAMES.length - 1) {
    await new Promise(r => setTimeout(r, 1000)); // rate limit
  }
}

const result = {
  generatedAt: new Date().toISOString(),
  from: cutoff,
  to: today,
  summaries
};

const summaryPath = join(__dirname, "../review-summary.json");
await writeFile(summaryPath, JSON.stringify(result, null, 2));
console.log(`\n✓ review-summary.json 저장 완료`);

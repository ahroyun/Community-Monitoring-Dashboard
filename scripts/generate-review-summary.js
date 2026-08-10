import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const GAMES = ["대항해시대 오리진", "언디셈버", "창세기전 모바일"];
const API_KEY = process.env.ANTHROPIC_API_KEY;

// ── Claude API 호출 ───────────────────────────────────
async function callClaude(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }]
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.content[0].text.trim();
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

위 리뷰들을 분석하여 정확히 아래 형식으로만 응답해주세요. 각 항목은 핵심 키워드 중심으로 2줄 이내 간결하게.

긍정: (주요 긍정 반응 요약)
부정: (주요 부정 반응 요약)
긴급: (즉각 대응이 필요한 심각한 이슈가 있으면 1줄, 없으면 "없음")`;

  try {
    const text = await callClaude(prompt);
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    const get = (prefix) => {
      const line = lines.find(l => l.startsWith(prefix));
      if (!line) return null;
      const val = line.slice(prefix.length).trim();
      return val === "없음" ? null : val || null;
    };
    return {
      positive: get("긍정:"),
      negative: get("부정:"),
      urgent:   get("긴급:")
    };
  } catch (err) {
    console.error(`  [${game}] Claude 요약 실패:`, err.message);
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
  console.error("ANTHROPIC_API_KEY가 설정되지 않았습니다.");
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

import { chromium } from "playwright";
import { writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ONESTORE_APPS = [
  { game: "창세기전 모바일", appId: "0000773185" }
];

const ONE_YEAR_AGO = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

function parseDate(str) {
  if (!str) return null;
  str = str.trim();
  const abs = str.match(/(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})/);
  if (abs) return `${abs[1]}-${abs[2].padStart(2,"0")}-${abs[3].padStart(2,"0")}`;
  const kor = str.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (kor) return `${kor[1]}-${kor[2].padStart(2,"0")}-${kor[3].padStart(2,"0")}`;
  const dayAgo = str.match(/(\d+)일\s*전/);
  if (dayAgo) return new Date(Date.now() - parseInt(dayAgo[1]) * 86400000).toISOString().slice(0,10);
  const hrAgo = str.match(/(\d+)시간\s*전/);
  if (hrAgo)  return new Date(Date.now() - parseInt(hrAgo[1])  * 3600000).toISOString().slice(0,10);
  if (/방금|분\s*전/.test(str)) return new Date().toISOString().slice(0,10);
  return null;
}

function makeId(content, date) {
  return `onestore_${(content + date).replace(/\W/g,"").slice(-60)}`;
}

// JSON 응답에서 리뷰 배열을 재귀적으로 탐색
function extractReviews(obj, depth = 0) {
  if (depth > 6 || !obj || typeof obj !== "object") return [];
  const results = [];

  if (Array.isArray(obj)) {
    for (const item of obj) {
      // 리뷰처럼 생긴 객체 판별: 텍스트 + 평점 필드 조합
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const keys = Object.keys(item).map(k => k.toLowerCase());
        const hasContent = keys.some(k => ["content","body","text","comment","reviewcontent","reviewbody","review"].includes(k));
        const hasRating  = keys.some(k => ["rating","score","star","grade","evaluation"].includes(k));
        if (hasContent && hasRating) {
          results.push(item);
          continue;
        }
      }
      results.push(...extractReviews(item, depth + 1));
    }
  } else {
    for (const val of Object.values(obj)) {
      results.push(...extractReviews(val, depth + 1));
    }
  }
  return results;
}

function normalizeReview(raw, gameName) {
  // 필드명 후보들 탐색
  const get = (...keys) => {
    for (const k of keys) {
      const found = Object.keys(raw).find(rk => rk.toLowerCase() === k.toLowerCase());
      if (found && raw[found] !== undefined && raw[found] !== null) return raw[found];
    }
    return null;
  };

  const content = String(get("content","body","text","comment","reviewContent","reviewBody") || "").trim();
  if (!content) return null;

  const ratingRaw = get("rating","score","star","grade","evaluation","starScore","starGrade");
  const rating = Math.min(5, Math.max(1, Math.round(parseFloat(ratingRaw) || 3)));

  const dateRaw = String(get("date","regDate","registDate","createDate","writtenDate","reviewDate","updatedAt","createdAt") || "");
  const date = parseDate(dateRaw) || new Date().toISOString().slice(0,10);

  if (date < ONE_YEAR_AGO.toISOString().slice(0,10)) return null;

  const author = String(get("author","writer","nickname","userId","userName","userNm","memberId") || "").trim();
  const title  = String(get("title","subject","reviewTitle") || "").trim();

  return {
    id: makeId(content, date),
    game: gameName,
    store: "onestore",
    rating,
    title,
    content,
    date,
    author,
    playtime: null,
    thumbsUp: parseInt(get("likeCount","helpfulCount","thumbsUp","voteUp") || 0),
    version: String(get("version","appVersion") || ""),
    fetchedAt: new Date().toISOString()
  };
}

async function scrapeApp(appId, gameName) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
    locale: "ko-KR",
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { "Accept-Language": "ko-KR,ko;q=0.9" }
  });
  const page = await context.newPage();

  const captured = [];  // 가로챈 API 응답들

  // ── 네트워크 응답 인터셉트 ───────────────────────────
  page.on("response", async (res) => {
    const url = res.url();
    const ct  = res.headers()["content-type"] || "";

    // 모든 요청 URL 로그 (진단용)
    if (!url.includes("_next/static") && !url.includes(".png") && !url.includes(".jpg")
        && !url.includes(".ico") && !url.includes(".css") && !url.includes(".js")) {
      console.log(`  [네트워크] ${res.status()} ${url.slice(0, 120)}`);
    }

    if (!ct.includes("application/json") && !ct.includes("text/plain")) return;
    try {
      const json = await res.json();
      captured.push({ url, json });
    } catch { /* binary or parse error */ }
  });

  try {
    const url = `https://m.onestore.co.kr/v2/ko-kr/app/${appId}`;
    console.log(`  → ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

    // ── 리뷰 섹션까지 스크롤해서 로딩 트리거 ───────────
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.5));
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);

    // ── "모든 리뷰 보기" / "전체 리뷰" 버튼 클릭 시도 ──
    const moreReviewSelectors = [
      'a:has-text("모든 리뷰")',
      'button:has-text("모든 리뷰")',
      'a:has-text("전체 리뷰")',
      'button:has-text("전체 리뷰")',
      'a:has-text("리뷰 더보기")',
      'a:has-text("더보기"):near(:has-text("평점 및 리뷰"))',
      'a[href*="review"]:not([href*="policy"])',
      '[class*="review"] a:not([href*="policy"])',
      '[class*="review"] button',
    ];

    let clicked = false;
    for (const sel of moreReviewSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 })) {
          console.log(`  클릭: ${sel}`);
          await el.click();
          await page.waitForTimeout(2000);
          // 클릭 후 추가 스크롤 + 대기
          for (let i = 0; i < 5; i++) {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(1200);
            // "더보기" 버튼 반복 클릭
            const more = page.locator('button:has-text("더보기"), button:has-text("더 보기")').first();
            if (await more.isVisible({ timeout: 800 }).catch(() => false)) {
              await more.click();
              await page.waitForTimeout(1200);
            } else break;
          }
          clicked = true;
          break;
        }
      } catch { /* 없으면 다음 */ }
    }

    if (!clicked) {
      console.warn(`  "모든 리뷰 보기" 버튼을 찾지 못했습니다.`);
      // 클릭 없이 가로챈 JSON에서 리뷰 탐색
    }

    await page.waitForTimeout(1000);

  } catch (err) {
    console.error(`  [${gameName}] 오류:`, err.message);
  } finally {
    await browser.close();
  }

  // ── 가로챈 응답에서 리뷰 추출 ───────────────────────
  console.log(`  가로챈 JSON 응답 ${captured.length}개`);

  const reviews = [];
  const seenIds = new Set();

  // review 관련 URL 우선 처리
  const sorted = [
    ...captured.filter(c => /review/i.test(c.url)),
    ...captured.filter(c => !/review/i.test(c.url)),
  ];

  for (const { url, json } of sorted) {
    const candidates = extractReviews(json);
    if (candidates.length) {
      console.log(`  └ ${url.slice(0, 80)}... → ${candidates.length}개 후보`);
    }
    for (const raw of candidates) {
      const r = normalizeReview(raw, gameName);
      if (r && !seenIds.has(r.id)) {
        seenIds.add(r.id);
        reviews.push(r);
      }
    }
  }

  return reviews;
}

// ── Main ─────────────────────────────────────────────
const reviewsPath = join(__dirname, "../reviews.json");
let existing = [];
try {
  existing = JSON.parse(await readFile(reviewsPath, "utf-8")).reviews || [];
} catch { /* 없으면 빈 배열 */ }

const existingIds = new Set(existing.map(r => r.id));
const newReviews  = [];

for (const app of ONESTORE_APPS) {
  console.log(`\n[${app.game}] OneStore 수집 중...`);
  const fetched = await scrapeApp(app.appId, app.game);
  const fresh   = fetched.filter(r => !existingIds.has(r.id));
  console.log(`  수집: ${fetched.length}개 / 신규: ${fresh.length}개`);
  newReviews.push(...fresh);
}

const cutoff = ONE_YEAR_AGO.toISOString().slice(0,10);
const merged  = [...existing, ...newReviews].filter(r => !r.date || r.date >= cutoff);

await writeFile(reviewsPath, JSON.stringify({ generatedAt: new Date().toISOString(), reviews: merged }));
console.log(`\n✓ OneStore 리뷰 ${newReviews.length}개 추가, 총 ${merged.length}개 저장`);

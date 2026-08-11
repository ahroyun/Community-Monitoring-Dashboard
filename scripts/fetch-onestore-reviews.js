import { chromium } from "playwright";
import { writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ONESTORE_APPS = [
  { game: "창세기전 모바일", appId: "0000773185" }
];

const MAX_PAGES   = 10;   // "더보기" 최대 클릭 횟수
const MAX_REVIEWS = 300;
const ONE_YEAR_AGO = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

// ── 날짜 파싱 ─────────────────────────────────────────
function parseDate(str) {
  if (!str) return null;
  str = str.trim();

  // "2024.01.15" or "2024-01-15"
  const abs = str.match(/(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})/);
  if (abs) return `${abs[1]}-${abs[2].padStart(2,"0")}-${abs[3].padStart(2,"0")}`;

  // "2024년 1월 15일"
  const kor = str.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (kor) return `${kor[1]}-${kor[2].padStart(2,"0")}-${kor[3].padStart(2,"0")}`;

  // 상대 날짜 "N일 전" / "N시간 전" / "N분 전"
  const dayAgo = str.match(/(\d+)일\s*전/);
  if (dayAgo) {
    const d = new Date(Date.now() - parseInt(dayAgo[1]) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const hrAgo = str.match(/(\d+)시간\s*전/);
  if (hrAgo) {
    const d = new Date(Date.now() - parseInt(hrAgo[1]) * 3600000);
    return d.toISOString().slice(0, 10);
  }
  if (/방금|분\s*전/.test(str)) return new Date().toISOString().slice(0, 10);

  return null;
}

function makeId(raw) {
  return `onestore_${String(raw).replace(/\W/g, "").slice(-60)}`;
}

// ── 단일 앱 스크래핑 ──────────────────────────────────
async function scrapeApp(appId, gameName) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
    locale: "ko-KR",
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { "Accept-Language": "ko-KR,ko;q=0.9" }
  });
  const page = await context.newPage();
  const reviews = [];
  const seenContent = new Set();

  try {
    const url = `https://m.onestore.co.kr/v2/ko-kr/app/${appId}`;
    console.log(`  → ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

    // ── 리뷰 탭 클릭 시도 ──
    const tabSelectors = [
      'a[href*="review"]',
      'button:has-text("리뷰")',
      'a:has-text("리뷰")',
      '[role="tab"]:has-text("리뷰")',
      'li:has-text("리뷰") button',
    ];
    for (const sel of tabSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 })) {
          await el.click();
          await page.waitForTimeout(1500);
          console.log(`  리뷰 탭 클릭: ${sel}`);
          break;
        }
      } catch { /* 없으면 다음 시도 */ }
    }

    // ── 리뷰 아이템 selector 탐색 ──
    const ITEM_SELECTORS = [
      "[class*='review-item']",
      "[class*='reviewItem']",
      "[class*='ReviewItem']",
      "[class*='review_item']",
      "[class*='ReviewListItem']",
      "[class*='review-list'] li",
      "[class*='ReviewList'] li",
      "ul[class*='review'] > li",
    ];

    let itemSelector = null;
    for (const sel of ITEM_SELECTORS) {
      const count = await page.locator(sel).count();
      if (count > 0) {
        itemSelector = sel;
        console.log(`  리뷰 selector 발견: ${sel} (${count}개)`);
        break;
      }
    }

    if (!itemSelector) {
      console.warn(`  [${gameName}] 리뷰 요소를 찾지 못했습니다. 페이지 구조 확인 필요.`);
      // 디버그용: 페이지 내 class 목록 일부 출력
      const classes = await page.evaluate(() =>
        [...new Set([...document.querySelectorAll("*")].map(e => e.className).filter(c => typeof c === "string" && c.includes("review")).slice(0, 20))]
      );
      console.log("  review 포함 class 목록:", classes);
      return [];
    }

    // ── 페이지네이션 루프 ──
    for (let p = 0; p < MAX_PAGES && reviews.length < MAX_REVIEWS; p++) {
      const items = await page.locator(itemSelector).all();

      for (const item of items) {
        if (reviews.length >= MAX_REVIEWS) break;

        // rating: aria-label "N점" or data-* or star count
        let rating = 0;
        try {
          const ratingEl = item.locator("[aria-label*='점'], [class*='star'][aria-label], [class*='Star'][aria-label]").first();
          const ariaLabel = await ratingEl.getAttribute("aria-label");
          const m = ariaLabel?.match(/(\d)/);
          if (m) rating = parseInt(m[1]);
        } catch {}

        if (!rating) {
          // filled star 개수 세기
          try {
            rating = await item.locator("[class*='filled'], [class*='active'], [class*='Full'], [class*='on']").count();
          } catch {}
        }

        // content
        let content = "";
        try {
          const contentEl = item.locator("[class*='content'], [class*='body'], [class*='text'], [class*='desc'], p").first();
          content = (await contentEl.textContent())?.trim() || "";
        } catch {}
        if (!content) continue;
        if (seenContent.has(content)) continue;

        // date
        let date = null;
        try {
          const dateEl = item.locator("[class*='date'], [class*='Date'], time").first();
          const raw = await dateEl.textContent();
          date = parseDate(raw);
        } catch {}
        date ??= new Date().toISOString().slice(0, 10);

        if (date < ONE_YEAR_AGO.toISOString().slice(0, 10)) continue;

        // author
        let author = "";
        try {
          const authorEl = item.locator("[class*='author'], [class*='nick'], [class*='user'], [class*='name']").first();
          author = (await authorEl.textContent())?.trim() || "";
        } catch {}

        seenContent.add(content);
        reviews.push({
          id: makeId(content + date),
          game: gameName,
          store: "onestore",
          rating: Math.min(5, Math.max(1, rating || 3)),
          title: "",
          content,
          date,
          author,
          playtime: null,
          thumbsUp: 0,
          version: "",
          fetchedAt: new Date().toISOString()
        });
      }

      // "더보기" 버튼 찾기
      const moreSelectors = [
        "button:has-text('더보기')",
        "button:has-text('더 보기')",
        "a:has-text('더보기')",
        "[class*='more'] button",
        "[class*='More'] button",
        "[class*='load-more']",
      ];
      let clicked = false;
      for (const sel of moreSelectors) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 1500 })) {
            await btn.click();
            await page.waitForTimeout(2000);
            clicked = true;
            break;
          }
        } catch {}
      }
      if (!clicked) break;
    }

  } catch (err) {
    console.error(`  [${gameName}] 스크래핑 오류:`, err.message);
  } finally {
    await browser.close();
  }

  return reviews;
}

// ── Main ─────────────────────────────────────────────
const reviewsPath = join(__dirname, "../reviews.json");
let existing = [];
try {
  existing = JSON.parse(await readFile(reviewsPath, "utf-8")).reviews || [];
} catch { /* 없으면 빈 배열 */ }

const existingIds = new Set(existing.map((r) => r.id));
const newReviews = [];

for (const app of ONESTORE_APPS) {
  console.log(`\n[${app.game}] OneStore 수집 중...`);
  const fetched = await scrapeApp(app.appId, app.game);
  const fresh = fetched.filter((r) => !existingIds.has(r.id));
  console.log(`  수집: ${fetched.length}개 / 신규: ${fresh.length}개`);
  newReviews.push(...fresh);
}

// 기존 리뷰(non-onestore) + 기존 onestore 최신 + 신규 병합
const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const merged = [...existing, ...newReviews].filter((r) => !r.date || r.date >= cutoff);

await writeFile(reviewsPath, JSON.stringify({ generatedAt: new Date().toISOString(), reviews: merged }));
console.log(`\n✓ OneStore 리뷰 ${newReviews.length}개 추가, 총 ${merged.length}개 저장`);

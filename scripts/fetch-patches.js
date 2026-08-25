import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PATCH_SOURCES = [
  {
    game: "대항해시대 오리진",
    type: "floor",
    url: "https://uwo.floor.line.games/kr/bbs/notice/notice_kr/1"
  },
  {
    game: "언디셈버",
    type: "floor",
    url: "https://ud.floor.line.games/kr/bbs/notice/notice_kr/1"
  },
  {
    game: "창세기전 모바일",
    type: "naverGame",
    loungeId: "theplayofgenesis",
    boardId: 12,
    url: "https://game.naver.com/lounge/theplayofgenesis/board/12"
  }
];

// 패치/업데이트 게시글 식별 키워드
const PATCH_KEYWORDS = ["점검", "패치", "업데이트"];

// 제외 키워드: 제목에 포함되면 스킵
const EXCLUDE_KEYWORDS = [
  "연기", "취소", "연장", "지연",       // 점검 연기/취소
  "미리보기", "예고", "사전 안내",       // 사전 예고 (실제 일정 아님)
  "판매", "상품", "패키지",             // 판매 관련 공지
  "[완료]", "[종료]", "[완료됨]", "[종료됨]", // 점검 완료 공지 (원본과 중복)
];

function decodeEntities(value = "") {
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([a-f0-9]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

function cleanText(value = "") {
  return decodeEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function formatTimestamp(value) {
  const ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const d = new Date(ts + 9 * 3600000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function formatNaverGameDate(value = "") {
  if (!/^\d{14}$/.test(value)) return value.slice(0, 10);
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

// 제목에서 실제 점검/패치 날짜 추출 (공지 게시일보다 우선)
function extractDateFromTitle(title, fetchedAt) {
  const year = new Date(fetchedAt).getUTCFullYear();
  let m;
  // "8월 14일", "08월 06일" 형식
  m = title.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (m) return `${year}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
  // "8/20", "07/23" 형식
  m = title.match(/(\d{1,2})\/(\d{1,2})/);
  if (m) return `${year}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
  return null;
}

// 상대시각(3일 전 등) → ISO 날짜
function resolveDate(dateStr, fetchedAt) {
  if (!dateStr) return new Date(fetchedAt).toISOString().slice(0, 10);
  const base = new Date(fetchedAt);
  let m;
  m = dateStr.match(/(\d+)\s*분\s*전/); if (m) return new Date(base - Number(m[1]) * 60000).toISOString().slice(0, 10);
  m = dateStr.match(/(\d+)\s*시간\s*전/); if (m) return new Date(base - Number(m[1]) * 3600000).toISOString().slice(0, 10);
  m = dateStr.match(/(\d+)\s*일\s*전/); if (m) return new Date(base - Number(m[1]) * 86400000).toISOString().slice(0, 10);
  if (/방금/.test(dateStr)) return base.toISOString().slice(0, 10);
  m = dateStr.match(/(20\d{2})[.\-]\s*(\d{1,2})[.\-]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  return new Date(fetchedAt).toISOString().slice(0, 10);
}

// ── FLOOR 공지 스크래핑 ──────────────────────────────
async function fetchFloorPatches(source) {
  try {
    const res = await fetch(source.url, {
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "ko-KR,ko;q=0.9",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return [];
    const html = await res.text();
    const now = new Date().toISOString();
    const patches = [];
    const seen = new Set();
    const itemRegex = /<a\b(?=[^>]*class="[^"]*\bbbs-detail-link\b[^"]*")([^>]*)>([\s\S]*?)<\/a>/gi;
    for (const [, attrs, body] of html.matchAll(itemRegex)) {
      const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1] || "";
      if (!/\/[a-z]{2}\/bbs[^/]*\/detail\/\d+/.test(href)) continue;
      const title = cleanText(body.match(/<div[^>]*class="[^"]*noti-tit[^"]*"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || body);
      if (!title || title.length < 2) continue;
      if (!PATCH_KEYWORDS.some((k) => title.includes(k))) continue;
      if (EXCLUDE_KEYWORDS.some((k) => title.includes(k))) continue;
      const rawDate = cleanText(body.match(/<p[^>]*class="[^"]*ago[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");
      if (!rawDate) continue; // 날짜 없는 항목 = 상단 고정 공지 → 스킵
      const date = extractDateFromTitle(title, now) || resolveDate(rawDate, now);
      if (seen.has(href)) continue;
      seen.add(href);
      const fullUrl = new URL(href, source.url).href;
      patches.push({
        id: fullUrl.replace(/https?:\/\//, "").replace(/\W/g, "").slice(-60),
        game: source.game,
        title,
        date,
        url: fullUrl,
        fetchedAt: now
      });
    }
    return patches;
  } catch (err) {
    console.error(`[${source.game}] FLOOR 공지 실패:`, err.message);
    return [];
  }
}

// ── 네이버 게임라운지 공지 ───────────────────────────
async function fetchNaverGamePatches(source) {
  try {
    const query = new URLSearchParams({ offset: "0", limit: "30", order: "NEW", boardId: String(source.boardId), buffFilteringYN: "N" });
    const apiUrl = `https://comm-api.game.naver.com/nng_main/v1/community/lounge/${source.loungeId}/feed?${query}`;
    const res = await fetch(apiUrl, {
      headers: {
        "accept": "application/json",
        "accept-language": "ko-KR,ko;q=0.9",
        "referer": source.url,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return [];
    const payload = await res.json();
    const feeds = payload?.content?.feeds || [];
    return feeds
      .filter((item) => {
        const title = item.feed?.title || item.title || "";
        return PATCH_KEYWORDS.some((k) => title.includes(k)) && !EXCLUDE_KEYWORDS.some((k) => title.includes(k));
      })
      .map((item) => {
        const feed = item.feed || item;
        const title = cleanText(feed.title || "");
        const now = new Date().toISOString();
        const date = extractDateFromTitle(title, now) || formatNaverGameDate(feed.createdDate || "");
        return {
          id: `naver_${source.loungeId}_${feed.feedId || feed.articleId}`,
          game: source.game,
          title,
          date,
          url: `https://game.naver.com/lounge/${source.loungeId}/board/${source.boardId}/${feed.feedId || feed.articleId}`,
          fetchedAt: new Date().toISOString()
        };
      });
  } catch (err) {
    console.error(`[${source.game}] 네이버 공지 실패:`, err.message);
    return [];
  }
}

// ── Main ─────────────────────────────────────────────
const patchesPath = join(__dirname, "../patches.json");
let existing = [];
try {
  existing = JSON.parse(await readFile(patchesPath, "utf-8")).patches || [];
} catch { /* 없으면 빈 배열 */ }

const existingIds = new Set(existing.map((p) => p.id));
const newPatches = [];

for (const source of PATCH_SOURCES) {
  const patches = source.type === "floor"
    ? await fetchFloorPatches(source)
    : await fetchNaverGamePatches(source);
  const fresh = patches.filter((p) => !existingIds.has(p.id));
  console.log(`[${source.game}] 패치 ${patches.length}개 (신규: ${fresh.length})`);
  newPatches.push(...fresh);
}

// 1년치 유지, 30일 이후 미래 날짜 제외, 날짜 내림차순
const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const futureCutoff = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const merged = [...existing, ...newPatches]
  .filter((p) => !p.date || (p.date >= cutoff && p.date <= futureCutoff))
  .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

// 중복 ID 제거
const seen = new Set();
const deduped = merged.filter((p) => seen.has(p.id) ? false : seen.add(p.id));

await writeFile(patchesPath, JSON.stringify({ generatedAt: new Date().toISOString(), patches: deduped }));
console.log(`✓ 패치 ${deduped.length}개 저장 완료`);

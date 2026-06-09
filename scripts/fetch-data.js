import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const sources = [
  {
    game: "대항해시대 오리진",
    community: "FLOOR 자유게시판",
    type: "floor",
    url: "https://uwo.floor.line.games/kr/bbs/community/community_kr/1"
  },
  {
    game: "대항해시대 오리진",
    community: "네이버 카페 자유",
    type: "naverCafe",
    cafeId: 30210991,
    cafeUrl: "uworigin",
    menuId: 7,
    url: "https://cafe.naver.com/f-e/cafes/30210991/menus/7"
  },
  {
    game: "대항해시대 오리진",
    community: "네이버 카페 공략",
    type: "naverCafe",
    cafeId: 30210991,
    cafeUrl: "uworigin",
    menuId: 38,
    url: "https://cafe.naver.com/f-e/cafes/30210991/menus/38"
  },
  {
    game: "대항해시대 오리진",
    community: "DC 대항해시대 오리진",
    type: "dcinside",
    url: "https://gall.dcinside.com/mgallery/board/lists/?id=bigtimeofnavigation"
  },
  {
    game: "언디셈버",
    community: "FLOOR 자유게시판",
    type: "floor",
    url: "https://ud.floor.line.games/kr/bbs/community/community_kr/1"
  },
  {
    game: "언디셈버",
    community: "DC 언디셈버",
    type: "dcinside",
    url: "https://gall.dcinside.com/mgallery/board/lists/?id=undecember"
  },
  {
    game: "창세기전 모바일",
    community: "네이버 게임라운지 자유",
    type: "naverGame",
    loungeId: "theplayofgenesis",
    boardId: 4,
    url: "https://game.naver.com/lounge/theplayofgenesis/board/4"
  },
  {
    game: "창세기전 모바일",
    community: "네이버 게임라운지 공략",
    type: "naverGame",
    loungeId: "theplayofgenesis",
    boardId: 21,
    url: "https://game.naver.com/lounge/theplayofgenesis/board/21"
  },
  {
    game: "창세기전 모바일",
    community: "네이버 게임라운지 건의",
    type: "naverGame",
    loungeId: "theplayofgenesis",
    boardId: 38,
    url: "https://game.naver.com/lounge/theplayofgenesis/board/38"
  },
  {
    game: "창세기전 모바일",
    community: "DC 창세기전 모바일",
    type: "dcinside",
    url: "https://gall.dcinside.com/mgallery/board/lists/?id=genesism"
  }
];

const positiveWords = ["좋아", "재밌", "혜자", "만족", "갓겜", "기대", "감사", "개선", "편하", "복귀", "최고", "꿀잼", "선물", "버프", "상향", "추천", "강추", "역대급", "대박", "이벤트", "업뎃", "쾌적"];
const negativeWords = ["버그", "오류", "튕김", "망겜", "불만", "문제", "렉", "과금", "확률조작", "환불", "너프", "하향", "실망", "사기", "노답", "답답", "짜증", "최악", "탈주", "접겜", "서버터", "접속불가", "운영진", "과금유도", "밸런스붕괴"];
const watchWords = ["점검", "버그", "오류", "환불", "확률", "과금", "렉", "너프", "보상", "공지", "업데이트", "쿠폰", "밸런스", "접속", "상품", "결제"];

function decodeEntities(value = "") {
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([a-f0-9]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value = "") {
  return decodeEntities(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " "));
}

function absolutize(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return base;
  }
}

function hasNegationBefore(title, word) {
  const idx = title.indexOf(word);
  if (idx === -1) return false;
  const before = title.slice(Math.max(0, idx - 8), idx);
  return /없|아님|아니|안\s|못\s|아닌/.test(before);
}

function scoreSentiment(title) {
  const positive = positiveWords.filter((w) => title.includes(w) && !hasNegationBefore(title, w)).length;
  const negative = negativeWords.filter((w) => title.includes(w) && !hasNegationBefore(title, w)).length;
  if (negative > positive) return "negative";
  if (positive > negative) return "positive";
  return "neutral";
}

function extractBadges(title) {
  return watchWords.filter((word) => title.includes(word)).slice(0, 4);
}

function makePost(source, title, url, author = "", date = "", views = "") {
  return {
    id: `${source.url}-${title}`.replace(/\W/g, "").slice(0, 80),
    game: source.game,
    community: source.community,
    sourceType: source.type,
    title,
    url,
    author,
    date,
    views,
    sentiment: scoreSentiment(title),
    badges: extractBadges(title),
    fetchedAt: new Date().toISOString()
  };
}

function parseDcInside(html, source) {
  const posts = [];
  const rowRegex = /<tr[^>]*class="[^"]*ub-content[^"]*"[\s\S]*?<\/tr>/gi;
  for (const [row] of html.matchAll(rowRegex)) {
    const subject = row.match(/<td[^>]*class="[^"]*gall_tit[^"]*"[\s\S]*?<\/td>/i)?.[0] || "";
    if (/공지/.test(subject)) continue;
    const linkMatch = subject.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!/\/board\/view\/\?/.test(linkMatch?.[1] || "")) continue;
    const title = stripTags(linkMatch?.[2] || "");
    if (!title || title === "설문" || title.length < 2) continue;
    const author = stripTags(row.match(/<td[^>]*class="[^"]*gall_writer[^"]*"[\s\S]*?<\/td>/i)?.[0] || "");
    const dateTd = row.match(/<td[^>]*class="[^"]*gall_date[^"]*"([^>]*)>[\s\S]*?<\/td>/i);
    const date = dateTd?.[1]?.match(/title="([^"]+)"/)?.[1] || stripTags(dateTd?.[0] || "");
    const views = stripTags(row.match(/<td[^>]*class="[^"]*gall_count[^"]*"[\s\S]*?<\/td>/i)?.[0] || "");
    posts.push(makePost(source, title, absolutize(linkMatch?.[1] || source.url, source.url), author, date, views));
  }
  return posts;
}

function parseFloor(html, source) {
  const posts = [];
  const seen = new Set();
  const itemRegex = /<a\b(?=[^>]*class="[^"]*\bbbs-detail-link\b[^"]*")([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const [, attrs, body] of html.matchAll(itemRegex)) {
    const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1] || "";
    if (!/^\/kr\/bbsCmn\/detail\/\d+/.test(href)) continue;
    const title = stripTags(body.match(/<div[^>]*class="[^"]*noti-tit[^"]*"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || body);
    if (!title || title.length < 2) continue;
    const author = stripTags(body.match(/<div[^>]*class="[^"]*user-nick[^"]*"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const date = stripTags(body.match(/<p[^>]*class="[^"]*ago[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");
    const views = stripTags(body.match(/<p[^>]*class="[^"]*hits[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");
    const key = href;
    if (seen.has(key)) continue;
    seen.add(key);
    posts.push(makePost(source, title, absolutize(href, source.url), author, date, views));
  }
  return posts;
}

function formatTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatNaverGameDate(value = "") {
  if (!/^\d{14}$/.test(value)) return value;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)} ${value.slice(8, 10)}:${value.slice(10, 12)}`;
}

async function fetchNaverCafeSource(source) {
  const query = new URLSearchParams({ page: "1", perPage: "30" });
  const apiUrl = `https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/${source.cafeId}/menus/${source.menuId}/articles?${query}`;
  const response = await fetch(apiUrl, {
    headers: {
      "accept": "application/json",
      "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.6,en;q=0.4",
      "referer": source.url,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
    }
  });
  const payload = await response.json();
  const articles = payload?.result?.articleList || [];
  const posts = articles
    .filter((article) => article.type === "ARTICLE" && article.item?.articleId)
    .map((article) => {
      const item = article.item;
      return makePost(
        source,
        decodeEntities(item.subject || "제목 없음"),
        `https://cafe.naver.com/f-e/cafes/${source.cafeId}/articles/${item.articleId}?menuid=${source.menuId}`,
        item.writerInfo?.nickName || "",
        formatTimestamp(item.writeDateTimestamp),
        item.readCount ? String(item.readCount) : ""
      );
    });
  return {
    source,
    ok: response.ok,
    status: response.status,
    posts,
    fetchedAt: new Date().toISOString(),
    note: posts.length ? "" : "네이버 카페 API에서 게시글이 반환되지 않았습니다."
  };
}

async function fetchNaverGameSource(source) {
  const query = new URLSearchParams({
    offset: "0",
    limit: "30",
    order: "NEW",
    boardId: String(source.boardId),
    buffFilteringYN: "N"
  });
  const apiUrl = `https://comm-api.game.naver.com/nng_main/v1/community/lounge/${source.loungeId}/feed?${query}`;
  const response = await fetch(apiUrl, {
    headers: {
      "accept": "application/json",
      "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.6,en;q=0.4",
      "referer": source.url,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
    }
  });
  const payload = await response.json();
  const feeds = payload?.content?.feeds || [];
  const posts = feeds.map((item) => {
    const feed = item.feed || item;
    return makePost(
      source,
      decodeEntities(feed.title || "제목 없음"),
      `https://game.naver.com/lounge/${source.loungeId}/board/detail/${feed.feedId}`,
      feed.writer?.nickname || feed.member?.nickname || "",
      formatNaverGameDate(feed.createdDate || ""),
      feed.readCount ? String(feed.readCount) : ""
    );
  });
  return {
    source,
    ok: response.ok && payload?.code === 200,
    status: response.status,
    posts,
    fetchedAt: new Date().toISOString(),
    note: posts.length ? "" : "네이버 게임라운지 API에서 게시글이 반환되지 않았습니다."
  };
}

async function fetchSource(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    if (source.type === "naverCafe") return await fetchNaverCafeSource(source);
    if (source.type === "naverGame") return await fetchNaverGameSource(source);

    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.6,en;q=0.4",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
      }
    });
    const html = await response.text();
    const posts = source.type === "dcinside" ? parseDcInside(html, source) : source.type === "floor" ? parseFloor(html, source) : [];
    const uniquePosts = Array.from(new Map(posts.map((post) => [post.title + post.url, post])).values()).slice(0, 30);
    return {
      source,
      ok: response.ok,
      status: response.status,
      posts: uniquePosts,
      fetchedAt: new Date().toISOString(),
      note: uniquePosts.length ? "" : "게시글 목록을 자동 추출하지 못했습니다."
    };
  } catch (error) {
    return {
      source,
      ok: false,
      status: 0,
      posts: [],
      fetchedAt: new Date().toISOString(),
      note: error.name === "AbortError" ? "요청 시간이 초과되었습니다." : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

function summarize(results) {
  const posts = results.flatMap((r) => r.posts);
  const byGame = {}, byCommunity = {}, keywords = {}, sentiment = { positive: 0, neutral: 0, negative: 0 };
  for (const post of posts) {
    byGame[post.game] = (byGame[post.game] || 0) + 1;
    byCommunity[post.community] = (byCommunity[post.community] || 0) + 1;
    sentiment[post.sentiment] += 1;
    for (const badge of post.badges) keywords[badge] = (keywords[badge] || 0) + 1;
  }
  return {
    totalPosts: posts.length,
    activeSources: results.filter((r) => r.ok).length,
    failedSources: results.filter((r) => !r.ok || r.posts.length === 0).length,
    byGame,
    byCommunity,
    keywords: Object.entries(keywords).sort((a, b) => b[1] - a[1]).slice(0, 12),
    sentiment
  };
}

const results = await Promise.all(sources.map(fetchSource));
const data = {
  generatedAt: new Date().toISOString(),
  sources,
  results,
  summary: summarize(results)
};

const outPath = join(__dirname, "../data.json");
await writeFile(outPath, JSON.stringify(data));
console.log(`✓ ${data.summary.totalPosts}개 게시글 저장 완료 (${new Date().toLocaleTimeString("ko-KR")})`);

// history.json 누적 저장 (7일치 유지)
const historyPath = join(__dirname, "../history.json");
let existing = [];
try {
  const raw = await readFile(historyPath, "utf-8");
  existing = JSON.parse(raw).posts || [];
} catch {
  // 파일 없으면 빈 배열로 시작
}

const newPosts = results.flatMap((r) => r.posts);
const existingIds = new Set(existing.map((p) => p.id));
const merged = [
  ...existing,
  ...newPosts.filter((p) => !existingIds.has(p.id))
];

const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
const trimmed = merged.filter((p) => (p.fetchedAt || "") >= cutoff);

await writeFile(historyPath, JSON.stringify({ updatedAt: new Date().toISOString(), posts: trimmed }));
console.log(`✓ history.json: 총 ${trimmed.length}개 (신규 ${newPosts.filter((p) => !existingIds.has(p.id)).length}개 추가)`);

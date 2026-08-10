import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const GAMES = [
  {
    name: "대항해시대 오리진",
    googlePlayId: "com.linegames.uwogl",
    appStoreId: "1660850121",
    steamId: "1574360"
  },
  {
    name: "언디셈버",
    googlePlayId: "com.linegames.udg",
    appStoreId: "6443444355",
    steamId: "1549250"
  },
  {
    name: "창세기전 모바일",
    googlePlayId: "com.linegames.gm",
    appStoreId: "6450174109",
    steamId: null
  }
];

function makeId(store, raw) {
  return `${store}_${String(raw).replace(/\W/g, "").slice(-60)}`;
}

// ── Google Play ──────────────────────────────────────
async function fetchGooglePlay(game) {
  try {
    const gplay = (await import("google-play-scraper")).default;
    const result = await gplay.reviews({
      appId: game.googlePlayId,
      lang: "ko",
      country: "kr",
      sort: gplay.sort.NEWEST,
      num: 200
    });
    return (result.data || []).map((r) => ({
      id: makeId("gplay", r.id),
      game: game.name,
      store: "google_play",
      rating: r.score || 0,
      title: r.title || "",
      content: r.text || "",
      date: r.date ? new Date(r.date).toISOString().slice(0, 10) : "",
      author: r.userName || "",
      playtime: null,
      thumbsUp: r.thumbsUp || 0,
      version: r.version || "",
      fetchedAt: new Date().toISOString()
    }));
  } catch (err) {
    console.error(`[${game.name}] Google Play 실패:`, err.message);
    return [];
  }
}

// ── App Store (iTunes RSS) ───────────────────────────
async function fetchAppStore(game) {
  const reviews = [];
  try {
    for (let page = 1; page <= 5; page++) {
      const url = `https://itunes.apple.com/kr/rss/customerreviews/page=${page}/id=${game.appStoreId}/sortBy=mostRecent/json`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) break;
      const data = await res.json();
      const entries = (data?.feed?.entry || []).filter((e) => e["im:rating"]);
      if (!entries.length) break;
      for (const e of entries) {
        reviews.push({
          id: makeId("appstore", e.id?.label || Math.random()),
          game: game.name,
          store: "app_store",
          rating: parseInt(e["im:rating"]?.label || "0"),
          title: e.title?.label || "",
          content: e.content?.label || "",
          date: e.updated?.label ? e.updated.label.slice(0, 10) : "",
          author: e.author?.name?.label || "",
          playtime: null,
          thumbsUp: parseInt(e["im:voteSum"]?.label || "0"),
          version: e["im:version"]?.label || "",
          fetchedAt: new Date().toISOString()
        });
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  } catch (err) {
    console.error(`[${game.name}] App Store 실패:`, err.message);
  }
  return reviews;
}

// ── Steam ────────────────────────────────────────────
async function fetchSteam(game) {
  if (!game.steamId) return [];
  const reviews = [];
  try {
    let cursor = "*";
    for (let i = 0; i < 3; i++) {
      const params = new URLSearchParams({
        json: "1",
        language: "koreana",
        filter: "recent",
        num_per_page: "100",
        cursor,
        review_type: "all",
        purchase_type: "all"
      });
      const res = await fetch(
        `https://store.steampowered.com/appreviews/${game.steamId}?${params}`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (!res.ok) break;
      const data = await res.json();
      if (!data.success || !data.reviews?.length) break;
      for (const r of data.reviews) {
        reviews.push({
          id: makeId("steam", r.recommendationid),
          game: game.name,
          store: "steam",
          rating: r.voted_up ? 5 : 1,
          title: "",
          content: r.review || "",
          date: new Date(r.timestamp_created * 1000).toISOString().slice(0, 10),
          author: r.author?.steamid || "",
          playtime: Math.round((r.author?.playtime_at_review || 0) / 60), // hours
          thumbsUp: r.votes_up || 0,
          version: "",
          fetchedAt: new Date().toISOString()
        });
      }
      cursor = data.cursor || "";
      if (!cursor || !data.reviews?.length) break;
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (err) {
    console.error(`[${game.name}] Steam 실패:`, err.message);
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

for (const game of GAMES) {
  console.log(`\n[${game.name}] 수집 중...`);
  const [gplay, appstore, steam] = await Promise.all([
    fetchGooglePlay(game),
    fetchAppStore(game),
    fetchSteam(game)
  ]);
  const fresh = [...gplay, ...appstore, ...steam].filter((r) => !existingIds.has(r.id));
  console.log(`  Google Play: ${gplay.length} / App Store: ${appstore.length} / Steam: ${steam.length} (신규: ${fresh.length})`);
  newReviews.push(...fresh);
}

// 90일치만 유지
const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const merged = [...existing, ...newReviews].filter((r) => !r.date || r.date >= cutoff);

await writeFile(reviewsPath, JSON.stringify({ generatedAt: new Date().toISOString(), reviews: merged }));
console.log(`\n✓ 리뷰 총 ${merged.length}개 저장 완료`);

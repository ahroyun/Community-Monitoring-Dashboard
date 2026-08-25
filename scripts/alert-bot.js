/**
 * alert-bot.js
 * 게임별 커뮤니티 키워드 감지 → LINE 그룹 채팅 알림
 *
 * 필요한 GitHub Secrets:
 *   LINE_CHANNEL_TOKEN         : LINE Messaging API 채널 액세스 토큰
 *   LINE_GROUP_ID              : 창세기전 모바일 그룹 ID
 *   LINE_GROUP_ID_UNDECEMBER   : 언디셈버 그룹 ID
 *
 * communities 설정:
 *   keywords: [...] → 해당 키워드 포함 게시물만 알림
 *   keywords: null  → 모든 게시물 알림
 */

import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 게임별 알림 설정 ──────────────────────────────────────
const GM_KEYWORDS = [
  "기사단전", "단전", "실험실", "총력전", "용자의 무덤", "용무",
  "격투", "격전", "에러코드", "경쟁", "빙룡성", "스토리", "방주",
  "이너월드", "서풍", "조각", "악세사리", "장신구", "파편", "아우터원",
  "캐릭터", "툴팁", "밸런스",
  "접속", "진행", "튕김", "크래시", "멈춤", "불가",
  "안돼요", "안되요", "안됨", "안됩니다", "안되네요", "없어요",
  "구매", "실행", "오류", "버그", "참가",
];

const GAME_CONFIGS = [
  {
    game: "창세기전 모바일",
    label: "GM",
    groupId: process.env.LINE_GROUP_ID,
    communities: [
      {
        name: "네이버 게임라운지 자유",
        emoji: "🟡",
        shortName: "자유/라운지",
        keywords: GM_KEYWORDS,
      },
      {
        name: "네이버 게임라운지 오류제보",
        emoji: "🔴",
        shortName: "오류제보/라운지",
        keywords: null,
      },
      {
        name: "DC 창세기전 모바일",
        emoji: "🔵",
        shortName: "DC",
        keywords: GM_KEYWORDS,
      },
    ],
  },
  {
    game: "언디셈버",
    label: "UDG",
    groupId: process.env.LINE_GROUP_ID_UNDECEMBER,
    communities: [
      {
        name: "DC 언디셈버",
        emoji: "🔵",
        shortName: "DC",
        keywords: [
          "오류", "버그", "복사", "매크로", "핵", "작업장",
          "점검", "백섭", "렉", "튕김", "접속", "환불", "경매장",
        ],
      },
      {
        name: "FLOOR 자유게시판",
        emoji: "🟡",
        shortName: "자유/FLOOR",
        keywords: [
          "오류", "버그", "복사", "매크로", "핵", "작업장",
          "점검", "백섭", "렉", "튕김", "접속", "환불", "경매장",
        ],
      },
    ],
  },
];

const LINE_CHANNEL_TOKEN = process.env.LINE_CHANNEL_TOKEN;

// 최근 N시간 내 게시물만 알림
const LOOKBACK_HOURS = 2;

// ── 경로 ────────────────────────────────────────────────
const historyPath = join(__dirname, "../history.json");
const seenPath    = join(__dirname, "../alert-seen.json");

// ── 유틸 ────────────────────────────────────────────────
function matchedKeywords(title, keywords) {
  if (keywords === null) return ["전체"]; // 모든 게시물 알림
  return keywords.filter((kw) => title.includes(kw));
}

function isRecent(fetchedAt) {
  if (!fetchedAt) return false;
  return Date.now() - new Date(fetchedAt).getTime() < LOOKBACK_HOURS * 3600000;
}

// ── LINE Push Message ────────────────────────────────────
async function sendLineMessage(groupId, text) {
  if (!LINE_CHANNEL_TOKEN || !groupId) {
    console.warn("LINE_CHANNEL_TOKEN 또는 groupId 미설정 — 알림 스킵");
    return;
  }
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LINE_CHANNEL_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: groupId,
      messages: [{ type: "text", text }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`LINE API 오류 ${res.status}: ${body}`);
  }
}

function getTimestamp() {
  const kst = new Date(Date.now() + 9 * 3600000);
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mi = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

function buildMessage(label, post, keywords, communityConfig) {
  const timestamp = getTimestamp();

  // 창세기전(GM)처럼 emoji/shortName이 있는 경우 전용 포맷
  if (communityConfig?.emoji && communityConfig?.shortName) {
    const kwtags = keywords[0] === "전체"
      ? ""
      : ` ${keywords.map((k) => `#${k}`).join(" ")}`;
    return [
      `[${label}] ${timestamp}`,
      `${communityConfig.emoji} ${communityConfig.shortName}${kwtags}`,
      `📌 ${post.title}`,
      `${post.url}`,
    ].join("\n");
  }

  // 기본 포맷 (언디셈버 등)
  const kwtags = keywords[0] === "전체"
    ? ""
    : ` [${keywords.map((k) => `#${k}`).join(" ")}]`;
  return [
    `[${label}] ${timestamp}`,
    `${post.community || ""}`,
    `🔔${kwtags}`,
    `📌 ${post.title}`,
    `${post.url}`,
  ].join("\n");
}

// ── Main ─────────────────────────────────────────────────
// 1. history.json 로드
let historyPosts = [];
try {
  const raw = JSON.parse(await readFile(historyPath, "utf-8"));
  historyPosts = raw.posts || [];
} catch {
  console.log("history.json 없음 또는 비어 있음 — 종료");
  process.exit(0);
}

// 2. seen 목록 로드
let seen = {};
try {
  seen = JSON.parse(await readFile(seenPath, "utf-8"));
} catch { /* 첫 실행 시 빈 객체 */ }

// 3주 지난 항목 정리
const THREE_WEEKS_AGO = Date.now() - 21 * 86400000;
for (const id of Object.keys(seen)) {
  if (seen[id] < THREE_WEEKS_AGO) delete seen[id];
}

// 3. 게임별 처리
let totalAlerts = 0;

for (const config of GAME_CONFIGS) {
  if (!config.groupId) {
    console.log(`[${config.label}] groupId 미설정 — 스킵`);
    continue;
  }

  let gameAlerts = 0;

  for (const communityConfig of config.communities) {
    const candidates = historyPosts.filter((p) =>
      p.game === config.game &&
      p.community === communityConfig.name &&
      isRecent(p.fetchedAt)
    );

    for (const post of candidates) {
      const postKey = post.url || post.id || post.title;
      if (!postKey) continue;
      if (seen[postKey]) continue;

      const keywords = matchedKeywords(post.title, communityConfig.keywords);
      if (keywords.length === 0) continue;

      const message = buildMessage(config.label, post, keywords, communityConfig);
      console.log(`→ [${config.label}/${communityConfig.name}] ${post.title}`);
      await sendLineMessage(config.groupId, message);

      seen[postKey] = Date.now();
      gameAlerts++;
      totalAlerts++;

      await new Promise((r) => setTimeout(r, 300));
    }

    console.log(`[${config.label}/${communityConfig.name}] 후보 ${candidates.length}건 검사`);
  }

  console.log(`[${config.label}] ${gameAlerts}건 전송`);
}

console.log(`✓ 완료: 총 ${totalAlerts}건 알림 전송`);

// 4. seen 목록 저장
await writeFile(seenPath, JSON.stringify(seen, null, 2));

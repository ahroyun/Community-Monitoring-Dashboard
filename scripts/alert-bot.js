/**
 * alert-bot.js
 * 게임별 커뮤니티 키워드 감지 → LINE 그룹 채팅 알림
 *
 * 필요한 GitHub Secrets:
 *   LINE_CHANNEL_TOKEN         : LINE Messaging API 채널 액세스 토큰
 *   LINE_GROUP_ID              : 창세기전 모바일 그룹 ID
 *   LINE_GROUP_ID_UNDECEMBER   : 언디셈버 그룹 ID
 */

import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 게임별 알림 설정 ──────────────────────────────────────
const GAME_CONFIGS = [
  {
    game: "창세기전 모바일",
    label: "창세기전",
    groupId: process.env.LINE_GROUP_ID,
    communities: [
      "DC 창세기전 모바일",
      "네이버 게임라운지 오류제보",
    ],
    keywords: ["기사단전", "총력전", "버그", "불가", "접속"],
  },
  {
    game: "언디셈버",
    label: "언디셈버",
    groupId: process.env.LINE_GROUP_ID_UNDECEMBER,
    communities: [
      "DC 언디셈버",
      "FLOOR 자유게시판",
    ],
    keywords: [
      "오류", "버그", "복사", "매크로", "핵", "작업장",
      "점검", "백섭", "렉", "튕김", "접속", "환불", "경매장",
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

function buildMessage(label, post, keywords) {
  const kwtags = keywords.map((k) => `#${k}`).join(" ");
  return [
    `[${label}] 🔔 키워드 감지: ${kwtags}`,
    `📌 ${post.title}`,
    `📂 ${post.community || ""}`,
    `🔗 ${post.url}`,
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

  const candidates = historyPosts.filter((p) =>
    p.game === config.game &&
    config.communities.includes(p.community) &&
    isRecent(p.fetchedAt)
  );

  let gameAlerts = 0;
  for (const post of candidates) {
    const postKey = post.url || post.id || post.title;
    if (!postKey) continue;
    if (seen[postKey]) continue;

    const keywords = matchedKeywords(post.title, config.keywords);
    if (keywords.length === 0) continue;

    const message = buildMessage(config.label, post, keywords);
    console.log(`→ [${config.label}] 알림 전송: ${post.title}`);
    await sendLineMessage(config.groupId, message);

    seen[postKey] = Date.now();
    gameAlerts++;
    totalAlerts++;

    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`[${config.label}] ${gameAlerts}건 전송, 후보 ${candidates.length}건 검사`);
}

console.log(`✓ 완료: 총 ${totalAlerts}건 알림 전송`);

// 4. seen 목록 저장
await writeFile(seenPath, JSON.stringify(seen, null, 2));

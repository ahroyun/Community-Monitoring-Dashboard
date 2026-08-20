/**
 * alert-bot.js
 * 창세기전 모바일 커뮤니티 키워드 감지 → LINE 그룹 채팅 알림
 *
 * 필요한 GitHub Secrets:
 *   LINE_CHANNEL_TOKEN  : LINE Messaging API 채널 액세스 토큰
 *   LINE_GROUP_ID       : 알림을 보낼 그룹 채팅 ID
 */

import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 설정 ────────────────────────────────────────────────
const ALERT_KEYWORDS = ["기사단전", "총력전", "버그", "불가", "접속"];

const TARGET_COMMUNITIES = [
  "DC 창세기전 모바일",
  "네이버 게임라운지 오류제보",
];

const LINE_CHANNEL_TOKEN = process.env.LINE_CHANNEL_TOKEN;
const LINE_GROUP_ID      = process.env.LINE_GROUP_ID;

// 최근 N시간 내 게시물만 알림 (너무 오래된 항목 무시)
const LOOKBACK_HOURS = 2;

// ── 경로 ────────────────────────────────────────────────
const historyPath = join(__dirname, "../history.json");
const seenPath    = join(__dirname, "../alert-seen.json");

// ── 유틸 ────────────────────────────────────────────────
function matchedKeywords(title) {
  return ALERT_KEYWORDS.filter((kw) => title.includes(kw));
}

function isRecent(fetchedAt) {
  if (!fetchedAt) return false;
  return Date.now() - new Date(fetchedAt).getTime() < LOOKBACK_HOURS * 3600000;
}

// ── LINE Push Message ────────────────────────────────────
async function sendLineMessage(text) {
  if (!LINE_CHANNEL_TOKEN || !LINE_GROUP_ID) {
    console.warn("LINE_CHANNEL_TOKEN 또는 LINE_GROUP_ID 미설정 — 알림 스킵");
    return;
  }
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LINE_CHANNEL_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: LINE_GROUP_ID,
      messages: [{ type: "text", text }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`LINE API 오류 ${res.status}: ${body}`);
  }
}

function buildMessage(post, keywords) {
  const kwtags = keywords.map((k) => `#${k}`).join(" ");
  const source = post.community || "";
  return [
    `[창세기전] 🔔 키워드 감지: ${kwtags}`,
    `📌 ${post.title}`,
    `📂 ${source}`,
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

// 2. seen 목록 로드 (알림 보낸 post ID + 정리용 timestamp)
let seen = {};
try {
  seen = JSON.parse(await readFile(seenPath, "utf-8"));
} catch { /* 첫 실행 시 빈 객체 */ }

// 3주 지난 항목 정리
const THREE_WEEKS_AGO = Date.now() - 21 * 86400000;
for (const id of Object.keys(seen)) {
  if (seen[id] < THREE_WEEKS_AGO) delete seen[id];
}

// 3. 대상 게시물 필터링 (게임 + 커뮤니티 + 키워드 + 최근성)
const candidates = historyPosts.filter((p) =>
  p.game === "창세기전 모바일" &&
  TARGET_COMMUNITIES.includes(p.community) &&
  isRecent(p.fetchedAt)
);

// 4. 새 매칭 게시물 추출 → 알림
let alertCount = 0;
for (const post of candidates) {
  const postKey = post.url || post.id || post.title;
  if (!postKey) continue;
  if (seen[postKey]) continue; // 이미 알림 보낸 항목

  const keywords = matchedKeywords(post.title);
  if (keywords.length === 0) continue;

  const message = buildMessage(post, keywords);
  console.log(`→ 알림 전송: ${post.title}`);
  await sendLineMessage(message);

  seen[postKey] = Date.now();
  alertCount++;

  // 연속 알림 간격 (LINE API rate limit 방지)
  await new Promise((r) => setTimeout(r, 300));
}

console.log(`✓ 완료: ${alertCount}건 알림 전송, 후보 ${candidates.length}건 검사`);

// 5. seen 목록 저장
await writeFile(seenPath, JSON.stringify(seen, null, 2));

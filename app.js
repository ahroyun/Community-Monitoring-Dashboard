const ALL = "전체";

const GAME_COLORS = {
  "대항해시대 오리진": "#0369a1",
  "언디셈버": "#c2410c",
  "창세기전 모바일": "#7c3aed"
};

const state = {
  data: null,
  history: null,
  summary: null,
  summaryPeriod: "daily",
  view: "feed",
  game: ALL,
  sourceType: ALL,
  query: "",
  onlyAlerts: false,
  keyword: "",
  dateRange: "all",
  timer: null
};

const els = {
  insightCards: document.querySelector("#insightCards"),
  gameFilters: document.querySelector("#gameFilters"),
  keywordCloud: document.querySelector("#keywordCloud"),
  sourceTabs: document.querySelector("#sourceTabs"),
  feed: document.querySelector("#feed"),
  notice: document.querySelector("#notice"),
  exportButton: document.querySelector("#exportButton"),
  heatmapPanel: document.querySelector("#heatmapPanel"),
  refreshButton: document.querySelector("#refreshButton"),
  refreshTime: document.querySelector("#refreshTime"),
  clearFilters: document.querySelector("#clearFilters"),
  searchInput: document.querySelector("#searchInput"),
  onlyAlerts: document.querySelector("#onlyAlerts"),
  positiveMeter: document.querySelector("#positiveMeter"),
  neutralMeter: document.querySelector("#neutralMeter"),
  negativeMeter: document.querySelector("#negativeMeter"),
  positivePct: document.querySelector("#positivePct"),
  neutralPct: document.querySelector("#neutralPct"),
  negativePct: document.querySelector("#negativePct")
};

const sourceLabels = {
  [ALL]: ALL,
  floor: "FLOOR",
  dcinside: "DC",
  naverCafe: "네이버 카페",
  naverGame: "게임라운지"
};

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function formatRefreshTime(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function allPosts() {
  return state.data?.results.flatMap((result) => result.posts) || [];
}

function postsForSelectedGame() {
  return allPosts().filter((post) => state.game === ALL || post.game === state.game);
}

function formatPostDate(post) {
  const d = parsePostDate(post);
  if (!d || isNaN(d)) return post.date || "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function parsePostDate(post) {
  const date = String(post.date || "");
  if (!date) return null;

  const base = new Date(post.fetchedAt || Date.now());
  let match = date.match(/(\d+)\s*분\s*전/);
  if (match) return new Date(base.getTime() - Number(match[1]) * 60_000);
  match = date.match(/(\d+)\s*시간\s*전/);
  if (match) return new Date(base.getTime() - Number(match[1]) * 60 * 60_000);
  match = date.match(/(\d+)\s*일\s*전/);
  if (match) return new Date(base.getTime() - Number(match[1]) * 24 * 60 * 60_000);
  if (/방금/.test(date)) return base;

  // 네이버 카페 형식: '2026. 06. 08. PM 02:16' or 'AM 11:05'
  match = date.match(/(20\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(AM|PM)\s+(\d{1,2}):(\d{2})/i);
  if (match) {
    let h = Number(match[5]);
    const pm = match[4].toUpperCase() === "PM";
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), h, Number(match[6]));
  }

  // 일반 날짜 형식: '2026-06-10 11:35' or '2026-06-10 11:35:22'
  match = date.match(/(20\d{2})[-.]\s*(\d{1,2})[-.]\s*(\d{1,2})(?:\D+(\d{1,2}):(\d{1,2}))?/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0));

  match = date.match(/(\d{2})\.(\d{1,2})\.(\d{1,2})/);
  if (match) return new Date(2000 + Number(match[1]), Number(match[2]) - 1, Number(match[3]));

  return null;
}

function isTodayPost(post) {
  const parsed = parsePostDate(post);
  if (!parsed) return false;
  const now = new Date();
  return parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate();
}

function isThisWeekPost(post) {
  const parsed = parsePostDate(post);
  if (!parsed || isTodayPost(post)) return false;

  const now = new Date();
  const daysSinceSaturday = (now.getDay() + 1) % 7;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceSaturday);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return parsed >= start && parsed < end;
}

function isYesterdayPost(post) {
  const parsed = parsePostDate(post);
  if (!parsed) return false;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return parsed.getFullYear() === yesterday.getFullYear() &&
    parsed.getMonth() === yesterday.getMonth() &&
    parsed.getDate() === yesterday.getDate();
}

function matchesDateRange(post) {
  if (state.dateRange === "all") return true;
  if (state.dateRange === "today") return isTodayPost(post);
  if (state.dateRange === "yesterday") return isYesterdayPost(post);
  if (state.dateRange === "week") {
    const parsed = parsePostDate(post);
    if (!parsed) return false;
    return parsed >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }
  return true;
}

function temporalClass(post) {
  if (isTodayPost(post)) return "today";
  if (isThisWeekPost(post)) return "this-week";
  return "";
}

function filteredPosts() {
  const query = state.query.trim().toLowerCase();
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  return allPosts().filter((post) => {
    const parsed = parsePostDate(post);
    if (parsed && parsed < twoWeeksAgo) return false;
    const matchesGame = state.game === ALL || post.game === state.game;
    const matchesSource = state.sourceType === ALL || post.sourceType === state.sourceType;
    const matchesAlert = !state.onlyAlerts || post.badges.length > 0 || post.sentiment === "negative";
    const matchesKeyword = !state.keyword || post.badges.includes(state.keyword);
    const haystack = `${post.title} ${post.game} ${post.community} ${post.badges.join(" ")}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    return matchesGame && matchesSource && matchesAlert && matchesKeyword && matchesQuery && matchesDateRange(post);
  }).sort((a, b) => {
    const da = parsePostDate(a);
    const db = parsePostDate(b);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db - da;
  });
}

function countBy(items, selector) {
  return items.reduce((acc, item) => {
    const key = selector(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function topEntry(map) {
  return Object.entries(map).sort((a, b) => b[1] - a[1])[0] || ["-", 0];
}

function getHotKeywords(posts) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const todayPosts = posts.filter((post) => {
    const d = parsePostDate(post);
    if (!d) return false;
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return ds === todayStr;
  });
  // 게임별로 키워드 카운트
  const gameCounts = {};
  for (const post of todayPosts) {
    if (!gameCounts[post.game]) gameCounts[post.game] = {};
    for (const badge of post.badges) {
      gameCounts[post.game][badge] = (gameCounts[post.game][badge] || 0) + 1;
    }
  }
  // 게임별 HOT 키워드 Map 반환
  const result = new Map();
  for (const [game, counts] of Object.entries(gameCounts)) {
    result.set(game, new Set(Object.entries(counts).filter(([, c]) => c >= 3).map(([k]) => k)));
  }
  return result;
}

function keywordEntries(posts) {
  const counts = {};
  for (const post of posts) {
    for (const badge of post.badges) counts[badge] = (counts[badge] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function sentimentLabel(value) {
  return { positive: "긍정", neutral: "중립", negative: "주의" }[value] || "중립";
}

function renderInsights() {
  const scoped = postsForSelectedGame();
  const today = scoped.filter(isTodayPost);
  const alertPosts = scoped.filter((post) => post.badges.length > 0);
  const negative = scoped.filter((post) => post.sentiment === "negative");
  const [topCommunity, topCommunityCount] = topEntry(countBy(scoped, (post) => post.community));
  const [topKeyword, topKeywordCount] = topEntry(Object.fromEntries(keywordEntries(scoped)));
  const target = state.game === ALL ? "전체 게임" : state.game;

  els.insightCards.innerHTML = [
    {
      label: "오늘 등록",
      icon: "ti-calendar-stats",
      color: "#0369a1",
      value: today.length.toLocaleString("ko-KR"),
      note: `${target} 기준 최신 흐름`
    },
    {
      label: "이슈 키워드",
      icon: "ti-alert-triangle",
      color: "#b7791f",
      value: alertPosts.length.toLocaleString("ko-KR"),
      note: topKeywordCount ? `${topKeyword} ${topKeywordCount}건이 가장 많음` : "감지된 키워드 없음"
    },
    {
      label: "주의 신호",
      icon: "ti-mood-sad",
      color: "#d64545",
      value: negative.length.toLocaleString("ko-KR"),
      note: "버그, 오류, 렉, 환불 등 제목 기반"
    },
    {
      label: "활성 커뮤니티",
      icon: "ti-users",
      color: "#0f766e",
      value: topCommunityCount.toLocaleString("ko-KR"),
      note: topCommunity
    }
  ].map((card) => `
    <article style="border-top: 3px solid ${card.color}">
      <i class="ti ${escapeHtml(card.icon)}" style="color:${card.color};font-size:18px;display:block;margin-bottom:6px" aria-hidden="true"></i>
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <p>${escapeHtml(card.note)}</p>
    </article>
  `).join("");
}

function renderKeywords() {
  const entries = keywordEntries(postsForSelectedGame()).slice(0, 14);
  const hot = getHotKeywords(allPosts());
  const isHotKeyword = (word) => state.game !== ALL ? hot.get(state.game)?.has(word) : [...hot.values()].some((s) => s.has(word));
  els.keywordCloud.innerHTML = entries.length
    ? entries.map(([word, count]) => `
      <button class="keyword ${state.keyword === word ? "active" : ""} ${isHotKeyword(word) ? "keyword-hot" : ""}" type="button" data-keyword="${escapeHtml(word)}">
        ${isHotKeyword(word) ? `<span class="hot-dot">HOT</span>` : ""}${escapeHtml(word)} ${count}
      </button>
    `).join("")
    : `<span class="empty small">감지된 이슈 키워드가 없습니다.</span>`;

  els.keywordCloud.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.keyword = state.keyword === button.dataset.keyword ? "" : button.dataset.keyword;
      render();
    });
  });
}

function renderSentiment() {
  const scoped = postsForSelectedGame();
  const sentiment = countBy(scoped, (post) => post.sentiment);
  const total = Math.max(1, scoped.length);
  const pos = Math.round((sentiment.positive || 0) / total * 100);
  const neu = Math.round((sentiment.neutral || 0) / total * 100);
  const neg = Math.round((sentiment.negative || 0) / total * 100);
  els.positiveMeter.style.width = pos + "%";
  els.neutralMeter.style.width = neu + "%";
  els.negativeMeter.style.width = neg + "%";
  els.positivePct.textContent = pos + "%";
  els.neutralPct.textContent = neu + "%";
  els.negativePct.textContent = neg + "%";
}

function renderFilters() {
  const posts = allPosts();
  const games = [ALL, ...new Set(state.data.sources.map((source) => source.game))];
  const counts = countBy(posts, (post) => post.game);

  els.gameFilters.innerHTML = games.map((game) => {
    const color = GAME_COLORS[game];
    const dot = color ? `<span class="filter-dot" style="background:${color}"></span>` : "";
    return `
      <button class="filter ${state.game === game ? "active" : ""}" type="button" data-game="${escapeHtml(game)}">
        <span>${dot}${escapeHtml(game)}</span>
        <small>${game === ALL ? posts.length : counts[game] || 0}</small>
      </button>
    `;
  }).join("");

  els.gameFilters.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.game = button.dataset.game;
      state.keyword = "";
      const available = availableSourceTypes();
      if (!available.includes(state.sourceType)) state.sourceType = ALL;
      render();
    });
  });

  const available = availableSourceTypes();
  if (!available.includes(state.sourceType)) state.sourceType = ALL;
  els.sourceTabs.innerHTML = available.map((type) => `
    <button class="tab ${state.sourceType === type ? "active" : ""}" type="button" data-source-type="${escapeHtml(type)}">
      ${escapeHtml(sourceLabels[type] || type)}
    </button>
  `).join("");

  els.sourceTabs.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.sourceType = button.dataset.sourceType;
      render();
    });
  });
}

function availableSourceTypes() {
  const scopedSources = state.data.sources.filter((source) => state.game === ALL || source.game === state.game);
  const sourceTypesWithPosts = new Set(
    state.data.results
      .filter((result) => (state.game === ALL || result.source.game === state.game) && result.posts.length > 0)
      .map((result) => result.source.type)
  );
  const types = scopedSources.map((source) => source.type).filter((type) => sourceTypesWithPosts.has(type));
  return [ALL, ...new Set(types)];
}

function renderNotice() {
  const blocked = state.data.results.filter((result) => !result.ok || result.posts.length === 0);
  if (!blocked.length) {
    els.notice.hidden = true;
    return;
  }
  els.notice.hidden = false;
  els.notice.textContent = `${blocked.length}개 소스는 현재 게시글을 가져오지 못했습니다. 메모형 메뉴나 접근 제한이 있는 소스는 확인 필요로 남깁니다.`;
}

const COMMUNITY_PLATFORMS = ["네이버 게임라운지", "네이버 카페", "FLOOR", "DC"];
const ALERT_TITLE_WORDS = ["결제", "환불", "접속", "버그", "오류", "상품", "로그인"];

function parseCommunity(community) {
  for (const p of COMMUNITY_PLATFORMS) {
    if (community.startsWith(p)) {
      return { platform: p, sub: community.slice(p.length).trim() };
    }
  }
  return { platform: community, sub: "" };
}

function renderFeed() {
  const posts = filteredPosts();
  if (!posts.length) {
    els.feed.innerHTML = `<div class="empty">조건에 맞는 게시글이 없습니다.</div>`;
    return;
  }

  const hot = getHotKeywords(allPosts());
  els.feed.innerHTML = posts.map((post) => {
    const gameHot = hot.get(post.game) || new Set();
    const isHot = post.badges.some((b) => gameHot.has(b));
    const { platform, sub } = parseCommunity(post.community);
    const isAlertTitle = ALERT_TITLE_WORDS.some((w) => post.title.includes(w));
    return `
    <article class="post ${temporalClass(post)}${isHot ? " post-hot" : ""}" data-game="${escapeHtml(post.game)}">
      <div class="post-top">
        <span class="source">
          <span class="game-chip" data-game="${escapeHtml(post.game)}">${escapeHtml(post.game)}</span>
          <span class="community-chip" data-platform="${escapeHtml(platform)}">${escapeHtml(platform)}</span>
          ${sub && platform !== "DC" ? `<span class="community-sub">${escapeHtml(sub)}</span>` : ""}
        </span>
        <div class="post-flags">
          ${isHot ? `<span class="hot-badge">🔥 HOT</span>` : ""}
          ${isTodayPost(post) ? `<span class="today-badge">오늘 등록</span>` : ""}
          ${isThisWeekPost(post) ? `<span class="week-badge">금주</span>` : ""}
          <span class="sentiment ${post.sentiment}">${sentimentLabel(post.sentiment)}</span>
        </div>
      </div>
      <a href="${escapeHtml(post.url)}" target="_blank" rel="noreferrer" class="${isAlertTitle ? "alert-title" : ""}">${escapeHtml(post.title)}</a>
      ${post.badges.length ? `<div class="badges">${post.badges.map((badge) => `<span class="badge${gameHot.has(badge) ? " badge-hot" : ""}">${escapeHtml(badge)}</span>`).join("")}</div>` : ""}
      <div class="meta">
        ${post.author ? `<span>${escapeHtml(post.author)}</span>` : ""}
        ${post.date ? `<span>등록 ${escapeHtml(formatPostDate(post))}</span>` : ""}
        ${post.views ? `<span>조회 ${escapeHtml(post.views)}</span>` : ""}
      </div>
    </article>
  `;
  }).join("");
}

const HEATMAP_GROUPS = [
  { label: "결제/환불", match: ["결제", "환불", "과금"] },
  { label: "접속",      match: ["접속"] },
  { label: "버그/오류", match: ["버그", "오류", "렉"] },
  { label: "점검/업데이트", match: ["점검", "업데이트"] },
  { label: "핵",        match: ["핵"] }
];

function renderHeatmap() {
  if (!state.data) return;
  const games = [...new Set(state.data.sources.map((s) => s.game))];
  const historyPosts = state.history?.posts || [];
  const posts = historyPosts.length > 0 ? historyPosts : allPosts();

  const matrix = {};
  for (const grp of HEATMAP_GROUPS) {
    matrix[grp.label] = {};
    for (const game of games) matrix[grp.label][game] = 0;
  }
  for (const post of posts) {
    for (const badge of post.badges) {
      for (const grp of HEATMAP_GROUPS) {
        if (grp.match.includes(badge)) {
          matrix[grp.label][post.game] = (matrix[grp.label][post.game] || 0) + 1;
        }
      }
    }
  }

  const maxVal = Math.max(1, ...HEATMAP_GROUPS.flatMap((grp) => games.map((g) => matrix[grp.label][g])));

  function cellStyle(val) {
    if (val === 0) return `background:var(--panel);color:var(--muted)`;
    const r = val / maxVal;
    if (r < 0.25) return `background:#FEF3C7;color:#92400E`;
    if (r < 0.5)  return `background:#FDE68A;color:#78350F`;
    if (r < 0.75) return `background:#F59E0B;color:#451A03`;
    return `background:#DC2626;color:#fff`;
  }

  const colPct = Math.floor(80 / games.length);
  const head = `<tr><th style="width:20%"></th>${games.map((g) => `<th style="width:${colPct}%">${escapeHtml(g)}</th>`).join("")}</tr>`;
  const rows = HEATMAP_GROUPS.map((grp) => {
    const cells = games.map((g) => {
      const val = matrix[grp.label][g];
      return `<td style="${cellStyle(val)}">${val > 0 ? val : ""}</td>`;
    }).join("");
    return `<tr><th>${escapeHtml(grp.label)}</th>${cells}</tr>`;
  }).join("");

  els.heatmapPanel.innerHTML = `<div class="heatmap-scroll"><table class="heatmap-table"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

async function exportExcel() {
  els.exportButton.disabled = true;
  els.exportButton.textContent = "불러오는 중...";
  try {
    state.history = await fetchJson("history.json");
    const posts = state.history.posts || [];
    if (!posts.length) throw new Error("내보낼 데이터가 없습니다.");

    if (!window.XLSX) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    const rows = posts.map((p) => ({
      "게임": p.game,
      "커뮤니티": p.community,
      "제목": p.title,
      "링크": p.url,
      "작성자": p.author || "",
      "작성일": p.date || "",
      "조회수": p.views || "",
      "감성": { positive: "긍정", neutral: "중립", negative: "주의" }[p.sentiment] || "",
      "이슈키워드": p.badges.join(", "),
      "수집일시": p.fetchedAt
    }));

    const ws = window.XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [16, 18, 50, 60, 14, 18, 8, 6, 20, 20].map((w) => ({ wch: w }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "커뮤니티 동향");
    const today = new Date().toISOString().slice(0, 10);
    window.XLSX.writeFile(wb, `커뮤니티동향_${today}.xlsx`);
  } catch (err) {
    alert(err.message);
  } finally {
    els.exportButton.disabled = false;
    els.exportButton.innerHTML = `<span class="icon">↓</span> 2주 내보내기`;
  }
}

function render() {
  if (!state.data) return;
  renderInsights();
  renderFilters();
  renderKeywords();
  renderSentiment();
  renderHeatmap();
  renderNotice();
  renderFeed();
}

const RAW_BASE = `https://raw.githubusercontent.com/ahroyun/Community-Monitoring-Dashboard/main`;

async function fetchJson(path) {
  const res = await fetch(`${RAW_BASE}/${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return res.json();
}

async function load(isAuto = false) {
  els.refreshButton.disabled = true;
  els.refreshButton.querySelector(".icon").textContent = "...";
  try {
    state.data = await fetchJson("data.json");
    // history.json은 최초 로드 또는 수동 새로고침 시에만 가져옴
    if (!isAuto || !state.history) {
      state.history = await fetchJson("history.json").catch(() => null);
    }
    els.notice.hidden = true;
    els.refreshTime.textContent = `마지막 갱신 ${formatRefreshTime(state.data.generatedAt)}`;
    render();
  } catch (error) {
    els.notice.hidden = false;
    els.notice.textContent = `데이터를 불러오지 못했습니다: ${error.message}`;
  } finally {
    els.refreshButton.disabled = false;
    els.refreshButton.querySelector(".icon").textContent = "↻";
  }
}

els.refreshButton.addEventListener("click", load);
els.exportButton.addEventListener("click", exportExcel);
els.clearFilters.addEventListener("click", () => {
  state.game = ALL;
  state.sourceType = ALL;
  state.query = "";
  state.onlyAlerts = false;
  state.keyword = "";
  els.searchInput.value = "";
  els.onlyAlerts.checked = false;
  render();
});
els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderFeed();
});
els.onlyAlerts.addEventListener("change", (event) => {
  state.onlyAlerts = event.target.checked;
  renderFeed();
});

document.querySelectorAll(".date-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".date-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.dateRange = btn.dataset.range;
    renderFeed();
  });
});

// ── 메인 탭 (피드 / AI 요약) ────────────────────────
const viewFeed    = document.querySelector("#viewFeed");
const viewSummary = document.querySelector("#viewSummary");
const summaryContent = document.querySelector("#summaryContent");

function renderSummary() {
  if (!state.summary) {
    summaryContent.innerHTML = `<div class="summary-empty">아직 생성된 요약이 없습니다.<br>매일 오전 9시에 자동 생성됩니다.<br><br>GitHub Actions에서 "Generate AI Summary" 워크플로우를 수동 실행하면 바로 확인할 수 있습니다.</div>`;
    return;
  }
  const periodData = state.summary[state.summaryPeriod] || {};
  const kstDate = state.summary.kstDate || "";
  const kstYesterday = state.summary.kstYesterday || kstDate;
  const prevWeekRange = (state.summary.prevWeekMon && state.summary.prevWeekSun)
    ? `${state.summary.prevWeekMon} ~ ${state.summary.prevWeekSun}`
    : `최근 7일 (${kstDate} 기준)`;
  const generatedAt = state.summary.generatedAt
    ? new Date(new Date(state.summary.generatedAt).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ")
    : "";

  const SUMMARY_SECTIONS = ["주요 이슈", "유저 반응", "주목할 키워드", "한줄 요약"];

  function parseSummary(text) {
    const result = {};
    SUMMARY_SECTIONS.forEach((label, i) => {
      const next = SUMMARY_SECTIONS[i + 1];
      const re = new RegExp(
        `\\[${label}\\]\\s*([\\s\\S]*?)${next ? `(?=\\[${next}\\])` : "$"}`,
        "i"
      );
      const m = (text || "").match(re);
      result[label] = m ? m[1].trim() : "";
    });
    return result;
  }

  summaryContent.innerHTML = `
    <p class="summary-meta">📅 ${state.summaryPeriod === "daily" ? `${kstYesterday} 하루치` : prevWeekRange} &nbsp;·&nbsp; 생성: ${generatedAt} KST</p>
    ${Object.entries(periodData).map(([game, data]) => {
      const color = GAME_COLORS[game] || "#666";
      const sections = parseSummary(data.summary);
      const hasContent = SUMMARY_SECTIONS.some((l) => sections[l]);
      const totalViews = data.totalViews ? data.totalViews.toLocaleString("ko-KR") : "-";
      const totalComments = data.totalComments != null ? data.totalComments.toLocaleString("ko-KR") : "-";
      const statsHtml = `
        <div class="summary-stats">
          <span>📝 게시글 <strong>${data.postCount || 0}</strong>건</span>
          <span>👁 총 조회 <strong>${totalViews}</strong>회</span>
          <span>💬 총 댓글 <strong>${totalComments}</strong>개</span>
        </div>`;
      const bodyHtml = hasContent
        ? SUMMARY_SECTIONS.map((label) => {
            const content = sections[label];
            if (!content) return "";
            return `<div class="summary-section">
              <span class="summary-section-label">${escapeHtml(label)}</span>
              <p class="summary-section-body">${escapeHtml(content)}</p>
            </div>`;
          }).join("")
        : data.error
          ? `<p class="summary-error">⚠ 요약 생성 실패: ${escapeHtml(data.error)}</p>`
          : `<p class="summary-empty-msg">수집된 게시글이 없습니다.</p>`;
      return `
        <div class="summary-card" style="border-left-color:${color}">
          <div class="summary-card-head">
            <span class="game-chip" data-game="${escapeHtml(game)}">${escapeHtml(game)}</span>
          </div>
          ${statsHtml}
          <div class="summary-body">${bodyHtml}</div>
        </div>`;
    }).join("")}
  `;
}

document.querySelectorAll(".main-tab").forEach((btn) => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll(".main-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.view = btn.dataset.view;
    viewFeed.hidden    = state.view !== "feed";
    viewSummary.hidden = state.view !== "summary";
    if (state.view === "summary" && !state.summary) {
      summaryContent.innerHTML = `<div class="summary-empty">요약 불러오는 중...</div>`;
      state.summary = await fetchJson("summary.json").catch(() => null);
      renderSummary();
    }
  });
});

document.querySelectorAll(".summary-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".summary-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.summaryPeriod = btn.dataset.period;
    renderSummary();
  });
});

load();
state.timer = window.setInterval(() => load(true), 60_000);

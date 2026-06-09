const ALL = "전체";

const GAME_COLORS = {
  "대항해시대 오리진": "#0369a1",
  "언디셈버": "#7c3aed",
  "창세기전 모바일": "#c2410c"
};

const state = {
  data: null,
  game: ALL,
  sourceType: ALL,
  query: "",
  onlyAlerts: false,
  keyword: "",
  timer: null
};

const els = {
  insightCards: document.querySelector("#insightCards"),
  gameFilters: document.querySelector("#gameFilters"),
  keywordCloud: document.querySelector("#keywordCloud"),
  sourceTabs: document.querySelector("#sourceTabs"),
  feed: document.querySelector("#feed"),
  notice: document.querySelector("#notice"),
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

function temporalClass(post) {
  if (isTodayPost(post)) return "today";
  if (isThisWeekPost(post)) return "this-week";
  return "";
}

function filteredPosts() {
  const query = state.query.trim().toLowerCase();
  return allPosts().filter((post) => {
    const matchesGame = state.game === ALL || post.game === state.game;
    const matchesSource = state.sourceType === ALL || post.sourceType === state.sourceType;
    const matchesAlert = !state.onlyAlerts || post.badges.length > 0 || post.sentiment === "negative";
    const matchesKeyword = !state.keyword || post.badges.includes(state.keyword);
    const haystack = `${post.title} ${post.game} ${post.community} ${post.badges.join(" ")}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    return matchesGame && matchesSource && matchesAlert && matchesKeyword && matchesQuery;
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
  els.keywordCloud.innerHTML = entries.length
    ? entries.map(([word, count]) => `
      <button class="keyword ${state.keyword === word ? "active" : ""}" type="button" data-keyword="${escapeHtml(word)}">
        ${escapeHtml(word)} ${count}
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

function renderFeed() {
  const posts = filteredPosts();
  if (!posts.length) {
    els.feed.innerHTML = `<div class="empty">조건에 맞는 게시글이 없습니다.</div>`;
    return;
  }

  els.feed.innerHTML = posts.map((post) => `
    <article class="post ${temporalClass(post)}" data-game="${escapeHtml(post.game)}">
      <div class="post-top">
        <span class="source"><span class="game-chip" data-game="${escapeHtml(post.game)}">${escapeHtml(post.game)}</span><span>${escapeHtml(post.community)}</span></span>
        <div class="post-flags">
          ${isTodayPost(post) ? `<span class="today-badge">오늘 등록</span>` : ""}
          ${isThisWeekPost(post) ? `<span class="week-badge">금주</span>` : ""}
          <span class="sentiment ${post.sentiment}">${sentimentLabel(post.sentiment)}</span>
        </div>
      </div>
      <a href="${escapeHtml(post.url)}" target="_blank" rel="noreferrer">${escapeHtml(post.title)}</a>
      ${post.badges.length ? `<div class="badges">${post.badges.map((badge) => `<span class="badge">${escapeHtml(badge)}</span>`).join("")}</div>` : ""}
      <div class="meta">
        ${post.author ? `<span>${escapeHtml(post.author)}</span>` : ""}
        ${post.date ? `<span>등록 ${escapeHtml(post.date)}</span>` : ""}
        ${post.views ? `<span>조회 ${escapeHtml(post.views)}</span>` : ""}
      </div>
    </article>
  `).join("");
}

function render() {
  if (!state.data) return;
  renderInsights();
  renderFilters();
  renderKeywords();
  renderSentiment();
  renderNotice();
  renderFeed();
}

async function load() {
  els.refreshButton.disabled = true;
  els.refreshButton.querySelector(".icon").textContent = "...";
  try {
    const response = await fetch(`data.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`API ${response.status}`);
    state.data = await response.json();
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

load();
state.timer = window.setInterval(load, 60_000);

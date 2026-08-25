"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  data: null,
  view: "practice",
  rotation: localStorage.getItem("iac-reader-rotation") || "random",
  speed: Number(localStorage.getItem("iac-reader-speed") || 190),
  leniency: Number(localStorage.getItem("iac-reader-leniency") || 1),
  session: null,
  current: null,
  frame: null,
  duel: null,
  duelFrame: null,
  flagContext: null,
  ledgerLimit: 100,
  lastClueSets: new Map(),
  staticMode: false,
  studyId: localStorage.getItem("iac-reader-study-topic") || null,
};

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function normalizeAnswer(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const LENIENCY_LABELS = ["Exact", "Standard", "Lenient"];
const ATTEMPT_CACHE_KEY = "iac-reader-attempt-cache-v1";
const FLAG_CACHE_KEY = "iac-reader-flag-cache-v1";
const STUDY_REVIEW_KEY = "iac-reader-study-reviews-v1";

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + Number(left[i - 1] !== right[j - 1]));
      diagonal = above;
    }
  }
  return previous[right.length];
}

function fuzzyMatch(value, candidate) {
  if (value === candidate) return true;
  if (Math.min(value.length, candidate.length) < 5) return false;
  const longest = Math.max(value.length, candidate.length);
  const allowance = longest <= 8 ? 1 : longest <= 16 ? 2 : 3;
  return levenshtein(value, candidate) <= allowance;
}

function checkAnswer(topic, typed) {
  const value = normalizeAnswer(typed);
  const canonical = normalizeAnswer(topic.answerline);
  if (value === canonical) return { verdict: "correct" };
  if ((topic.promptAliases || []).includes(value)) return { verdict: "prompt" };
  if (state.leniency === 0) return { verdict: "unknown" };
  if (topic.aliases.includes(value)) {
    const owners = aliasOwners(value);
    return owners.length > 1 ? { verdict: "prompt" } : { verdict: "correct" };
  }
  if (state.leniency < 2) return { verdict: "unknown" };
  const owners = state.data.topics.filter((candidateTopic) =>
    [normalizeAnswer(candidateTopic.answerline), ...candidateTopic.aliases].some((alias) => fuzzyMatch(value, alias)));
  if (!owners.some((owner) => owner.id === topic.id)) return { verdict: "unknown" };
  return owners.length > 1 ? { verdict: "prompt" } : { verdict: "correct" };
}

function readCache(key) {
  try {
    const records = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function cacheRecord(key, record, idField) {
  const records = readCache(key);
  const index = records.findIndex((item) => item[idField] === record[idField]);
  if (index >= 0) records[index] = record;
  else records.push(record);
  localStorage.setItem(key, JSON.stringify(records.slice(-3000)));
}

function cacheRecords(key, incoming, idField) {
  incoming.forEach((record) => cacheRecord(key, record, idField));
}

function buildLocalStats(topics, clues, attempts) {
  const topicLookup = new Map(topics.map((topic) => [topic.id, topic]));
  const byClue = Object.fromEntries(clues.map((clue) => [clue.id, {
    clueId: clue.id, answerId: clue.answerId, tier: clue.tier,
    exposures: 0, completed: 0, correctAfterSeeing: 0, incorrectAfterSeeing: 0,
    buzzes: 0, correctBuzzes: 0, incorrectBuzzes: 0, lastShown: null,
    lastScore: null, history: [], buzzAccuracy: null, resultAccuracy: null,
  }]));
  const validAttempts = attempts.filter((attempt) => topicLookup.has(attempt.answer_id));
  validAttempts.forEach((attempt) => {
    (attempt.clues || []).forEach((exposure) => {
      const row = byClue[exposure.clue_id];
      const shown = Number(exposure.shown_chars || 0);
      if (!row || shown <= 0) return;
      row.exposures += 1;
      row.completed += Number(Boolean(exposure.completed));
      row.correctAfterSeeing += Number(Boolean(attempt.correct));
      row.incorrectAfterSeeing += Number(!attempt.correct);
      if (exposure.active_at_buzz) {
        row.buzzes += 1;
        row.correctBuzzes += Number(Boolean(attempt.correct));
        row.incorrectBuzzes += Number(!attempt.correct);
      }
      row.lastShown = attempt.timestamp;
      row.lastScore = attempt.score;
      row.history.push({
        timestamp: attempt.timestamp, score: attempt.score, correct: Boolean(attempt.correct),
        zone: attempt.zone, completed: Boolean(exposure.completed), shownChars: shown,
        activeAtBuzz: Boolean(exposure.active_at_buzz),
      });
    });
  });
  Object.values(byClue).forEach((row) => {
    row.history = row.history.slice(-8);
    row.buzzAccuracy = row.buzzes ? row.correctBuzzes / row.buzzes : null;
    row.resultAccuracy = row.exposures ? row.correctAfterSeeing / row.exposures : null;
  });
  const byTopic = {};
  topics.forEach((topic) => {
    const rows = clues.filter((clue) => clue.answerId === topic.id).map((clue) => byClue[clue.id]);
    const covered = rows.filter((row) => row.exposures).length;
    const shownDates = rows.map((row) => row.lastShown).filter(Boolean).sort();
    byTopic[topic.id] = {
      answerId: topic.id,
      exposures: rows.reduce((sum, row) => sum + row.exposures, 0),
      cluesCovered: covered,
      clueCount: rows.length,
      coverage: rows.length ? covered / rows.length : 0,
      buzzes: rows.reduce((sum, row) => sum + row.buzzes, 0),
      correctBuzzes: rows.reduce((sum, row) => sum + row.correctBuzzes, 0),
      lastShown: shownDates.at(-1) || null,
    };
  });
  const correct = validAttempts.filter((attempt) => attempt.correct).length;
  const covered = Object.values(byClue).filter((row) => row.exposures).length;
  return {
    summary: {
      attempts: validAttempts.length,
      correct,
      accuracy: validAttempts.length ? correct / validAttempts.length : null,
      points: validAttempts.reduce((sum, attempt) => sum + Number(attempt.score || 0), 0),
      topics: topics.length,
      clues: clues.length,
      cluesCovered: covered,
      coverage: clues.length ? covered / clues.length : 0,
    },
    byClue,
    byTopic,
  };
}

function normalizeLocalAttempt(payload) {
  const topics = topicMap();
  const clues = clueMap();
  const topic = topics.get(payload.answer_id);
  return {
    ...payload,
    id: payload.id || crypto.randomUUID(),
    client_attempt_id: payload.client_attempt_id || payload.question_id || crypto.randomUUID(),
    timestamp: payload.timestamp || new Date().toISOString(),
    answerline: payload.answerline || topic?.answerline || payload.answer_id,
    mode: payload.mode || "practice",
    clues: (payload.clues || []).map((exposure) => {
      const clue = clues.get(exposure.clue_id);
      const total = Number(exposure.total_chars || clue?.text.length || 0);
      const shown = Math.max(0, Math.min(total, Number(exposure.shown_chars || 0)));
      return { ...exposure, total_chars: total, shown_chars: shown, completed: shown >= total };
    }),
  };
}

function normalizeLocalFlag(payload) {
  const topic = topicMap().get(payload.answer_id);
  return {
    ...payload,
    id: payload.id || crypto.randomUUID(),
    client_flag_id: payload.client_flag_id || crypto.randomUUID(),
    timestamp: payload.timestamp || new Date().toISOString(),
    answerline: payload.answerline || topic?.answerline || payload.answer_id,
  };
}

function refreshLocalProgress() {
  const attempts = readCache(ATTEMPT_CACHE_KEY).map(normalizeLocalAttempt);
  const flags = readCache(FLAG_CACHE_KEY).map(normalizeLocalFlag);
  localStorage.setItem(ATTEMPT_CACHE_KEY, JSON.stringify(attempts.slice(-3000)));
  localStorage.setItem(FLAG_CACHE_KEY, JSON.stringify(flags.slice(-3000)));
  state.data.stats = buildLocalStats(state.data.topics, state.data.clues, attempts);
  state.data.recentAttempts = attempts.slice(-100).reverse();
  state.data.flags = flags;
}

function shuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function formatPercent(value) {
  return value == null ? "New" : `${Math.round(value * 100)}%`;
}

function formatDate(value, includeTime = false) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric" }).format(date);
}

function topicMap() {
  return new Map(state.data.topics.map((topic) => [topic.id, topic]));
}

function clueMap() {
  return new Map(state.data.clues.map((clue) => [clue.id, clue]));
}

function setView(view) {
  state.view = view;
  $$(".view").forEach((section) => { section.hidden = section.id !== `${view}View`; });
  $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  if (view !== "practice" && state.current && !state.current.answered) pauseStream();
  if (view !== "notRanked" && state.duel?.current && !state.duel.current.answered) pauseDuel();
  if (view === "ledger") renderLedger(true);
  if (view === "sessions") renderSessions();
  if (view === "study") renderStudy();
  history.replaceState(null, "", `#${view}`);
  window.scrollTo(0, 0);
}

function metric(value, label) {
  return `<div class="heading-metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function renderGlobalMetrics() {
  const summary = state.data.stats.summary;
  $("#setupMetrics").innerHTML = [
    metric(summary.topics, "answerlines"),
    metric(summary.clues, "clues"),
    metric(formatPercent(summary.coverage), "covered"),
  ].join("");
  $("#ledgerMetrics").innerHTML = [
    metric(`${summary.cluesCovered}/${summary.clues}`, "clues seen"),
    metric(summary.clues - summary.cluesCovered, "unseen"),
    metric(formatPercent(summary.accuracy), "answer accuracy"),
  ].join("");
  $("#sessionMetrics").innerHTML = [
    metric(summary.attempts, "attempts"),
    metric(summary.points, "net points"),
    metric(formatPercent(summary.accuracy), "accuracy"),
  ].join("");
}

function studyReviews() {
  try {
    const reviews = JSON.parse(localStorage.getItem(STUDY_REVIEW_KEY) || "{}");
    return reviews && typeof reviews === "object" && !Array.isArray(reviews) ? reviews : {};
  } catch {
    return {};
  }
}

function renderStudy() {
  const lessons = state.data.lessons || [];
  if (!lessons.length) {
    $("#studyArticle").innerHTML = '<p class="empty-cell">No lessons are available.</p>';
    return;
  }
  if (!lessons.some((lesson) => lesson.id === state.studyId)) state.studyId = lessons[0].id;
  localStorage.setItem("iac-reader-study-topic", state.studyId);
  const reviewed = studyReviews();
  const reviewedCount = lessons.filter((lesson) => reviewed[lesson.id]).length;
  $("#studyMetrics").innerHTML = [
    metric(lessons.length, "lessons"),
    metric(`${reviewedCount}/${lessons.length}`, "reviewed"),
  ].join("");
  $("#studyTopicList").innerHTML = lessons.map((lesson, index) => `
    <button class="study-topic-button${lesson.id === state.studyId ? " active" : ""}" type="button" data-study-id="${escapeHtml(lesson.id)}">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <strong>${escapeHtml(lesson.title)}</strong>
      ${reviewed[lesson.id] ? '<small aria-label="Reviewed">Reviewed</small>' : ""}
    </button>`).join("");
  renderStudyArticle(lessons.find((lesson) => lesson.id === state.studyId), reviewed);
}

function renderStudyArticle(lesson, reviewed) {
  const reviewDate = reviewed[lesson.id] ? formatDate(reviewed[lesson.id]) : null;
  const timeline = lesson.timeline.map((entry) => `
    <div class="timeline-row"><time>${escapeHtml(entry.year)}</time><p>${escapeHtml(entry.event)}</p></div>`).join("");
  const sections = lesson.sections.map((section) => `
    <section class="lesson-section">
      <h2>${escapeHtml(section.heading)}</h2>
      ${section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
    </section>`).join("");
  const clueBands = [6, 5, 4].map((tier) => `
    <section class="lesson-clue-band tier-${tier}">
      <div><span>${tier}</span><strong>${tier === 6 ? "Early" : tier === 5 ? "Middle" : "Conversion"} clues</strong></div>
      <ul>${lesson.clueLadder[String(tier)].map((clue) => `<li>${escapeHtml(clue)}</li>`).join("")}</ul>
    </section>`).join("");
  const confusables = lesson.confusables.map((item) => `
    <tr><th>${escapeHtml(item.term)}</th><td>${escapeHtml(item.distinction)}</td></tr>`).join("");
  const retrieval = lesson.retrieval.map((prompt, index) => `
    <li><span>${index + 1}</span><p>${escapeHtml(prompt)}</p></li>`).join("");
  const sources = lesson.sources.map((source) => `
    <li><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.label)}</a></li>`).join("");
  $("#studyArticle").innerHTML = `
    <header class="lesson-header">
      <div><p class="lesson-era">${escapeHtml(lesson.era)}</p><h1>${escapeHtml(lesson.title)}</h1><p class="lesson-deck">${escapeHtml(lesson.deck)}</p></div>
      <button id="toggleStudyReview" class="${reviewDate ? "secondary-button reviewed-button" : "primary-button"}" type="button">${reviewDate ? `Reviewed ${escapeHtml(reviewDate)}` : "Mark reviewed"}</button>
    </header>
    <div class="lesson-facts">${lesson.facts.map((fact) => `<div><span>${escapeHtml(fact.label)}</span><strong>${escapeHtml(fact.value)}</strong></div>`).join("")}</div>
    <div class="lesson-body">${sections}</div>
    <section class="lesson-section"><h2>Chronology</h2><div class="lesson-timeline">${timeline}</div></section>
    <section class="lesson-section"><h2>Buzz ladder</h2><div class="lesson-clue-ladder">${clueBands}</div></section>
    <section class="lesson-section"><h2>Do not confuse</h2><div class="confusable-wrap"><table class="confusable-table"><tbody>${confusables}</tbody></table></div></section>
    <section class="lesson-section"><h2>Retrieval check</h2><ol class="retrieval-list">${retrieval}</ol></section>
    <section class="lesson-sources"><h2>Question record and sources</h2><ul>${sources}</ul></section>`;
  $("#toggleStudyReview").addEventListener("click", toggleStudyReview);
}

function toggleStudyReview() {
  const reviewed = studyReviews();
  if (reviewed[state.studyId]) delete reviewed[state.studyId];
  else reviewed[state.studyId] = new Date().toISOString();
  localStorage.setItem(STUDY_REVIEW_KEY, JSON.stringify(reviewed));
  renderStudy();
}

function renderDomains() {
  const counts = new Map();
  state.data.topics.forEach((topic) => counts.set(topic.domain, (counts.get(topic.domain) || 0) + 1));
  $("#domainFilters").innerHTML = [...counts.entries()].sort().map(([domain, count]) => `
    <label class="domain-choice">
      <input type="checkbox" value="${escapeHtml(domain)}" checked>
      <span>${escapeHtml(domain)}</span><small>${count}</small>
    </label>`).join("");
}

function selectedDomains() {
  return new Set($$("#domainFilters input:checked").map((input) => input.value));
}

function ageDays(timestamp) {
  if (!timestamp) return 999;
  return Math.max(0, (Date.now() - Date.parse(timestamp)) / 86400000);
}

function cluePriority(clue) {
  const stats = state.data.stats.byClue[clue.id];
  if (!stats || stats.exposures === 0) return 900 + (clue.tier === 6 ? 80 : 0) + Math.random() * 35;
  const missWeight = stats.incorrectBuzzes * 180 + stats.incorrectAfterSeeing * 24;
  const lowExposure = Math.max(0, 6 - stats.exposures) * 34;
  const recency = Math.min(180, ageDays(stats.lastShown) * 5);
  const triggerWeakness = stats.buzzes ? (1 - stats.correctBuzzes / stats.buzzes) * 120 : 25;
  return missWeight + lowExposure + recency + triggerWeakness + (clue.tier === 6 ? 20 : 0) + Math.random() * 28;
}

function topicPriority(topic) {
  const stats = state.data.stats.byTopic[topic.id];
  const clues = state.data.clues.filter((clue) => clue.answerId === topic.id);
  const topClues = clues.map(cluePriority).sort((a, b) => b - a).slice(0, 4);
  const clueScore = topClues.reduce((sum, value) => sum + value, 0) / Math.max(1, topClues.length);
  return clueScore + (1 - (stats?.coverage || 0)) * 300 + Math.random() * 35;
}

function buildTopicQueue() {
  const domains = selectedDomains();
  let candidates = state.data.topics.filter((topic) => domains.has(topic.domain));
  if (state.rotation === "random") {
    candidates = shuffle(candidates);
  } else if (state.rotation === "coverage") {
    candidates.sort((left, right) => {
      const a = state.data.stats.byTopic[left.id];
      const b = state.data.stats.byTopic[right.id];
      return (a?.coverage || 0) - (b?.coverage || 0)
        || (a?.exposures || 0) - (b?.exposures || 0)
        || Math.random() - 0.5;
    });
  } else {
    candidates.sort((left, right) => topicPriority(right) - topicPriority(left));
  }
  const requested = $("#questionCount").value;
  const count = requested === "all" ? candidates.length : Number(requested);
  return candidates.slice(0, Math.min(count, candidates.length));
}

function chooseTierClues(answerId, tier, count) {
  const candidates = state.data.clues
    .filter((clue) => clue.answerId === answerId && clue.tier === tier)
    .sort((left, right) => cluePriority(right) - cluePriority(left));
  const poolSize = Math.min(candidates.length, Math.max(count, count * 2));
  const pool = candidates.slice(0, poolSize);
  const selectionCount = Math.min(count, candidates.length);
  const historyKey = `${answerId}:${tier}:${selectionCount}`;
  const previous = state.lastClueSets.get(historyKey);
  let selected = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    selected = shuffle(pool).slice(0, selectionCount);
    const signature = selected.map((clue) => clue.id).sort().join("|");
    if (signature !== previous || pool.length <= selectionCount) break;
  }
  state.lastClueSets.set(historyKey, selected.map((clue) => clue.id).sort().join("|"));
  return selected;
}

function segmentClasses(segment, unseen = false) {
  const classes = [];
  if (segment.type === "mark") classes.push("power-mark");
  if (segment.type === "clue" && segment.tier === 6) classes.push("power-six");
  if (segment.type === "clue" && segment.tier === 5) classes.push("power-five");
  if (unseen) classes.push("unseen");
  return classes.join(" ");
}

function targetNoun(answerType) {
  if (/pair of political factions/.test(answerType)) return "factions";
  if (/person|artist|architect|designer|photographer|anthropologist|figure/.test(answerType)) return "person";
  if (/election/.test(answerType)) return "election";
  if (/speech|document/.test(answerType)) return "work";
  if (/colony/.test(answerType)) return "settlement";
  if (/case/.test(answerType)) return "case";
  if (/treaty/.test(answerType)) return "agreement";
  if (/organization|institution|faction|movement/.test(answerType)) return "group";
  if (/monument/.test(answerType)) return "structure";
  return "event";
}

function openingQuality(text) {
  const firstWords = text.split(/\s+/).slice(0, 15).join(" ");
  if (/\bthis\b/i.test(firstWords)) return 0;
  if (/\b(his|her|he|she|him|it|its)\b/i.test(firstWords)) return 1;
  return 2;
}

function anchorOpening(text, answerType) {
  const firstWords = text.split(/\s+/).slice(0, 15).join(" ");
  if (/\bthis\b/i.test(firstWords)) return text;
  const noun = targetNoun(answerType);
  if (/^pair of /.test(answerType)) {
    if (/^Their\s+/.test(text)) return text.replace(/^Their\s+/, `These ${noun}' `);
    if (/^They\s+/.test(text)) return text.replace(/^They\s+/, `These ${noun} `);
    return `These ${noun} are associated with the following development: ${text}`;
  }
  const replacements = [
    [/^His\s+/, `This ${noun}'s `],
    [/^Her\s+/, `This ${noun}'s `],
    [/^He\s+/, `This ${noun} `],
    [/^She\s+/, `This ${noun} `],
    [/^Its\s+/, `This ${noun}'s `],
    [/^It\s+/, `This ${noun} `],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(text)) return text.replace(pattern, replacement);
  }
  if (/\b(him|her)\b/i.test(firstWords)) return text.replace(/\b(him|her)\b/i, `this ${noun}`);
  if (/\b(he|she|it)\b/i.test(firstWords)) return text.replace(/\b(he|she|it)\b/i, `this ${noun}`);
  if (/\b(his|its)\b/i.test(firstWords)) return text.replace(/\b(his|its)\b/i, `this ${noun}'s`);
  return `This ${noun} is associated with the following development: ${text}`;
}

function buildQuestion(topic, perBand = Number($("#cluesPerBand").value)) {
  const selected = [];
  [6, 5, 4].forEach((tier) => {
    const choices = chooseTierClues(topic.id, tier, perBand);
    if (tier === 6) choices.sort((left, right) => openingQuality(left.text) - openingQuality(right.text));
    selected.push(...choices);
  });
  const segments = [];
  const ranges = [];
  let cursor = 0;

  function addSegment(type, text, extra = {}) {
    const segment = { type, text, start: cursor, end: cursor + text.length, ...extra };
    segments.push(segment);
    cursor = segment.end;
    return segment;
  }

  [6, 5, 4].forEach((tier, tierIndex) => {
    selected.filter((clue) => clue.tier === tier).forEach((clue) => {
      if (cursor) addSegment("space", " ");
      const displayText = ranges.length === 0 ? anchorOpening(clue.text, topic.answerType) : clue.text;
      const segment = addSegment("clue", displayText, { clueId: clue.id, tier });
      ranges.push({ clue, start: segment.start, end: segment.end, sourceLength: clue.text.length, position: ranges.length });
    });
    if (tierIndex === 0) addSegment("mark", " (+)", { mark: "+" });
    if (tierIndex === 1) addSegment("mark", " (*)", { mark: "*" });
  });
  const finalPromptStart = cursor;
  addSegment("prompt", ` For the points, ${topic.questionPrompt}.`);
  const plus = segments.find((segment) => segment.type === "mark" && segment.mark === "+").start;
  const star = segments.find((segment) => segment.type === "mark" && segment.mark === "*").start;
  return {
    id: crypto.randomUUID(), topic, selected, segments, ranges, totalChars: cursor,
    plus, star, finalPromptStart,
  };
}

function startSession() {
  const topics = buildTopicQueue();
  if (!topics.length) return;
  state.session = {
    id: crypto.randomUUID(), topics, cursor: 0, points: 0, correct: 0, attempts: 0,
    startedAt: performance.now(), results: [],
  };
  $("#setupPanel").hidden = true;
  $("#sessionSummary").hidden = true;
  $("#readerPanel").hidden = false;
  window.scrollTo(0, 0);
  loadCurrentQuestion();
}

function loadCurrentQuestion() {
  cancelAnimationFrame(state.frame);
  const topic = state.session.topics[state.session.cursor];
  const question = buildQuestion(topic);
  state.current = {
    question, visibleChars: 0, buzzChar: null, activeClueId: null, answered: false,
    paused: false, awaitingGrade: false, startedAt: performance.now(), lastFrameAt: null,
    charRemainder: 0, answerOpened: false,
  };
  $("#readerFeedback").hidden = true;
  $("#readerFeedback").innerHTML = "";
  $("#pauseButton").disabled = false;
  $("#buzzButton").disabled = false;
  renderQuestion();
  updateSessionChrome();
  state.frame = requestAnimationFrame(streamFrame);
}

function questionZone(question, position) {
  if (position >= question.totalChars) return 3;
  if (position < question.plus) return 6;
  if (position < question.star) return 5;
  return 4;
}

function zoneAt(position = state.current.visibleChars) {
  return questionZone(state.current.question, position);
}

function zoneClass(zone) {
  return `zone-${zone}`;
}

function updateZoneBadge() {
  const zone = zoneAt();
  const badge = $("#zoneBadge");
  badge.textContent = zone;
  badge.className = `zone-badge ${zoneClass(zone)}`;
}

function currentActiveClue(position = state.current.visibleChars) {
  if (position >= state.current.question.totalChars) return null;
  const started = state.current.question.ranges.filter((range) => position > range.start);
  return started.length ? started[started.length - 1] : null;
}

function renderQuestion(showComplete = false) {
  const current = state.current;
  const visible = showComplete ? current.question.totalChars : current.visibleChars;
  const fragment = document.createDocumentFragment();
  current.question.segments.forEach((segment) => {
    const shownLength = Math.max(0, Math.min(segment.text.length, visible - segment.start));
    if (shownLength > 0) {
      const span = document.createElement("span");
      span.className = segmentClasses(segment);
      span.textContent = segment.text.slice(0, shownLength);
      fragment.append(span);
    }
    if (showComplete && shownLength < segment.text.length) {
      const unseen = document.createElement("span");
      unseen.className = segmentClasses(segment, true);
      unseen.textContent = segment.text.slice(shownLength);
      fragment.append(unseen);
    }
    if (showComplete && current.buzzChar != null && current.buzzChar >= segment.start && current.buzzChar < segment.end) {
      // The caret is inserted in renderFullQuestionWithBuzz instead.
    }
  });
  if (!showComplete && !current.answered) {
    const cursor = document.createElement("span");
    cursor.className = "stream-cursor";
    fragment.append(cursor);
  }
  $("#questionText").replaceChildren(fragment);
  updateZoneBadge();
  renderClueReach();
}

function renderFullQuestionWithBuzz() {
  const current = state.current;
  const fragment = document.createDocumentFragment();
  current.question.segments.forEach((segment) => {
    const beforeBuzz = current.buzzChar == null || current.buzzChar <= segment.start || current.buzzChar >= segment.end;
    if (!beforeBuzz && current.buzzChar > segment.start && current.buzzChar < segment.end) {
      const before = document.createElement("span");
      before.className = segmentClasses(segment);
      before.textContent = segment.text.slice(0, current.buzzChar - segment.start);
      fragment.append(before);
      const caret = document.createElement("span");
      caret.className = "buzz-caret";
      caret.title = "Buzz position";
      fragment.append(caret);
      const after = document.createElement("span");
      after.className = segmentClasses(segment, current.buzzChar < current.question.totalChars);
      after.textContent = segment.text.slice(current.buzzChar - segment.start);
      fragment.append(after);
    } else {
      const span = document.createElement("span");
      span.className = segmentClasses(segment, current.buzzChar != null && segment.start >= current.buzzChar);
      span.textContent = segment.text;
      fragment.append(span);
    }
  });
  $("#questionText").replaceChildren(fragment);
}

function renderClueReach() {
  const ranges = state.current.question.ranges;
  const visible = state.current.visibleChars;
  const reached = ranges.filter((range) => visible > range.start).length;
  $("#clueReach").textContent = `${reached} / ${ranges.length}`;
  $("#clueTicks").style.gridTemplateColumns = `repeat(${ranges.length}, 1fr)`;
  $("#clueTicks").innerHTML = ranges.map((range) => {
    const status = visible >= range.end ? "completed" : visible > range.start ? "started" : "";
    return `<span class="clue-tick ${status}" title="${escapeHtml(range.clue.id)}"></span>`;
  }).join("");
}

function streamFrame(timestamp) {
  const current = state.current;
  if (!current || current.answered) return;
  if (current.lastFrameAt == null) current.lastFrameAt = timestamp;
  const elapsed = timestamp - current.lastFrameAt;
  current.lastFrameAt = timestamp;
  if (!current.paused && !$("#answerDialog").open) {
    const charsPerMs = (state.speed * 5) / 60000;
    current.charRemainder += elapsed * charsPerMs;
    const advance = Math.floor(current.charRemainder);
    if (advance > 0) {
      current.charRemainder -= advance;
      current.visibleChars = Math.min(current.question.totalChars, current.visibleChars + advance);
      renderQuestion();
      $("#readerClock").textContent = `${((performance.now() - current.startedAt) / 1000).toFixed(1)}s`;
    }
    if (current.visibleChars >= current.question.totalChars && !current.answerOpened) {
      current.answerOpened = true;
      current.paused = true;
      setTimeout(() => openAnswerDialog(true), 220);
    }
  }
  state.frame = requestAnimationFrame(streamFrame);
}

function pauseStream() {
  if (!state.current || state.current.answered) return;
  state.current.paused = true;
  $("#pauseButton").textContent = "Resume";
}

function togglePause() {
  if (!state.current || state.current.answered || $("#answerDialog").open) return;
  state.current.paused = !state.current.paused;
  state.current.lastFrameAt = null;
  $("#pauseButton").textContent = state.current.paused ? "Resume" : "Pause";
}

function buzz() {
  if (!state.current || state.current.answered || state.current.visibleChars <= 0 || $("#answerDialog").open) return;
  openAnswerDialog(state.current.visibleChars >= state.current.question.totalChars);
}

function openAnswerDialog(finalAnswer) {
  const current = state.current;
  current.paused = true;
  current.buzzChar = current.visibleChars;
  current.activeClueId = finalAnswer ? null : currentActiveClue(current.visibleChars)?.clue.id || null;
  const zone = finalAnswer ? 3 : zoneAt(current.visibleChars);
  const badge = $("#answerZone");
  badge.textContent = zone;
  badge.className = `zone-badge ${zoneClass(zone)}`;
  $("#answerInput").value = "";
  $("#answerPrompt").textContent = "";
  $("#cancelBuzz").textContent = finalAnswer ? "No answer" : "Resume";
  $("#answerDialog").showModal();
  requestAnimationFrame(() => $("#answerInput").focus());
}

function aliasOwners(alias) {
  return state.data.topics.filter((topic) => topic.aliases.includes(alias));
}

function submitAnswer(event) {
  event.preventDefault();
  const typed = $("#answerInput").value.trim();
  if (!typed) {
    $("#answerPrompt").textContent = "Enter a response or record no answer.";
    return;
  }
  const topic = state.current.question.topic;
  const match = checkAnswer(topic, typed);
  if (match.verdict === "prompt") {
    $("#answerPrompt").textContent = `Prompt: be more specific than “${typed}.”`;
    $("#answerInput").select();
    return;
  }
  $("#answerDialog").close();
  if (match.verdict === "correct") {
    finalizeAttempt(true, typed, false);
  } else {
    showSelfGrade(typed);
  }
}

function cancelBuzz() {
  const finalAnswer = state.current.visibleChars >= state.current.question.totalChars;
  $("#answerDialog").close();
  if (finalAnswer) {
    finalizeAttempt(false, "", false);
  } else {
    state.current.buzzChar = null;
    state.current.activeClueId = null;
    state.current.paused = false;
    state.current.lastFrameAt = null;
  }
}

function showSelfGrade(typed) {
  const topic = state.current.question.topic;
  state.current.awaitingGrade = true;
  $("#pauseButton").disabled = true;
  $("#buzzButton").disabled = true;
  const feedback = $("#readerFeedback");
  feedback.hidden = false;
  feedback.className = "reader-feedback wrong";
  feedback.innerHTML = `
    <h2>Grade the response</h2>
    <p>You entered <strong>${escapeHtml(typed)}</strong>.</p>
    <p>Answerline: <strong>${escapeHtml(topic.answerline)}</strong></p>
    <div class="feedback-actions">
      <button id="gradeIncorrect" class="secondary-button" type="button">Count incorrect</button>
      <button id="gradeCorrect" class="primary-button" type="button">Accept response</button>
    </div>`;
  $("#gradeIncorrect").addEventListener("click", () => finalizeAttempt(false, typed, false));
  $("#gradeCorrect").addEventListener("click", () => finalizeAttempt(true, typed, true));
}

function buildExposures(current = state.current) {
  return current.question.ranges.map((range) => {
    const displayLength = range.end - range.start;
    const displayShown = Math.max(0, Math.min(displayLength, current.buzzChar - range.start));
    const shown = Math.round((displayShown / displayLength) * range.sourceLength);
    return {
      clue_id: range.clue.id,
      tier: range.clue.tier,
      position: range.position,
      shown_chars: shown,
      total_chars: range.sourceLength,
      active_at_buzz: range.clue.id === current.activeClueId,
    };
  });
}

async function persistAttempt(payload) {
  cacheRecord(ATTEMPT_CACHE_KEY, payload, "client_attempt_id");
  if (state.staticMode) {
    const record = normalizeLocalAttempt(payload);
    cacheRecord(ATTEMPT_CACHE_KEY, record, "client_attempt_id");
    refreshLocalProgress();
    renderGlobalMetrics();
    return { ok: true, attempt: record, stats: state.data.stats, recentAttempts: state.data.recentAttempts };
  }
  const response = await fetch("/api/attempt", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error((await response.json()).error || "Save failed");
  const saved = await response.json();
  cacheRecord(ATTEMPT_CACHE_KEY, saved.attempt, "client_attempt_id");
  state.data.stats = saved.stats;
  state.data.recentAttempts = saved.recentAttempts;
  renderGlobalMetrics();
  return saved;
}

async function finalizeAttempt(correct, typed, manualOverride) {
  const current = state.current;
  if (current.answered) return;
  current.answered = true;
  current.paused = true;
  const zone = current.buzzChar >= current.question.totalChars ? 3 : zoneAt(current.buzzChar);
  const score = correct ? zone : zone === 3 ? -1 : -2;
  const payload = {
    client_attempt_id: current.question.id,
    session_id: state.session.id,
    question_id: current.question.id,
    answer_id: current.question.topic.id,
    correct,
    score,
    zone,
    typed_answer: typed,
    manual_override: manualOverride,
    buzz_char: current.buzzChar,
    elapsed_ms: Math.round(performance.now() - current.startedAt),
    clues: buildExposures(),
  };

  state.session.points += score;
  state.session.correct += Number(correct);
  state.session.attempts += 1;
  state.session.results.push({ correct, score, zone });
  renderFullQuestionWithBuzz();
  $("#pauseButton").disabled = true;
  $("#buzzButton").disabled = true;
  const feedback = $("#readerFeedback");
  feedback.hidden = false;
  feedback.className = `reader-feedback${correct ? "" : " wrong"}`;
  feedback.innerHTML = `
    <h2>${correct ? `Correct for ${score}` : `Incorrect for ${score}`}</h2>
    <p><strong>${escapeHtml(current.question.topic.answerline)}</strong></p>
    ${typed ? `<p>Your response: ${escapeHtml(typed)}</p>` : ""}
    <div class="feedback-actions"><button id="nextQuestion" class="primary-button" type="button">${state.session.cursor + 1 >= state.session.topics.length ? "Session results" : "Next tossup"}</button></div>`;
  $("#nextQuestion").addEventListener("click", advanceQuestion);
  updateSessionChrome();

  try {
    await persistAttempt(payload);
  } catch (error) {
    const pending = JSON.parse(localStorage.getItem("iac-reader-pending") || "[]");
    pending.push(payload);
    localStorage.setItem("iac-reader-pending", JSON.stringify(pending));
    feedback.insertAdjacentHTML("beforeend", `<p class="save-warning">Saved in this browser pending server retry.</p>`);
  }
}

function advanceQuestion() {
  state.session.cursor += 1;
  if (state.session.cursor >= state.session.topics.length) {
    finishSession();
  } else {
    loadCurrentQuestion();
  }
}

function updateSessionChrome() {
  const session = state.session;
  $("#questionProgress").textContent = `${Math.min(session.cursor + 1, session.topics.length)} / ${session.topics.length}`;
  $("#sessionPoints").textContent = `${session.points} points`;
  $("#sessionProgressFill").style.width = `${(session.cursor / session.topics.length) * 100}%`;
  if (state.current) {
    $("#readerDomain").textContent = state.current.question.topic.domain;
    $("#pauseButton").textContent = state.current.paused ? "Resume" : "Pause";
  }
}

function finishSession() {
  cancelAnimationFrame(state.frame);
  const session = state.session;
  $("#readerPanel").hidden = true;
  const elapsed = performance.now() - session.startedAt;
  const accuracy = session.attempts ? session.correct / session.attempts : 0;
  const positive = session.results.filter((result) => result.score > 0).length;
  $("#sessionSummary").hidden = false;
  $("#sessionSummary").innerHTML = `
    <section class="summary-panel">
      <p class="kicker">Session complete</p><h1>Playoff retrieval</h1>
      <div class="summary-score">${session.points}</div>
      <div class="summary-grid">
        <div><strong>${formatPercent(accuracy)}</strong><span>accuracy</span></div>
        <div><strong>${positive}/${session.attempts}</strong><span>positive scores</span></div>
        <div><strong>${Math.round(elapsed / 60000)}m</strong><span>elapsed</span></div>
      </div>
      <button id="newSession" class="primary-button" type="button">Build another session</button>
    </section>`;
  $("#newSession").addEventListener("click", showSetup);
}

function showSetup() {
  state.session = null;
  state.current = null;
  $("#readerPanel").hidden = true;
  $("#sessionSummary").hidden = true;
  $("#setupPanel").hidden = false;
}

function endSession() {
  if (!state.session) return;
  if (!state.session.attempts) showSetup();
  else finishSession();
}

const AI_PROFILES = {
  semifinalist: {
    label: "Semifinalist",
    zones: [[6, 8], [5, 28], [4, 48], [3, 16]],
    accuracy: { 6: 0.56, 5: 0.72, 4: 0.84, 3: 0.90 },
  },
  finalist: {
    label: "Finalist",
    zones: [[6, 28], [5, 40], [4, 25], [3, 7]],
    accuracy: { 6: 0.72, 5: 0.84, 4: 0.90, 3: 0.95 },
  },
  champion: {
    label: "Champion",
    zones: [[6, 48], [5, 35], [4, 15], [3, 2]],
    accuracy: { 6: 0.82, 5: 0.90, 4: 0.95, 3: 0.97 },
  },
};

function weightedChoice(entries) {
  let roll = Math.random() * entries.reduce((sum, entry) => sum + entry[1], 0);
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

function randomBetween(start, end) {
  const low = Math.max(1, Math.ceil(start));
  const high = Math.max(low, Math.floor(end));
  return low + Math.floor(Math.random() * (high - low + 1));
}

function buildAiPlan(question, difficulty) {
  if (difficulty === "random") {
    const position = randomBetween(question.totalChars * 0.05, question.totalChars * 0.98);
    return { position, zone: questionZone(question, position), correct: Math.random() < 0.5 };
  }
  const profile = AI_PROFILES[difficulty];
  const zone = weightedChoice(profile.zones);
  const ranges = {
    6: [question.totalChars * 0.04, question.plus - 1],
    5: [question.plus + 4, question.star - 1],
    4: [question.star + 4, question.totalChars - 1],
    3: [question.totalChars, question.totalChars],
  };
  const position = randomBetween(...ranges[zone]);
  return { position, zone, correct: Math.random() < profile.accuracy[zone] };
}

function duelOpponentLabel(difficulty) {
  return difficulty === "random" ? "Random challenger" : AI_PROFILES[difficulty].label;
}

function startDuel() {
  cancelAnimationFrame(state.duelFrame);
  const difficulty = $("#duelDifficulty").value;
  state.duel = {
    id: crypto.randomUUID(),
    difficulty,
    perBand: Number($("#duelCluesPerBand").value),
    speed: Number($("#duelSpeed").value),
    topics: shuffle(state.data.topics),
    topicCursor: 0,
    questionNumber: 0,
    userScore: 0,
    aiScore: 0,
    current: null,
    startedAt: performance.now(),
  };
  $("#duelSetup").hidden = true;
  $("#duelSummary").hidden = true;
  $("#duelGame").hidden = false;
  $("#duelOpponentName").textContent = duelOpponentLabel(difficulty);
  window.scrollTo(0, 0);
  loadDuelQuestion();
}

function nextDuelTopic() {
  if (state.duel.topicCursor >= state.duel.topics.length) {
    state.duel.topics = shuffle(state.data.topics);
    state.duel.topicCursor = 0;
  }
  return state.duel.topics[state.duel.topicCursor++];
}

function loadDuelQuestion() {
  cancelAnimationFrame(state.duelFrame);
  const question = buildQuestion(nextDuelTopic(), state.duel.perBand);
  state.duel.questionNumber += 1;
  state.duel.current = {
    question,
    visibleChars: 0,
    buzzChar: null,
    activeClueId: null,
    answered: false,
    paused: false,
    userEligible: true,
    aiEligible: true,
    answerOpened: false,
    startedAt: performance.now(),
    lastFrameAt: null,
    charRemainder: 0,
    aiPlan: buildAiPlan(question, state.duel.difficulty),
  };
  $("#duelFeedback").hidden = true;
  $("#duelFeedback").innerHTML = "";
  $("#duelPause").disabled = false;
  $("#duelBuzz").disabled = false;
  $("#duelAiStatus strong").textContent = "Reading";
  renderDuelQuestion();
  updateDuelScoreboard();
  state.duelFrame = requestAnimationFrame(duelStreamFrame);
}

function renderDuelQuestion(showComplete = false, revealBuzz = null) {
  const current = state.duel.current;
  const visible = showComplete ? current.question.totalChars : current.visibleChars;
  const fragment = document.createDocumentFragment();
  current.question.segments.forEach((segment) => {
    const shownLength = Math.max(0, Math.min(segment.text.length, visible - segment.start));
    const buzzInside = revealBuzz != null && revealBuzz > segment.start && revealBuzz < segment.end;
    if (buzzInside) {
      const before = document.createElement("span");
      before.className = segmentClasses(segment);
      before.textContent = segment.text.slice(0, revealBuzz - segment.start);
      fragment.append(before);
      const caret = document.createElement("span");
      caret.className = "buzz-caret";
      fragment.append(caret);
      const after = document.createElement("span");
      after.className = segmentClasses(segment, true);
      after.textContent = segment.text.slice(revealBuzz - segment.start);
      fragment.append(after);
      return;
    }
    if (shownLength > 0) {
      const span = document.createElement("span");
      span.className = segmentClasses(segment);
      span.textContent = segment.text.slice(0, shownLength);
      fragment.append(span);
    }
    if (showComplete && shownLength < segment.text.length) {
      const unseen = document.createElement("span");
      unseen.className = segmentClasses(segment, true);
      unseen.textContent = segment.text.slice(shownLength);
      fragment.append(unseen);
    }
  });
  if (!showComplete && !current.answered) {
    const cursor = document.createElement("span");
    cursor.className = "stream-cursor";
    fragment.append(cursor);
  }
  $("#duelQuestionText").replaceChildren(fragment);
  const zone = questionZone(current.question, current.visibleChars);
  $("#duelZoneBadge").textContent = zone;
  $("#duelZoneBadge").className = `zone-badge ${zoneClass(zone)}`;
}

function duelStreamFrame(timestamp) {
  const current = state.duel?.current;
  if (!current || current.answered) return;
  if (current.lastFrameAt == null) current.lastFrameAt = timestamp;
  const elapsed = timestamp - current.lastFrameAt;
  current.lastFrameAt = timestamp;
  if (!current.paused && !$("#duelAnswerDialog").open && !$("#flagDialog").open) {
    const charsPerMs = (state.duel.speed * 5) / 60000;
    current.charRemainder += elapsed * charsPerMs;
    const advance = Math.floor(current.charRemainder);
    if (advance > 0) {
      current.charRemainder -= advance;
      current.visibleChars = Math.min(current.question.totalChars, current.visibleChars + advance);
      renderDuelQuestion();
      $("#duelClock").textContent = `${((performance.now() - current.startedAt) / 1000).toFixed(1)}s`;
    }
    if (current.aiEligible && current.visibleChars >= current.aiPlan.position) {
      processAiBuzz();
    } else if (current.visibleChars >= current.question.totalChars && !current.answerOpened) {
      current.answerOpened = true;
      current.paused = true;
      if (current.userEligible) setTimeout(() => openDuelAnswerDialog(true), 180);
      else finishDuelQuestion("dead", "No correct answer");
    }
  }
  state.duelFrame = requestAnimationFrame(duelStreamFrame);
}

function updateDuelScoreboard() {
  const duel = state.duel;
  $("#duelUserScore").textContent = duel.userScore;
  $("#duelAiScore").textContent = duel.aiScore;
  $("#duelQuestionNumber").textContent = `Question ${duel.questionNumber}`;
  if (duel.current) $("#duelDomain").textContent = duel.current.question.topic.domain;
}

function pauseDuel() {
  if (!state.duel?.current || state.duel.current.answered) return;
  state.duel.current.paused = true;
  $("#duelPause").textContent = "Resume";
}

function resumeDuel() {
  if (!state.duel?.current || state.duel.current.answered) return;
  state.duel.current.paused = false;
  state.duel.current.lastFrameAt = null;
  $("#duelPause").textContent = "Pause";
}

function toggleDuelPause() {
  if (!state.duel?.current || state.duel.current.answered || $("#duelAnswerDialog").open) return;
  if (state.duel.current.paused) resumeDuel();
  else pauseDuel();
}

function duelBuzz() {
  const current = state.duel?.current;
  if (!current || current.answered || !current.userEligible || current.visibleChars <= 0 || $("#duelAnswerDialog").open) return;
  openDuelAnswerDialog(current.visibleChars >= current.question.totalChars);
}

function openDuelAnswerDialog(finalAnswer) {
  const current = state.duel.current;
  current.paused = true;
  current.buzzChar = current.visibleChars;
  current.activeClueId = finalAnswer ? null : currentActiveClueFor(current, current.visibleChars)?.clue.id || null;
  const zone = finalAnswer ? 3 : questionZone(current.question, current.visibleChars);
  $("#duelAnswerZone").textContent = zone;
  $("#duelAnswerZone").className = `zone-badge ${zoneClass(zone)}`;
  $("#duelAnswerInput").value = "";
  $("#duelAnswerPrompt").textContent = "";
  $("#cancelDuelBuzz").textContent = finalAnswer ? "No answer" : "Resume";
  $("#duelAnswerDialog").showModal();
  requestAnimationFrame(() => $("#duelAnswerInput").focus());
}

function currentActiveClueFor(current, position) {
  if (position >= current.question.totalChars) return null;
  const started = current.question.ranges.filter((range) => position > range.start);
  return started.length ? started[started.length - 1] : null;
}

function submitDuelAnswer(event) {
  event.preventDefault();
  const typed = $("#duelAnswerInput").value.trim();
  if (!typed) {
    $("#duelAnswerPrompt").textContent = "Enter a response or record no answer.";
    return;
  }
  const match = checkAnswer(state.duel.current.question.topic, typed);
  if (match.verdict === "prompt") {
    $("#duelAnswerPrompt").textContent = `Prompt: be more specific than “${typed}.”`;
    $("#duelAnswerInput").select();
    return;
  }
  $("#duelAnswerDialog").close();
  if (match.verdict === "correct") resolveDuelUser(true, typed, false);
  else showDuelSelfGrade(typed);
}

function cancelDuelBuzz() {
  const current = state.duel.current;
  const finalAnswer = current.visibleChars >= current.question.totalChars;
  $("#duelAnswerDialog").close();
  if (finalAnswer) resolveDuelUser(false, "", false);
  else {
    current.buzzChar = null;
    current.activeClueId = null;
    resumeDuel();
  }
}

function showDuelSelfGrade(typed) {
  const current = state.duel.current;
  const feedback = $("#duelFeedback");
  feedback.hidden = false;
  feedback.className = "reader-feedback wrong";
  feedback.innerHTML = `<h2>Grade the response</h2><p>You entered <strong>${escapeHtml(typed)}</strong>.</p><p>Answerline: <strong>${escapeHtml(current.question.topic.answerline)}</strong></p><div class="feedback-actions"><button id="duelGradeIncorrect" class="secondary-button" type="button">Count incorrect</button><button id="duelGradeCorrect" class="primary-button" type="button">Accept response</button></div>`;
  $("#duelGradeIncorrect").addEventListener("click", () => resolveDuelUser(false, typed, false));
  $("#duelGradeCorrect").addEventListener("click", () => resolveDuelUser(true, typed, true));
}

async function resolveDuelUser(correct, typed, manualOverride) {
  const current = state.duel.current;
  if (!current.userEligible || current.answered) return;
  current.userEligible = false;
  const zone = current.buzzChar >= current.question.totalChars ? 3 : questionZone(current.question, current.buzzChar);
  const score = correct ? zone : zone === 3 ? -1 : -2;
  state.duel.userScore += score;
  const payload = {
    client_attempt_id: `${current.question.id}-duel-user`,
    session_id: state.duel.id,
    question_id: current.question.id,
    answer_id: current.question.topic.id,
    correct,
    score,
    zone,
    typed_answer: typed,
    manual_override: manualOverride,
    buzz_char: current.buzzChar,
    elapsed_ms: Math.round(performance.now() - current.startedAt),
    clues: buildExposures(current),
    mode: "not-ranked",
  };
  persistAttempt(payload).catch(() => {});
  updateDuelScoreboard();
  if (correct) {
    finishDuelQuestion("user", `Correct for ${score}`);
    return;
  }
  const wasFinal = zone === 3;
  current.buzzChar = null;
  current.activeClueId = null;
  const feedback = $("#duelFeedback");
  feedback.hidden = false;
  feedback.className = "reader-feedback wrong";
  feedback.innerHTML = `<h2>Incorrect for ${score}</h2><p>The opponent may still buzz.</p>`;
  if (wasFinal || !current.aiEligible) {
    setTimeout(() => finishDuelQuestion("dead", "No correct answer"), 700);
  } else {
    setTimeout(() => { feedback.hidden = true; resumeDuel(); }, 850);
  }
}

function processAiBuzz() {
  const current = state.duel.current;
  if (!current.aiEligible || current.answered) return;
  current.aiEligible = false;
  current.paused = true;
  current.visibleChars = Math.max(current.visibleChars, current.aiPlan.position);
  const zone = questionZone(current.question, current.aiPlan.position);
  const score = current.aiPlan.correct ? zone : zone === 3 ? -1 : -2;
  $("#duelAiStatus strong").textContent = `Buzzing for ${zone}`;
  setTimeout(() => {
    if (!state.duel?.current || state.duel.current !== current || current.answered) return;
    state.duel.aiScore += score;
    updateDuelScoreboard();
    if (current.aiPlan.correct) {
      $("#duelAiStatus strong").textContent = `Correct for ${score}`;
      finishDuelQuestion("ai", `Opponent correct for ${score}`, current.aiPlan.position);
    } else {
      $("#duelAiStatus strong").textContent = `Incorrect for ${score}`;
      const feedback = $("#duelFeedback");
      feedback.hidden = false;
      feedback.className = "reader-feedback wrong";
      feedback.innerHTML = `<h2>Opponent incorrect for ${score}</h2><p>You may continue reading.</p>`;
      if (!current.userEligible && current.visibleChars >= current.question.totalChars) {
        setTimeout(() => finishDuelQuestion("dead", "No correct answer"), 700);
      } else {
        setTimeout(() => { feedback.hidden = true; resumeDuel(); }, 850);
      }
    }
  }, 520);
}

function finishDuelQuestion(winner, heading, aiBuzzChar = null) {
  const current = state.duel.current;
  if (current.answered) return;
  current.answered = true;
  current.paused = true;
  cancelAnimationFrame(state.duelFrame);
  renderDuelQuestion(true, winner === "user" ? current.buzzChar : aiBuzzChar);
  $("#duelPause").disabled = true;
  $("#duelBuzz").disabled = true;
  const matchOver = state.duel.userScore >= 40 || state.duel.aiScore >= 40;
  const feedback = $("#duelFeedback");
  feedback.hidden = false;
  feedback.className = `reader-feedback${winner === "dead" ? " wrong" : ""}`;
  feedback.innerHTML = `<h2>${escapeHtml(heading)}</h2><p><strong>${escapeHtml(current.question.topic.answerline)}</strong></p><div class="feedback-actions"><button id="nextDuelQuestion" class="primary-button" type="button">${matchOver ? "Match results" : "Next tossup"}</button></div>`;
  $("#nextDuelQuestion").addEventListener("click", () => matchOver ? finishDuel() : loadDuelQuestion());
}

function finishDuel() {
  if (!state.duel) return;
  cancelAnimationFrame(state.duelFrame);
  const duel = state.duel;
  $("#duelGame").hidden = true;
  $("#duelSummary").hidden = false;
  const result = duel.userScore === duel.aiScore ? "Draw" : duel.userScore > duel.aiScore ? "You win" : `${duelOpponentLabel(duel.difficulty)} wins`;
  $("#duelSummary").innerHTML = `<section class="summary-panel"><p class="kicker">Not Ranked</p><h1>${escapeHtml(result)}</h1><div class="match-final"><strong>${duel.userScore}</strong><span>–</span><strong>${duel.aiScore}</strong></div><div class="summary-grid"><div><strong>${duel.questionNumber}</strong><span>questions</span></div><div><strong>${duelOpponentLabel(duel.difficulty)}</strong><span>opponent</span></div><div><strong>${Math.max(1, Math.round((performance.now() - duel.startedAt) / 60000))}m</strong><span>elapsed</span></div></div><button id="newDuel" class="primary-button" type="button">Play another match</button></section>`;
  $("#newDuel").addEventListener("click", showDuelSetup);
}

function showDuelSetup() {
  cancelAnimationFrame(state.duelFrame);
  state.duel = null;
  $("#duelGame").hidden = true;
  $("#duelSummary").hidden = true;
  $("#duelSetup").hidden = false;
}

function endDuel() {
  if (!state.duel) return;
  finishDuel();
}

function clueStatus(row) {
  if (!row || !row.exposures) return "unseen";
  if (row.incorrectBuzzes || row.incorrectAfterSeeing) return "missed";
  if (row.buzzes) return "buzzed";
  return "seen";
}

function flagsForClue(clueId) {
  return (state.data.flags || []).filter((flag) => flag.clue_ids?.includes(clueId));
}

function renderLedger(reset = false) {
  if (reset) state.ledgerLimit = 100;
  const query = normalizeAnswer($("#ledgerSearch").value);
  const tier = $("#ledgerTier").value;
  const status = $("#ledgerStatus").value;
  const topics = topicMap();
  const rows = state.data.clues.map((clue) => ({ clue, topic: topics.get(clue.answerId), stats: state.data.stats.byClue[clue.id], flags: flagsForClue(clue.id) }))
    .filter(({ clue, topic, stats, flags }) => {
      if (tier !== "all" && clue.tier !== Number(tier)) return false;
      if (status === "flagged" && !flags.length) return false;
      if (status !== "all" && status !== "flagged" && clueStatus(stats) !== status) return false;
      if (!query) return true;
      return normalizeAnswer(`${topic.answerline} ${clue.text} ${clue.id}`).includes(query);
    })
    .sort((left, right) => cluePriority(right.clue) - cluePriority(left.clue));
  $("#ledgerBody").innerHTML = rows.slice(0, state.ledgerLimit).map(({ clue, topic, stats, flags }) => `
    <tr>
      <td class="clue-cell"><strong>${escapeHtml(topic.answerline)} · ${escapeHtml(clue.id)}</strong><span>${escapeHtml(clue.text)}</span>${flags.length ? `<small class="flag-tag">${flags.length} flag${flags.length === 1 ? "" : "s"}</small>` : ""}</td>
      <td><span class="band-pill t${clue.tier}">${clue.tier}</span></td>
      <td>${stats.exposures}</td><td>${stats.completed}</td><td>${stats.buzzes}</td>
      <td>${stats.buzzAccuracy == null ? '<span class="empty-cell">—</span>' : formatPercent(stats.buzzAccuracy)}</td>
      <td>${formatDate(stats.lastShown)}</td>
    </tr>`).join("") || '<tr><td colspan="7" class="empty-cell">No clues match these filters.</td></tr>';
  $("#loadMoreClues").hidden = rows.length <= state.ledgerLimit;
}

function questionPlainText(current) {
  return current.question.segments.map((segment) => segment.text).join("").trim();
}

function openFlagDialog(source) {
  const current = source === "duel" ? state.duel?.current : state.current;
  if (!current) return;
  if (source === "duel") pauseDuel();
  else pauseStream();
  state.flagContext = { source, current, wasAnswered: current.answered };
  $("#flagAnswerline").textContent = current.question.topic.answerline;
  $("#flagCategory").value = "study";
  $("#flagNote").value = "";
  $("#flagStatus").textContent = "";
  $("#flagDialog").showModal();
}

function cancelFlag() {
  $("#flagDialog").close();
  const context = state.flagContext;
  state.flagContext = null;
  if (!context || context.wasAnswered) return;
  if (context.source === "duel") resumeDuel();
  else {
    context.current.paused = false;
    context.current.lastFrameAt = null;
  }
}

async function saveFlag(event) {
  event.preventDefault();
  const context = state.flagContext;
  if (!context) return;
  const current = context.current;
  const payload = {
    client_flag_id: crypto.randomUUID(),
    answer_id: current.question.topic.id,
    category: $("#flagCategory").value,
    note: $("#flagNote").value.trim(),
    question_text: questionPlainText(current),
    clue_ids: current.question.ranges.map((range) => range.clue.id),
  };
  cacheRecord(FLAG_CACHE_KEY, payload, "client_flag_id");
  if (state.staticMode) {
    const record = normalizeLocalFlag(payload);
    cacheRecord(FLAG_CACHE_KEY, record, "client_flag_id");
    refreshLocalProgress();
    $("#flagStatus").textContent = "Saved on this device.";
    setTimeout(cancelFlag, 280);
    return;
  }
  try {
    const response = await fetch("/api/flag", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error((await response.json()).error || "Flag save failed");
    const saved = await response.json();
    state.data.flags = saved.flags;
    $("#flagStatus").textContent = "Saved.";
    setTimeout(cancelFlag, 280);
  } catch (error) {
    $("#flagStatus").textContent = "Saved in this browser and will retry automatically.";
    setTimeout(cancelFlag, 500);
  }
}

function renderSessions() {
  const clues = clueMap();
  $("#sessionsBody").innerHTML = state.data.recentAttempts.map((attempt) => {
    const trigger = attempt.clues?.find((clue) => clue.active_at_buzz);
    const triggerText = trigger ? clues.get(trigger.clue_id)?.text || trigger.clue_id : "Final answer";
    return `<tr>
      <td>${formatDate(attempt.timestamp, true)}</td>
      <td><strong>${escapeHtml(attempt.answerline)}</strong></td>
      <td><span class="session-result ${attempt.correct ? "correct" : "incorrect"}">${attempt.correct ? "Correct" : "Incorrect"}</span></td>
      <td>${attempt.score > 0 ? "+" : ""}${attempt.score}</td><td>${attempt.zone}</td>
      <td class="clue-cell"><span>${escapeHtml(triggerText)}</span></td>
    </tr>`;
  }).join("") || '<tr><td colspan="6" class="empty-cell">No IAC Reader attempts yet.</td></tr>';
}

async function flushPending() {
  if (state.staticMode) return;
  const pending = JSON.parse(localStorage.getItem("iac-reader-pending") || "[]");
  if (!pending.length) return;
  const remaining = [];
  for (const payload of pending) {
    try {
      const response = await fetch("/api/attempt", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!response.ok) remaining.push(payload);
    } catch {
      remaining.push(payload);
    }
  }
  localStorage.setItem("iac-reader-pending", JSON.stringify(remaining));
}

async function flushLocalCache(key, endpoint) {
  if (state.staticMode) return;
  const cached = JSON.parse(localStorage.getItem(key) || "[]");
  for (const payload of cached) {
    try {
      await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
    } catch {
      break;
    }
  }
}

async function importProgress(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const button = $("#importProgress");
  try {
    button.textContent = "Importing";
    const payload = JSON.parse(await file.text());
    if (!Array.isArray(payload.attempts) || !Array.isArray(payload.flags)) throw new Error("Invalid progress backup");
    if (payload.studyReviews && typeof payload.studyReviews === "object") {
      localStorage.setItem(STUDY_REVIEW_KEY, JSON.stringify(payload.studyReviews));
    }
    if (state.staticMode) {
      cacheRecords(ATTEMPT_CACHE_KEY, payload.attempts, "client_attempt_id");
      cacheRecords(FLAG_CACHE_KEY, payload.flags, "client_flag_id");
      refreshLocalProgress();
      renderGlobalMetrics();
      button.textContent = "Imported";
      return;
    }
    const response = await fetch("/api/progress/import", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error((await response.json()).error || "Import failed");
    button.textContent = "Imported";
    await loadData();
  } catch {
    button.textContent = "Import failed";
  } finally {
    event.target.value = "";
    setTimeout(() => { button.textContent = "Import"; }, 1800);
  }
}

function downloadStaticProgress(event) {
  if (!state.staticMode) return;
  event.preventDefault();
  const payload = {
    format: "iac-reader-progress-v1",
    exported_at: new Date().toISOString(),
    attempts: readCache(ATTEMPT_CACHE_KEY),
    flags: readCache(FLAG_CACHE_KEY),
    studyReviews: studyReviews(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `iac-reader-progress-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadData() {
  try {
    state.staticMode = location.hostname.endsWith("github.io") || new URLSearchParams(location.search).has("static");
    if (!state.staticMode) {
      await flushPending();
      await flushLocalCache(ATTEMPT_CACHE_KEY, "/api/attempt");
      await flushLocalCache(FLAG_CACHE_KEY, "/api/flag");
    }
    const [response, lessonResponse] = await Promise.all([
      fetch(state.staticMode ? "static/bootstrap.json" : "/api/bootstrap", { cache: "no-store" }),
      fetch("study/lessons.json", { cache: "no-store" }),
    ]);
    if (!response.ok) throw new Error("Could not load the studied clue bank");
    if (!lessonResponse.ok) throw new Error("Could not load the study lessons");
    state.data = await response.json();
    state.data.lessons = (await lessonResponse.json()).lessons;
    if (state.staticMode) refreshLocalProgress();
    $("#loadingView").hidden = true;
    renderDomains();
    renderGlobalMetrics();
    const everyAnswerline = $("#questionCount option[value='all']");
    everyAnswerline.textContent = `Every answerline (${state.data.topics.length})`;
    $$("#rotationControl button").forEach((button) => button.classList.toggle("active", button.dataset.rotation === state.rotation));
    $("#speedControl").value = state.speed;
    $("#speedValue").textContent = `${state.speed} WPM`;
    $("#leniencyControl").value = state.leniency;
    $("#leniencyValue").textContent = LENIENCY_LABELS[state.leniency];
    const initial = ["practice", "study", "notRanked", "ledger", "sessions"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "practice";
    setView(initial);
  } catch (error) {
    $("#loadingView").innerHTML = `<p><strong>Reader unavailable.</strong><br>${escapeHtml(error.message)}</p>`;
  }
}

function installEvents() {
  $$(".nav-button").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $("#studyTopicList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-study-id]");
    if (!button) return;
    state.studyId = button.dataset.studyId;
    renderStudy();
    window.scrollTo(0, 0);
  });
  $("#rotationControl").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-rotation]");
    if (!button) return;
    state.rotation = button.dataset.rotation;
    localStorage.setItem("iac-reader-rotation", state.rotation);
    $$("#rotationControl button").forEach((item) => item.classList.toggle("active", item === button));
  });
  $("#toggleDomains").addEventListener("click", () => {
    const boxes = $$("#domainFilters input");
    const select = boxes.some((box) => !box.checked);
    boxes.forEach((box) => { box.checked = select; });
    $("#toggleDomains").textContent = select ? "Clear all" : "Select all";
  });
  $("#speedControl").addEventListener("input", (event) => {
    state.speed = Number(event.target.value);
    localStorage.setItem("iac-reader-speed", state.speed);
    $("#speedValue").textContent = `${state.speed} WPM`;
  });
  $("#leniencyControl").addEventListener("input", (event) => {
    state.leniency = Number(event.target.value);
    localStorage.setItem("iac-reader-leniency", state.leniency);
    $("#leniencyValue").textContent = LENIENCY_LABELS[state.leniency];
  });
  $("#startSession").addEventListener("click", startSession);
  $("#endSession").addEventListener("click", endSession);
  $("#pauseButton").addEventListener("click", togglePause);
  $("#buzzButton").addEventListener("click", buzz);
  $("#speedDown").addEventListener("click", () => {
    state.speed = Math.max(100, state.speed - 10); localStorage.setItem("iac-reader-speed", state.speed);
  });
  $("#speedUp").addEventListener("click", () => {
    state.speed = Math.min(320, state.speed + 10); localStorage.setItem("iac-reader-speed", state.speed);
  });
  $("#answerForm").addEventListener("submit", submitAnswer);
  $("#cancelBuzz").addEventListener("click", cancelBuzz);
  $("#answerDialog").addEventListener("cancel", (event) => { event.preventDefault(); cancelBuzz(); });
  $("#flagQuestion").addEventListener("click", () => openFlagDialog("practice"));
  $("#flagDuelQuestion").addEventListener("click", () => openFlagDialog("duel"));
  $("#flagForm").addEventListener("submit", saveFlag);
  $("#cancelFlag").addEventListener("click", cancelFlag);
  $("#flagDialog").addEventListener("cancel", (event) => { event.preventDefault(); cancelFlag(); });
  $("#importProgress").addEventListener("click", () => $("#progressFile").click());
  $("#progressFile").addEventListener("change", importProgress);
  $("#backupProgress").addEventListener("click", downloadStaticProgress);
  $("#startDuel").addEventListener("click", startDuel);
  $("#duelPause").addEventListener("click", toggleDuelPause);
  $("#duelBuzz").addEventListener("click", duelBuzz);
  $("#endDuel").addEventListener("click", endDuel);
  $("#duelAnswerForm").addEventListener("submit", submitDuelAnswer);
  $("#cancelDuelBuzz").addEventListener("click", cancelDuelBuzz);
  $("#duelAnswerDialog").addEventListener("cancel", (event) => { event.preventDefault(); cancelDuelBuzz(); });
  $("#ledgerSearch").addEventListener("input", () => renderLedger(true));
  $("#ledgerTier").addEventListener("change", () => renderLedger(true));
  $("#ledgerStatus").addEventListener("change", () => renderLedger(true));
  $("#loadMoreClues").addEventListener("click", () => { state.ledgerLimit += 100; renderLedger(false); });
  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space") return;
    if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(document.activeElement?.tagName)) return;
    if (state.view === "practice" && state.current && !state.current.answered) {
      event.preventDefault();
      buzz();
    } else if (state.view === "notRanked" && state.duel?.current && !state.duel.current.answered) {
      event.preventDefault();
      duelBuzz();
    }
  });
}

installEvents();
loadData();

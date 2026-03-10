/* ══════════════════════════════════════════════════
   GMCT CHURCH APP – Public Display (app.js)
   ══════════════════════════════════════════════════ */

const FIXED_HEADER_TITLE = 'GMCT-Ghana Methodist Church of Toronto';
const FIXED_HEADER_SUBTITLE = 'Upcoming Programs and Social Activities';
const DEFAULT_SWITCH_SECONDS = 10;
const DEFAULT_DAILY_RELOAD_TIME = '04:00';
const DISPLAY_REFRESH_MS = 2 * 60 * 1000;
const PROGRAMS_PER_PAGE = 4;
const SOCIAL_PER_PAGE = 2;

const _rollTimers = {
  programs: null,
  social: null
};

let _displayRefreshTimer = null;
let _dailyReloadTimer = null;
let _storageSyncTimer = null;
let _errorRecoveryArmed = false;
let _reliabilityHandlersBound = false;

const WEEKDAY_INDEX = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
};

/* ── Clock ──────────────────────────────────────── */
function updateClock () {
  const now  = new Date();
  const timeEl = document.getElementById('live-time');
  const dateEl = document.getElementById('live-date');

  if (timeEl) {
    let h = now.getHours();
    const m    = now.getMinutes().toString().padStart(2, '0');
    const s    = now.getSeconds().toString().padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    timeEl.textContent = `${h}:${m}:${s} ${ampm}`;
  }
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }
}

/* ── Apply settings to display ───────────────────── */
function applySettings () {
  document.title = FIXED_HEADER_TITLE + ' – Announcements';
  const n = document.getElementById('disp-church-name');
  const t = document.getElementById('disp-church-tagline');
  if (n) n.textContent = FIXED_HEADER_TITLE;
  if (t) t.textContent = FIXED_HEADER_SUBTITLE;
}

function toIsoDate (dateObj) {
  return dateObj.toISOString().split('T')[0];
}

function getStartOfDay (dateObj = new Date()) {
  const d = new Date(dateObj);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getNextRecurringDate (dayName, startTime) {
  const dayIdx = WEEKDAY_INDEX[dayName];
  if (dayIdx === undefined) return null;

  const now = new Date();
  const today = getStartOfDay(now);
  let diff = (dayIdx - today.getDay() + 7) % 7;

  if (diff === 0 && startTime) {
    const [h, m] = startTime.split(':').map(Number);
    const startToday = new Date(today);
    startToday.setHours(h || 0, m || 0, 0, 0);
    if (startToday < now) diff = 7;
  }

  const next = new Date(today);
  next.setDate(next.getDate() + diff);
  return toIsoDate(next);
}

function getNextBiweeklyDate (dayName, refDate, startTime) {
  if (!refDate) return null;
  const now = new Date();
  const today = getStartOfDay(now);
  let candidate = new Date(refDate + 'T00:00:00');
  // Step forward 14 days at a time until we reach or pass today
  while (candidate < today) {
    candidate.setDate(candidate.getDate() + 14);
  }
  // If it lands today but the time has already passed, skip one cycle
  if (toIsoDate(candidate) === toIsoDate(today) && startTime) {
    const [h, m] = startTime.split(':').map(Number);
    const startToday = new Date(today);
    startToday.setHours(h || 0, m || 0, 0, 0);
    if (startToday < now) candidate.setDate(candidate.getDate() + 14);
  }
  return toIsoDate(candidate);
}

function getNextMonthlyDate (dayOfMonth, startTime) {
  if (!dayOfMonth) return null;
  const now = new Date();
  const today = getStartOfDay(now);
  const yr = today.getFullYear();
  const mo = today.getMonth();
  let candidate = new Date(yr, mo, dayOfMonth);
  // If that date is already in the past, roll to next month
  if (candidate < today) candidate = new Date(yr, mo + 1, dayOfMonth);
  // If it lands today but the time has already passed, roll to next month
  if (toIsoDate(candidate) === toIsoDate(today) && startTime) {
    const [h, m] = startTime.split(':').map(Number);
    const startToday = new Date(today);
    startToday.setHours(h || 0, m || 0, 0, 0);
    if (startToday < now) candidate = new Date(yr, mo + 1, dayOfMonth);
  }
  return toIsoDate(candidate);
}

/* ── Upcoming programs ───────────────────────────── */
function getUpcomingPrograms () {
  const today = getStartOfDay();

  return DB.getPrograms()
    .map(p => {
      const rType = p.recurrenceType || (p.recurring ? 'weekly' : 'onetime');
      let nextDate;
      if      (rType === 'weekly')   nextDate = getNextRecurringDate(p.dayOfWeek, p.startTime);
      else if (rType === 'biweekly') nextDate = getNextBiweeklyDate(p.dayOfWeek, p.refDate, p.startTime);
      else if (rType === 'monthly')  nextDate = getNextMonthlyDate(p.dayOfMonth, p.startTime);
      else                           nextDate = p.date;
      if (!nextDate) return null;
      if (p.repeatUntil && nextDate > p.repeatUntil) return null;

      const nextDay = new Date(nextDate + 'T00:00:00');
      if (nextDay < today) return null;

      return { ...p, nextDate };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.nextDate !== b.nextDate) return a.nextDate.localeCompare(b.nextDate);
      return (a.startTime || '').localeCompare(b.startTime || '');
    });
}

function renderPrograms () {
  const list = getUpcomingPrograms();
  renderRollingCards({
    containerId: 'programs-list',
    items: list,
    pageSize: PROGRAMS_PER_PAGE,
    emptyHtml: '<div class="no-content">No upcoming programs yet</div>',
    timerKey: 'programs',
    renderCard: p => {
      const full = fmt12(p.startTime) || '--:--';
      const timeParts = full.split(' ');
      const tPart = timeParts[0] || '--:--';
      const ap = timeParts[1] || '';
      const dateLabel = fmtDate(p.nextDate);
      const days = daysUntil(p.nextDate);
      let countdown = '';
      if (days === 0) countdown = 'Today';
      else if (days === 1) countdown = 'Tomorrow';
      else countdown = `In ${days} days`;

      return `
        <div class="prog-card">
          <div class="p-title">${esc(p.title)}</div>
          <div class="prog-time-badge">
            <span class="lbl">START TIME</span>
            <span class="t">${esc(tPart)}</span>
            <span class="ap">${esc(ap)}</span>
          </div>
          <div class="prog-info">
            <div class="p-date">${esc(dateLabel)} (${esc(countdown)})</div>
            <div class="p-venue">${esc(p.venue)}</div>
            ${p.endTime ? `<div class="p-time-range">${esc(fmt12(p.startTime))} - ${esc(fmt12(p.endTime))}</div>` : ''}
            <span class="p-cat">${esc(p.category)}</span>
          </div>
        </div>`;
    }
  });
}

/* ── Social activities ───────────────────────────── */
function getUpcomingSocialActivities () {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return DB.getEvents()
    .filter(e => {
      const end = new Date((e.endDate || e.startDate) + 'T23:59:59');
      return end >= today;
    })
    .sort((a, b) => {
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      return a.startDate.localeCompare(b.startDate);
    });
}

function renderSocialActivities () {
  const list = getUpcomingSocialActivities();
  renderRollingCards({
    containerId: 'social-list',
    items: list,
    pageSize: SOCIAL_PER_PAGE,
    emptyHtml: '<div class="no-content">No upcoming social activities</div>',
    timerKey: 'social',
    renderCard: e => {
      const days = daysUntil(e.startDate);
      let countdownLabel = '';
      if      (days === 0) countdownLabel = 'Today!';
      else if (days === 1) countdownLabel = 'Tomorrow';
      else if (days >  1) countdownLabel = `In ${days} days`;

      const dateRange = (e.endDate && e.endDate !== e.startDate)
        ? `${fmtDate(e.startDate)} - ${fmtDate(e.endDate)}`
        : fmtDate(e.startDate);

      return `
        <div class="evt-card ${e.featured ? 'featured' : ''}">
          ${e.featured ? '<div class="feat-badge">Featured</div>' : ''}
          ${countdownLabel ? `<div class="countdown">${esc(countdownLabel)}</div>` : ''}
          <div class="e-title">${esc(e.title)}</div>
          <div class="e-date">${esc(dateRange)}</div>
          ${e.time ? `<div class="e-time">${esc(fmt12(e.time))}</div>` : ''}
          <div class="e-venue">${esc(e.venue)}</div>
          ${e.description ? `<div class="e-desc">${esc(e.description)}</div>` : ''}
        </div>`;
    }
  });
}

function clearRollingTimer (timerKey) {
  if (_rollTimers[timerKey]) {
    clearInterval(_rollTimers[timerKey]);
    _rollTimers[timerKey] = null;
  }
}

function clampInt (value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function getSwitchIntervalMs (timerKey) {
  const s = DB.getSettings();
  const legacySwitch = clampInt(s.cardSwitchSeconds, 5, 60, DEFAULT_SWITCH_SECONDS);
  const sec = timerKey === 'social'
    ? clampInt(s.socialSwitchSeconds, 5, 60, legacySwitch)
    : clampInt(s.programSwitchSeconds, 5, 60, legacySwitch);
  return sec * 1000;
}

const VALID_TRANSITIONS = ['fade', 'fly', 'zoom', 'flip', 'wipe', 'morph', 'glitch'];

function getTransitionStyle (timerKey) {
  const s = DB.getSettings();
  const raw = timerKey === 'social' ? s.socialTransition : s.programTransition;
  return VALID_TRANSITIONS.includes(raw) ? raw : 'fade';
}

function applyAutoFitForCards (containerEl) {
  if (!containerEl) return;
  const cards = containerEl.querySelectorAll('.prog-card, .evt-card');
  cards.forEach(card => {
    card.classList.remove('compact', 'dense');
    if (card.scrollHeight > card.clientHeight + 2) {
      card.classList.add('compact');
      if (card.scrollHeight > card.clientHeight + 2) {
        card.classList.add('dense');
      }
    }
  });
}

function parseDailyReloadTimeParts () {
  const raw = DB.getSettings().dailyReloadTime || DEFAULT_DAILY_RELOAD_TIME;
  const m = String(raw).match(/^(\d{2}):(\d{2})$/);
  if (!m) return [4, 0];

  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return [4, 0];
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return [4, 0];
  return [hh, mm];
}

function scheduleDailyReload () {
  if (_dailyReloadTimer) clearTimeout(_dailyReloadTimer);

  const [hh, mm] = parseDailyReloadTimeParts();
  const now = new Date();
  const next = new Date(now);
  next.setHours(hh, mm, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  _dailyReloadTimer = setTimeout(() => {
    location.reload();
  }, next.getTime() - now.getTime());
}

function shouldAutoReloadOnError () {
  return DB.getSettings().autoReloadOnError !== false;
}

function triggerErrorRecovery () {
  if (_errorRecoveryArmed || !shouldAutoReloadOnError()) return;
  const last = parseInt(sessionStorage.getItem('gmct_last_error_reload') || '0', 10);
  if (Date.now() - last < 60000) return;

  _errorRecoveryArmed = true;
  sessionStorage.setItem('gmct_last_error_reload', String(Date.now()));
  setTimeout(() => location.reload(), 3000);
}

function refreshDisplay () {
  applySettings();
  renderPrograms();
  renderSocialActivities();
  renderTicker();
  scheduleDailyReload();
}

function queueDisplayRefresh () {
  if (_storageSyncTimer) clearTimeout(_storageSyncTimer);
  _storageSyncTimer = setTimeout(refreshDisplay, 120);
}

function renderRollingCards ({ containerId, items, pageSize, emptyHtml, timerKey, renderCard }) {
  const el = document.getElementById(containerId);
  if (!el) return;

  clearRollingTimer(timerKey);

  if (!items.length) {
    el.innerHTML = emptyHtml;
    return;
  }

  const pages = [];
  for (let i = 0; i < items.length; i += pageSize) {
    pages.push(items.slice(i, i + pageSize));
  }

  let pageIndex = 0;
  let firstDraw = true;

  const swap = () => {
    el.innerHTML = pages[pageIndex].map(renderCard).join('');
    applyAutoFitForCards(el);
    requestAnimationFrame(() => {
      applyAutoFitForCards(el);
      el.classList.add('roll-enter');
      setTimeout(() => el.classList.remove('roll-enter'), 450);
    });
    pageIndex = (pageIndex + 1) % pages.length;
  };

  const drawPage = () => {
    const txStyle = getTransitionStyle(timerKey);
    el.setAttribute('data-transition', txStyle);
    el.classList.remove('roll-enter');

    if (firstDraw) {
      firstDraw = false;
      swap();
      return;
    }

    el.classList.add('roll-exit');
    setTimeout(() => {
      el.classList.remove('roll-exit');
      swap();
    }, 320);
  };

  drawPage();

  if (pages.length > 1) {
    _rollTimers[timerKey] = setInterval(drawPage, getSwitchIntervalMs(timerKey));
  }
}

/* ── Ticker ──────────────────────────────────────── */
function renderTicker () {
  const el = document.getElementById('ticker-text');
  if (!el) return;

  const active = DB.getAnnouncements().filter(a => a.active);
  const s = DB.getSettings();

  el.textContent = active.length
    ? active.map(a => a.text).join('  \u2022  ') + '  \u2022  '
    : `Welcome to ${FIXED_HEADER_TITLE}  \u2022  God bless you  \u2022  `;

  // Calculate duration based on speed setting
  const speed    = Math.max(10, s.tickerSpeed || 40);
  const textPx   = el.textContent.length * 9;          // ~9px/char estimate
  const totalPx  = window.innerWidth + textPx;
  const duration = Math.max(10, Math.round(totalPx / speed));

  el.style.animationDuration = duration + 's';
}

/* ── Init ────────────────────────────────────────── */
function bindReliabilityHandlers () {
  if (_reliabilityHandlersBound) return;
  _reliabilityHandlersBound = true;

  window.addEventListener('storage', e => {
    if (!e || !e.key) return;
    if (
      e.key === KEYS.PROGRAMS ||
      e.key === KEYS.EVENTS ||
      e.key === KEYS.ANNOUNCEMENTS ||
      e.key === KEYS.SETTINGS
    ) {
      queueDisplayRefresh();
    }
  });

  window.addEventListener('error', triggerErrorRecovery);
  window.addEventListener('unhandledrejection', triggerErrorRecovery);
}

function init () {
  refreshDisplay();
  updateClock();
  setInterval(updateClock, 1000);
  bindReliabilityHandlers();

  // Periodic refresh remains as safety net even with storage sync.
  if (_displayRefreshTimer) clearInterval(_displayRefreshTimer);
  _displayRefreshTimer = setInterval(refreshDisplay, DISPLAY_REFRESH_MS);
}

document.addEventListener('DOMContentLoaded', init);

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
  social: null,
  programs_page: 0,
  social_page: 0
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

  // Apply church logo
  const cross = document.getElementById('hd-cross');
  const logo  = document.getElementById('hd-logo');
  if (cross && logo) {
    const logoData = DB.getSettings().churchLogo;
    if (logoData) {
      logo.src = logoData;
      logo.classList.remove('hidden');
      cross.classList.add('hidden');
    } else {
      logo.classList.add('hidden');
      cross.classList.remove('hidden');
    }
  }
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

function getNextMonthlyNthWeekdayDate (dayName, nthOccurrence, startTime) {
  if (!dayName || !nthOccurrence) return null;
  const now = new Date();
  const today = getStartOfDay(now);
  const dayIdx = WEEKDAY_INDEX[dayName];
  if (!Number.isFinite(dayIdx)) return null;
  
  const nth = parseInt(nthOccurrence, 10);
  if (!Number.isFinite(nth) || nth < 1 || nth > 5) return null;

  // Start with current month
  let yr = today.getFullYear();
  let mo = today.getMonth();
  let candidate = findNthWeekday(yr, mo, dayIdx, nth);
  
  // If that date is already in the past, move to next month
  if (candidate < today) {
    mo++;
    if (mo > 11) { mo = 0; yr++; }
    candidate = findNthWeekday(yr, mo, dayIdx, nth);
  }
  
  // If it lands today but the time has already passed, move to next month
  if (toIsoDate(candidate) === toIsoDate(today) && startTime) {
    const [h, m] = startTime.split(':').map(Number);
    const startToday = new Date(today);
    startToday.setHours(h || 0, m || 0, 0, 0);
    if (startToday < now) {
      mo++;
      if (mo > 11) { mo = 0; yr++; }
      candidate = findNthWeekday(yr, mo, dayIdx, nth);
    }
  }
  
  return toIsoDate(candidate);
}

function findNthWeekday (year, month, dayIdx, nth) {
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const candidate = new Date(year, month, d);
    if (candidate.getMonth() !== month) break;
    if (candidate.getDay() === dayIdx) {
      count++;
      if (count === nth) return candidate;
    }
  }
  return null;
}

/* ── Upcoming programs ───────────────────────────── */
function getUpcomingPrograms () {
  const today = getStartOfDay();

  return DB.getPrograms()
    .map(p => {
      const rType = p.recurrenceType || (p.recurring ? 'weekly' : 'onetime');
      let nextDate;
      if      (rType === 'weekly')               nextDate = getNextRecurringDate(p.dayOfWeek, p.startTime);
      else if (rType === 'biweekly')             nextDate = getNextBiweeklyDate(p.dayOfWeek, p.refDate, p.startTime);
      else if (rType === 'monthly')              nextDate = getNextMonthlyDate(p.dayOfMonth, p.startTime);
      else if (rType === 'monthly-nth-weekday')  nextDate = getNextMonthlyNthWeekdayDate(p.dayOfWeek, p.nthWeekdayOccurrence, p.startTime);
      else                                       nextDate = p.date;
      if (!nextDate) return null;
      if (p.repeatUntil && nextDate > p.repeatUntil) return null;

      const nextDay = new Date(nextDate + 'T00:00:00');
      if (nextDay < today) return null;

      const todayIso = toIsoDate(today);
      if (p.showFrom && todayIso < p.showFrom) return null;

      return { ...p, nextDate };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.nextDate !== b.nextDate) return a.nextDate.localeCompare(b.nextDate);
      return (a.startTime || '').localeCompare(b.startTime || '');
    });
}

function getActiveFlyersForSide (side) {
  const today = getStartOfDay();

  return DB.getFlyers()
    .filter(f => (f.side || 'programs') === side)
    .filter(f => f.active !== false)
    .filter(f => {
      if ((!f.imageData && !f.imageUrl) || !f.startDate) return false;
      const start = new Date(f.startDate + 'T00:00:00');
      if (Number.isNaN(start.getTime())) return false;
      if (today < start) return false;
      // Only enforce an expiry when a *distinct* stop date was explicitly set
      // (endDate === startDate was the old fallback, not a real expiry)
      if (f.endDate && f.endDate !== f.startDate) {
        const end = new Date(f.endDate + 'T23:59:59');
        if (!Number.isNaN(end.getTime()) && today > end) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const startA = a.startDate || '';
      const startB = b.startDate || '';
      if (startA !== startB) return startA.localeCompare(startB);
      return Number(a.createdAtMs || 0) - Number(b.createdAtMs || 0);
    });
}

function getFlyerDateLabel (flyer) {
  const start = flyer.startDate;
  const end = flyer.endDate || flyer.startDate;
  if (!start) return '';
  if (end && end !== start) return `${fmtDate(start)} - ${fmtDate(end)}`;
  return fmtDate(start);
}

function renderFlyerPage (flyer, side) {
  const title = flyer.title || (side === 'social' ? 'Social Activity Flyer' : 'Upcoming Program Flyer');
  const start = flyer.startDate ? fmtDate(flyer.startDate) : '';
  const end   = (flyer.endDate && flyer.endDate !== flyer.startDate) ? fmtDate(flyer.endDate) : '';
  const imageSrc = flyer.imageUrl || flyer.imageData || '';
  const showDates = flyer.showDates !== false;

  const datesHtml = showDates ? `
          <span class="panel-flyer-chip-spacer"></span>
          <span class="panel-flyer-chip date from-chip">${start ? 'From: ' + esc(start) : ''}</span>
          <span class="panel-flyer-chip-spacer"></span>
          <span class="panel-flyer-chip date to-chip">${end ? 'To: ' + esc(end) : ''}</span>` : '';

  return {
    html: `
      <div class="panel-flyer-slide">
        <img src="${esc(imageSrc)}" alt="${esc(title)}" loading="lazy" />
        ${showDates ? `<div class="panel-flyer-meta">${datesHtml}</div>` : ''}
      </div>`,
    autoFit: false,
    flyer: true
  };
}

function renderPrograms () {
  const list = getUpcomingPrograms();
  const flyers = getActiveFlyersForSide('programs');
  renderRollingCards({
    containerId: 'programs-list',
    items: list,
    pageSize: PROGRAMS_PER_PAGE,
    emptyHtml: '<div class="no-content">No upcoming programs yet</div>',
    timerKey: 'programs',
    introPages: flyers.map(f => renderFlyerPage(f, 'programs')),
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
  const todayIso = toIsoDate(today);
  return DB.getEvents()
    .filter(e => {
      const end = new Date((e.endDate || e.startDate) + 'T23:59:59');
      if (end < today) return false;
      if (e.showFrom && todayIso < e.showFrom) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
      if ((a.time || '') !== (b.time || '')) return (a.time || '').localeCompare(b.time || '');
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      return (a.title || '').localeCompare(b.title || '');
    });
}

function renderSocialActivities () {
  const list = getUpcomingSocialActivities();
  const flyers = getActiveFlyersForSide('social');
  renderRollingCards({
    containerId: 'social-list',
    items: list,
    pageSize: SOCIAL_PER_PAGE,
    emptyHtml: '<div class="no-content">No upcoming social activities</div>',
    timerKey: 'social',
    introPages: flyers.map(f => renderFlyerPage(f, 'social')),
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
  // page index preserved intentionally so rotation continues from same spot after refresh
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

function renderRollingCards ({ containerId, items, pageSize, emptyHtml, timerKey, renderCard, introPages = [] }) {
  const el = document.getElementById(containerId);
  if (!el) return;

  clearRollingTimer(timerKey);

  const pages = [];
  if (Array.isArray(introPages)) {
    introPages.forEach(page => {
      if (page && typeof page.html === 'string') pages.push(page);
    });
  }

  if (items.length) {
    for (let i = 0; i < items.length; i += pageSize) {
      const chunk = items.slice(i, i + pageSize);
      pages.push({
        html: chunk.map(renderCard).join(''),
        autoFit: true,
        flyer: false
      });
    }
  }

  if (!pages.length) {
    el.classList.remove('panel-showing-flyer');
    el.innerHTML = emptyHtml;
    return;
  }

  // Resume from saved position so refreshDisplay never resets mid-cycle
  const savedIndex = _rollTimers[timerKey + '_page'] || 0;
  let pageIndex = savedIndex < pages.length ? savedIndex : 0;
  let firstDraw = true;

  const swap = () => {
    const page = pages[pageIndex];
    el.innerHTML = page.html;
    el.classList.toggle('panel-showing-flyer', !!page.flyer);

    if (page.autoFit !== false) applyAutoFitForCards(el);

    requestAnimationFrame(() => {
      if (page.autoFit !== false) applyAutoFitForCards(el);
      el.classList.add('roll-enter');
      setTimeout(() => el.classList.remove('roll-enter'), 450);
    });
    pageIndex = (pageIndex + 1) % pages.length;
    _rollTimers[timerKey + '_page'] = pageIndex; // save so refresh can resume here
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

  if (active.length) {
    const msgs = active.map(a => `<span class="ticker-msg">${a.text}</span>`).join('<span class="ticker-sep">◆</span>');
    el.innerHTML = msgs + '<span class="ticker-sep">◆</span>';
  } else {
    el.innerHTML = `Welcome to ${FIXED_HEADER_TITLE}<span class="ticker-sep">◆</span>God bless you<span class="ticker-sep">◆</span>`;
  }

  // Calculate duration based on speed setting
  const speed    = Math.max(10, s.tickerSpeed || 40);
  const textPx   = (el.textContent || '').length * 9;  // ~9px/char estimate
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

  window.addEventListener('gmct-data-updated', () => {
    queueDisplayRefresh();
  });

  window.addEventListener('error', triggerErrorRecovery);
  window.addEventListener('unhandledrejection', triggerErrorRecovery);
}

async function init () {
  if (window.CloudSync && typeof window.CloudSync.bootstrap === 'function') {
    await window.CloudSync.bootstrap();
  }

  refreshDisplay();
  updateClock();
  setInterval(updateClock, 1000);
  bindReliabilityHandlers();

  // Periodic refresh remains as safety net even with storage sync.
  if (_displayRefreshTimer) clearInterval(_displayRefreshTimer);
  _displayRefreshTimer = setInterval(refreshDisplay, DISPLAY_REFRESH_MS);
}

document.addEventListener('DOMContentLoaded', init);

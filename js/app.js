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
let _weeklyVideoCurrentUrl = '';
let _weeklyVideoVisible = false;
let _themeYearCurrentSrc = '';
let _themeYearVisible = false;
let _themeYearRotationKey = '';
let _themeYearRotationStartMs = 0;

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

  updateWeeklySundayVideoOverlay();
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

function parseClockToMinutes (clockValue) {
  if (typeof clockValue !== 'string' || !clockValue.includes(':')) return null;
  const [hh, mm] = clockValue.split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function getThemeYearImageSource (settings) {
  if (!settings) return '';
  const url = String(settings.themeOfYearImageUrl || '').trim();
  if (url) return url;
  return String(settings.themeOfYearImageData || '').trim();
}

function shouldShowThemeYearOverlay (settings) {
  if (!settings || settings.themeOfYearEnabled !== true) return false;
  return !!getThemeYearImageSource(settings);
}

function getThemeYearRotationDurations (settings) {
  const baseSwitch = clampInt(settings && settings.cardSwitchSeconds, 5, 60, DEFAULT_SWITCH_SECONDS);
  const themeShowSeconds = clampInt(settings && settings.themeOfYearShowSeconds, 5, 60, 12);
  const gridShowSeconds = clampInt(settings && settings.themeOfYearGridSeconds, 5, 180, 30);
  return {
    themeShowMs: themeShowSeconds * 1000,
    gridShowMs: gridShowSeconds * 1000
  };
}

function shouldDisplayThemeYearNow (settings, now = new Date()) {
  if (!shouldShowThemeYearOverlay(settings)) {
    _themeYearRotationKey = '';
    _themeYearRotationStartMs = 0;
    return false;
  }

  const src = getThemeYearImageSource(settings);
  const key = `${settings.themeOfYearEnabled === true ? '1' : '0'}|${src}`;
  const nowMs = now.getTime();
  if (_themeYearRotationKey !== key) {
    _themeYearRotationKey = key;
    _themeYearRotationStartMs = nowMs;
  }

  const { themeShowMs, gridShowMs } = getThemeYearRotationDurations(settings);
  const cycleMs = themeShowMs + gridShowMs;
  if (cycleMs <= 0) return true;

  const elapsedMs = (nowMs - _themeYearRotationStartMs) % cycleMs;
  return elapsedMs < themeShowMs;
}

function hideThemeYearOverlay (resetSource = true) {
  const overlay = document.getElementById('theme-year-overlay');
  const image = document.getElementById('theme-year-image');
  if (!overlay || !image) return;

  if (!_themeYearVisible && !_themeYearCurrentSrc) return;

  overlay.classList.add('hidden');
  _themeYearVisible = false;

  if (resetSource) {
    _themeYearCurrentSrc = '';
    image.removeAttribute('src');
  }
}

function showThemeYearOverlay (settings) {
  const overlay = document.getElementById('theme-year-overlay');
  const image = document.getElementById('theme-year-image');
  if (!overlay || !image) return;

  const src = getThemeYearImageSource(settings);
  if (!src) {
    hideThemeYearOverlay();
    return;
  }

  if (_themeYearCurrentSrc !== src) {
    _themeYearCurrentSrc = src;
    image.src = src;
  }

  overlay.classList.remove('hidden');
  _themeYearVisible = true;
}

function shouldPlayWeeklySundayVideo (settings, now = new Date()) {
  if (!settings || settings.weeklySundayVideoEnabled !== true) return false;

  const url = String(settings.weeklySundayVideoUrl || '').trim();
  if (!url) return false;

  const removeAfterRaw = String(settings.weeklySundayVideoRemoveAfter || '').trim();
  if (removeAfterRaw) {
    const removeAfter = new Date(removeAfterRaw);
    if (!Number.isNaN(removeAfter.getTime()) && now.getTime() >= removeAfter.getTime()) {
      return false;
    }
  }

  if (now.getDay() !== 0) return false; // Sunday only

  const start = parseClockToMinutes(settings.weeklySundayVideoStartTime || '');
  const end = parseClockToMinutes(settings.weeklySundayVideoEndTime || '');
  if (start === null || end === null || end <= start) return false;

  const current = now.getHours() * 60 + now.getMinutes();
  return current >= start && current < end;
}

function hideWeeklySundayVideoOverlay () {
  const overlay = document.getElementById('weekly-video-overlay');
  const video = document.getElementById('weekly-video-player');
  const titleEl = document.getElementById('weekly-video-title');
  if (!overlay || !video) return;

  if (!_weeklyVideoVisible && !_weeklyVideoCurrentUrl) return;

  overlay.classList.add('hidden');
  _weeklyVideoVisible = false;

  video.pause();
  if (_weeklyVideoCurrentUrl) {
    video.removeAttribute('src');
    video.load();
    _weeklyVideoCurrentUrl = '';
  }

  if (titleEl) {
    titleEl.textContent = '';
    titleEl.classList.add('hidden');
  }
}

function showWeeklySundayVideoOverlay (settings) {
  const overlay = document.getElementById('weekly-video-overlay');
  const video = document.getElementById('weekly-video-player');
  const titleEl = document.getElementById('weekly-video-title');
  if (!overlay || !video) return;

  const videoUrl = String(settings.weeklySundayVideoUrl || '').trim();
  if (!videoUrl) {
    hideWeeklySundayVideoOverlay();
    return;
  }

  if (_weeklyVideoCurrentUrl !== videoUrl) {
    _weeklyVideoCurrentUrl = videoUrl;
    video.src = videoUrl;
    video.load();
  }

  const titleText = String(settings.weeklySundayVideoTitle || '').trim();
  if (titleEl) {
    if (titleText) {
      titleEl.textContent = titleText;
      titleEl.classList.remove('hidden');
    } else {
      titleEl.textContent = '';
      titleEl.classList.add('hidden');
    }
  }

  overlay.classList.remove('hidden');
  _weeklyVideoVisible = true;

  if (video.paused) {
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        // Browsers may block autoplay with sound until user interaction.
      });
    }
  }
}

function updateWeeklySundayVideoOverlay () {
  const settings = DB.getSettings();
  const now = new Date();

  if (shouldPlayWeeklySundayVideo(settings, now)) {
    hideThemeYearOverlay(false);
    showWeeklySundayVideoOverlay(settings);
    return true;
  }

  hideWeeklySundayVideoOverlay();

  if (shouldDisplayThemeYearNow(settings, now)) {
    showThemeYearOverlay(settings);
    return true;
  }

  if (shouldShowThemeYearOverlay(settings)) {
    hideThemeYearOverlay(false);
    return false;
  }

  hideThemeYearOverlay();
  return false;
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

/* ── Hall of Fame / Leaders ──────────────────────── */
function shouldDisplayLeaders () {
  const settings = DB.getSettings();
  if (!settings.hallOfFameEnabled) return false;
  const leaders = DB.getLeaders();
  if (!leaders.length) return false;
  const minSocial = parseInt(settings.minSocialItemsShowLeaders, 10) || 2;
  const socialCount = getUpcomingSocialActivities().length;
  // Replace social panel with leaders only when social activities are below threshold
  return socialCount < minSocial;
}

function parseLeaderYear (value) {
  const y = parseInt(value, 10);
  return Number.isFinite(y) ? y : null;
}

function getLeaderSortAnchorYear (leader) {
  if (leader.status === 'current') return new Date().getFullYear() + 1;
  return parseLeaderYear(leader.toYear) || parseLeaderYear(leader.fromYear) || 0;
}

function formatLeaderServiceYears (leader) {
  const fromYear = parseLeaderYear(leader.fromYear);
  const toYear = parseLeaderYear(leader.toYear);
  if (leader.status === 'current') return fromYear ? `${fromYear} - Present` : 'Present';
  if (fromYear && toYear) return `${fromYear} - ${toYear}`;
  if (fromYear) return `${fromYear}`;
  if (toYear) return `${toYear}`;
  return 'Service years unavailable';
}

function leaderNeedsDisplayOrder (title) {
  const lower = String(title || '').toLowerCase();
  return lower.includes('minister') || lower.includes('bishop');
}

function parseLeaderDisplayOrder (value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getLeaderDisplayOrderForSort (leader) {
  const n = parseLeaderDisplayOrder(leader.displayOrder);
  return n === null ? Number.MAX_SAFE_INTEGER : n;
}

function compareOrderedLeadersWithinRole (a, b, roleA, roleB) {
  const orderA = parseLeaderDisplayOrder(a.displayOrder);
  const orderB = parseLeaderDisplayOrder(b.displayOrder);
  const hasA = orderA !== null;
  const hasB = orderB !== null;

  if (!hasA && !hasB) return null;
  if (hasA && hasB && orderA !== orderB) return orderA - orderB;
  if (hasA && !hasB) return -1;
  if (!hasA && hasB) return 1;

  const nameDiff = (a.name || '').localeCompare(b.name || '');
  if (nameDiff !== 0) return nameDiff;
  return (a.id || '').localeCompare(b.id || '');
}

function getDisplayLeaders () {
  return DB.getLeaders()
    .filter(l => l && l.name && l.title)
    .sort((a, b) => {
      const roleA = getLeaderRoleKey(a.title);
      const roleB = getLeaderRoleKey(b.title);

      const orderedCompare = compareOrderedLeadersWithinRole(a, b, roleA, roleB);
      if (orderedCompare !== null) return orderedCompare;

      const anchorDiff = getLeaderSortAnchorYear(b) - getLeaderSortAnchorYear(a);
      if (anchorDiff !== 0) return anchorDiff;

      const fromDiff = (parseLeaderYear(b.fromYear) || 0) - (parseLeaderYear(a.fromYear) || 0);
      if (fromDiff !== 0) return fromDiff;

      return (a.name || '').localeCompare(b.name || '');
    });
}

function getLeaderRoleLabel (title) {
  const raw = String(title || '').trim();
  if (!raw) return 'Other Leaders';

  const lower = raw.toLowerCase();
  if (lower.includes('minister')) return 'Ministers';
  if (lower.includes('bishop')) return 'Bishops';
  if (lower.includes('steward')) return 'Stewards';
  if (lower.includes('pastor')) return 'Pastors';
  if (lower.includes('elder')) return 'Elders';
  return raw;
}

function getLeaderRoleKey (title) {
  return getLeaderRoleLabel(title).toLowerCase();
}

function getLeaderDisplayOrderGroupKey (title) {
  const lower = String(title || '').trim().toLowerCase();
  if (!lower) return null;
  if (lower.includes('minister')) return 'ministers';
  if (lower.includes('bishop')) return 'bishops';
  return null;
}

function getLeaderGroupPriority (roleKey) {
  if (roleKey === 'ministers') return 0;
  if (roleKey === 'bishops') return 1;
  return 10;
}

function buildGroupedLeaderPages (leaders, leadersPerPage) {
  const perPage = Math.max(1, leadersPerPage || 1);
  const orderedLeaders = leaders.filter(leader => parseLeaderDisplayOrder(leader.displayOrder) !== null);
  const unorderedLeaders = leaders.filter(leader => parseLeaderDisplayOrder(leader.displayOrder) === null);
  const pages = [];

  for (let index = 0; index < orderedLeaders.length; index += perPage) {
    const pageItems = orderedLeaders.slice(index, index + perPage).map(leader => ({
      leader,
      groupLabel: getLeaderRoleLabel(leader.title),
      orderInGroup: parseLeaderDisplayOrder(leader.displayOrder)
    }));

    if (pageItems.length < perPage && unorderedLeaders.length) {
      const filler = unorderedLeaders.shift();
      pageItems.push({
        leader: filler,
        groupLabel: getLeaderRoleLabel(filler.title),
        orderInGroup: null
      });
    }

    const labels = Array.from(new Set(pageItems.map(item => item.groupLabel)));
    pages.push({
      groupLabel: labels.length === 1 ? labels[0] : 'Hall of Fame Leaders',
      items: pageItems
    });
  }

  const groupsMap = new Map();

  unorderedLeaders.forEach(leader => {
    const key = getLeaderRoleKey(leader.title);
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        key,
        label: getLeaderRoleLabel(leader.title),
        leaders: []
      });
    }
    groupsMap.get(key).leaders.push(leader);
  });

  const groups = Array.from(groupsMap.values()).sort((a, b) => {
    const priorityDiff = getLeaderGroupPriority(a.key) - getLeaderGroupPriority(b.key);
    if (priorityDiff !== 0) return priorityDiff;

    const aAnchor = a.leaders[0] ? getLeaderSortAnchorYear(a.leaders[0]) : 0;
    const bAnchor = b.leaders[0] ? getLeaderSortAnchorYear(b.leaders[0]) : 0;
    if (aAnchor !== bAnchor) return bAnchor - aAnchor;
    return a.label.localeCompare(b.label);
  });

  const normalizedGroups = groups.map(group => ({
    ...group,
    items: group.leaders.map((leader, index) => ({
      leader,
      groupLabel: group.label,
      orderInGroup: index + 1
    }))
  }));

  let groupIndex = 0;
  let itemIndex = 0;
  while (groupIndex < normalizedGroups.length) {
    const pageItems = [];
    while (pageItems.length < perPage && groupIndex < normalizedGroups.length) {
      const currentGroup = normalizedGroups[groupIndex];
      if (itemIndex < currentGroup.items.length) {
        pageItems.push(currentGroup.items[itemIndex]);
        itemIndex++;
      }
      if (itemIndex >= currentGroup.items.length) {
        groupIndex++;
        itemIndex = 0;
      }
    }

    if (pageItems.length) {
      const labels = Array.from(new Set(pageItems.map(item => item.groupLabel)));
      pages.push({
        groupLabel: labels.length === 1 ? labels[0] : 'Hall of Fame Leaders',
        items: pageItems
      });
    }
  }

  return pages;
}

function renderLeaderCardHtml (entry) {
  const leader = entry && entry.leader ? entry.leader : entry;
  const photoHtml = leader.photoUrl
    ? `<div class="leader-photo"><img src="${esc(leader.photoUrl)}" alt="${esc(leader.name)}" /></div>`
    : '';
  const bioHtml = leader.bio ? `<div class="leader-bio">${esc(leader.bio)}</div>` : '';
  const yearsHtml = `<div class="leader-years">${esc(formatLeaderServiceYears(leader))}</div>`;
  const statusBadge = leader.status === 'current'
    ? '<span class="leader-status current">👑 Current</span>'
    : '<span class="leader-status former">📜 Former</span>';

  return `
    <div class="leader-card">
      ${photoHtml}
      <div class="leader-info">
        <div class="leader-name">${esc(leader.name)}</div>
        <div class="leader-title">${esc(leader.title)}</div>
        ${yearsHtml}
        ${bioHtml}
        ${statusBadge}
      </div>
    </div>`;
}

function getLeadersPerPage () {
  return 2;
}

function renderLeaders () {
  const list = getDisplayLeaders();
  if (!list.length) {
    const container = document.getElementById('social-or-leaders-list');
    if (container) {
      container.innerHTML = '<div class="no-content">No leaders in Hall of Fame yet</div>';
    }
    return;
  }

  const pages = buildGroupedLeaderPages(list, getLeadersPerPage());
  
  renderRollingCards({
    containerId: 'social-or-leaders-list',
    items: pages,
    pageSize: 1,
    emptyHtml: '<div class="no-content">No leaders to display</div>',
    timerKey: 'leaders',
    introPages: [],
    renderCard: page => {
      const pageItems = Array.isArray(page.items)
        ? page.items
        : (Array.isArray(page.leaders) ? page.leaders.map(leader => ({ leader })) : []);
      const count = Math.max(1, Math.min(2, pageItems.length));
      return `
        <div class="leader-group-page">
          <div class="leader-group-title">${esc(page.groupLabel)}</div>
          <div class="leader-group-grid count-${count}">
            ${pageItems.map(renderLeaderCardHtml).join('')}
          </div>
        </div>`;
    }
  });
}

function renderSecondPanel () {
  // Determine which panel to show: social activities or hall of fame leaders
  const showLeaders = shouldDisplayLeaders();
  const wrapper = document.getElementById('second-panel-wrapper');
  const panelHeader = document.getElementById('second-panel-title');
  const panelIcon = document.getElementById('second-panel-icon');
  
  if (showLeaders) {
    panelHeader.textContent = 'Hall of Fame - Leaders';
    panelIcon.textContent = '👑';
    renderLeaders();
  } else {
    panelHeader.textContent = 'Social Activities';
    panelIcon.textContent = '🎉';
    renderSocialActivities();
  }
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
  let sec;
  if (timerKey === 'social')   sec = clampInt(s.socialSwitchSeconds, 5, 60, legacySwitch);
  else if (timerKey === 'leaders') sec = clampInt(s.leaderSwitchSeconds, 10, 60, 18);
  else                          sec = clampInt(s.programSwitchSeconds, 5, 60, legacySwitch);
  return sec * 1000;
}

const VALID_TRANSITIONS = ['fade', 'fly', 'zoom', 'flip', 'wipe', 'morph', 'glitch'];

function getTransitionStyle (timerKey) {
  const s = DB.getSettings();
  let raw;
  if (timerKey === 'social')   raw = s.socialTransition;
  else if (timerKey === 'leaders') raw = s.leaderTransition;
  else                          raw = s.programTransition;
  return VALID_TRANSITIONS.includes(raw) ? raw : 'fade';
}

function applyAutoFitForCards (containerEl) {
  if (!containerEl) return;
  const cards = containerEl.querySelectorAll('.prog-card, .evt-card, .leader-card');
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
  renderSecondPanel();
  renderTicker();
  updateWeeklySundayVideoOverlay();
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
    el.style.animationName = 'ticker';
  } else {
    el.innerHTML = '';
    el.style.animationName = 'none';
    return;
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

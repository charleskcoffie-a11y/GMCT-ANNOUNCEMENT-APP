/* ══════════════════════════════════════════════════
   GMCT CHURCH APP – Admin Panel (admin.js)
   ══════════════════════════════════════════════════ */

const FIXED_DISPLAY_TITLE = 'GMCT-Ghana Methodist Church of Toronto';
const FIXED_DISPLAY_SUBTITLE = 'Upcoming Programs and Social Activities';
const AUTH_META_KEY = 'gmct_auth_meta';
const AUTH_MAX_ATTEMPTS = 5;
const AUTH_LOCKOUT_MS = 5 * 60 * 1000;
const DEFAULT_ADMIN_TIMEOUT_MINUTES = 30;

const WEEKDAY_INDEX = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
};

let _adminSessionWatchdog = null;
let _activityListenersBound = false;

function getAuthMeta () {
  try {
    return JSON.parse(localStorage.getItem(AUTH_META_KEY)) || { failCount: 0, lockedUntil: 0 };
  } catch {
    return { failCount: 0, lockedUntil: 0 };
  }
}

function saveAuthMeta (meta) {
  localStorage.setItem(AUTH_META_KEY, JSON.stringify(meta));
}

function clearFailedLoginState () {
  localStorage.removeItem(AUTH_META_KEY);
}

function recordFailedLogin () {
  const meta = getAuthMeta();
  const now = Date.now();
  const baseCount = (meta.lockedUntil && now > meta.lockedUntil) ? 0 : (meta.failCount || 0);
  const failCount = baseCount + 1;
  const next = {
    failCount,
    lockedUntil: failCount >= AUTH_MAX_ATTEMPTS ? now + AUTH_LOCKOUT_MS : 0
  };
  saveAuthMeta(next);
  return next;
}

function getAdminSessionTimeoutMs () {
  const s = DB.getSettings();
  const mins = parseInt(s.adminSessionTimeoutMinutes, 10);
  const clamped = Number.isFinite(mins) ? Math.max(5, Math.min(120, mins)) : DEFAULT_ADMIN_TIMEOUT_MINUTES;
  return clamped * 60 * 1000;
}

function touchAdminSession () {
  if (sessionStorage.getItem('gmct_admin') === 'true') {
    sessionStorage.setItem('gmct_admin_last_activity', String(Date.now()));
  }
}

function bindAdminActivityListeners () {
  if (_activityListenersBound) return;
  ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach(evt => {
    document.addEventListener(evt, touchAdminSession, { passive: true });
  });
  _activityListenersBound = true;
}

function startAdminSessionWatchdog () {
  touchAdminSession();
  bindAdminActivityListeners();
  if (_adminSessionWatchdog) clearInterval(_adminSessionWatchdog);

  _adminSessionWatchdog = setInterval(() => {
    const lastSeen = parseInt(sessionStorage.getItem('gmct_admin_last_activity') || '0', 10);
    if (!lastSeen) return;
    if (Date.now() - lastSeen > getAdminSessionTimeoutMs()) {
      toast('Session expired due to inactivity', 'info');
      doLogout();
    }
  }, 15000);
}

function clearAdminSession () {
  sessionStorage.removeItem('gmct_admin');
  sessionStorage.removeItem('gmct_admin_last_activity');
  if (_adminSessionWatchdog) {
    clearInterval(_adminSessionWatchdog);
    _adminSessionWatchdog = null;
  }
}

/* ── Auth ────────────────────────────────────────── */
function checkSession () {
  if (sessionStorage.getItem('gmct_admin') !== 'true') return false;

  const lastSeen = parseInt(sessionStorage.getItem('gmct_admin_last_activity') || '0', 10);
  if (!lastSeen) {
    clearAdminSession();
    return false;
  }
  if (Date.now() - lastSeen > getAdminSessionTimeoutMs()) {
    clearAdminSession();
    return false;
  }
  return true;
}

function doLogin () {
  const pwInput = document.getElementById('login-password');
  const errorEl = document.getElementById('login-error');
  const pw      = pwInput.value;
  if (!pw) return;

  const authMeta = getAuthMeta();
  if (authMeta.lockedUntil && Date.now() < authMeta.lockedUntil) {
    const mins = Math.ceil((authMeta.lockedUntil - Date.now()) / 60000);
    errorEl.textContent = `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
    errorEl.classList.remove('hidden');
    pwInput.value = '';
    pwInput.focus();
    return;
  }

  if (pw === DB.getSettings().adminPassword) {
    clearFailedLoginState();
    sessionStorage.setItem('gmct_admin', 'true');
    sessionStorage.setItem('gmct_admin_last_activity', String(Date.now()));
    errorEl.classList.add('hidden');
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('admin-panel').classList.remove('hidden');
    initAdmin();
  } else {
    const next = recordFailedLogin();
    if (next.lockedUntil && Date.now() < next.lockedUntil) {
      errorEl.textContent = 'Too many failed attempts. Login is locked for 5 minutes.';
    } else {
      const left = Math.max(0, AUTH_MAX_ATTEMPTS - (next.failCount || 0));
      errorEl.textContent = `Incorrect password. ${left} attempt${left === 1 ? '' : 's'} remaining.`;
    }
    errorEl.classList.remove('hidden');
    pwInput.value = '';
    pwInput.focus();
  }
}

function doLogout () {
  clearAdminSession();
  location.reload();
}

/* Allow Enter key on login */
document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

/* ── Tab navigation ──────────────────────────────── */
function showTab (name, navEl) {
  document.querySelectorAll('.tab-content').forEach(t => {
    t.classList.add('hidden');
    t.classList.remove('active');
  });
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const tab = document.getElementById('tab-' + name);
  if (tab) { tab.classList.remove('hidden'); tab.classList.add('active'); }
  if (navEl) navEl.classList.add('active');

  const titles = { dashboard:'Dashboard', programs:'Programs', events:'Social Activities', announcements:'Announcements', settings:'Settings' };
  document.getElementById('page-heading').textContent = titles[name] || name;

  if      (name === 'dashboard')     loadDashboard();
  else if (name === 'programs')      loadProgramsTable();
  else if (name === 'events')        loadEventsTable();
  else if (name === 'announcements') loadAnnouncementsTable();
  else if (name === 'settings')      loadSettingsForm();
}

/* ── Init ────────────────────────────────────────── */
function initAdmin () {
  loadDashboard();
  updateAdminClock();
  startAdminSessionWatchdog();
  setInterval(updateAdminClock, 1000);
}

function updateAdminClock () {
  const el = document.getElementById('admin-datetime');
  if (el) {
    el.textContent = new Date().toLocaleString('en-US', {
      weekday:'short', month:'short', day:'numeric',
      year:'numeric', hour:'numeric', minute:'2-digit'
    });
  }
}

/* ════════════════════════════════════════════════════
   DASHBOARD
   ════════════════════════════════════════════════════ */
function loadDashboard () {
  const programs      = DB.getPrograms();
  const events        = DB.getEvents();
  const announcements = DB.getAnnouncements();

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const upcoming = events.filter(e => new Date((e.endDate || e.startDate) + 'T23:59:59') >= today);

  document.getElementById('stat-programs').textContent      = programs.length;
  document.getElementById('stat-events').textContent        = events.length;
  document.getElementById('stat-announcements').textContent = announcements.filter(a => a.active).length;
  document.getElementById('stat-upcoming').textContent      = upcoming.length;

  // Recent programs list
  const pl = document.getElementById('dash-programs-list');
  pl.innerHTML = programs.length
    ? programs.slice(0, 5).map(p => `
        <div class="dash-row">
          <span class="dr-title">${esc(p.title)}</span>
          <span class="dr-meta">${getRecurrenceLabel(p)}</span>
        </div>`).join('')
    : '<p class="dash-empty">No programs added yet</p>';

  // Upcoming social activities list
  const el = document.getElementById('dash-events-list');
  el.innerHTML = upcoming.length
    ? upcoming.slice(0, 5).map(e => `
        <div class="dash-row">
          <span class="dr-title">${esc(e.title)}</span>
          <span class="dr-meta">${fmtDate(e.startDate)}</span>
        </div>`).join('')
    : '<p class="dash-empty">No upcoming social activities</p>';
}

/* ════════════════════════════════════════════════════
   PROGRAMS CRUD
   ════════════════════════════════════════════════════ */
let _editProgId = null;

function getRecurrenceLabel (p) {
  const rType = p.recurrenceType || (p.recurring ? 'weekly' : 'onetime');
  const until = p.repeatUntil ? `, until ${fmtDate(p.repeatUntil)}` : '';
  if (rType === 'weekly')   return `${esc(p.dayOfWeek || '--')} <small>(weekly${esc(until)})</small>`;
  if (rType === 'biweekly') return `${esc(p.dayOfWeek || '--')} <small>(every 2 wks${esc(until)})</small>`;
  if (rType === 'monthly') {
    const day = parseInt(p.dayOfMonth, 10);
    return Number.isFinite(day)
      ? `${esc(day)}${ordSuffix(day)} <small>(monthly${esc(until)})</small>`
      : `<small>(monthly${esc(until)})</small>`;
  }
  return esc(fmtDate(p.date));
}

function ordSuffix (n) {
  if (n >= 11 && n <= 13) return 'th';
  const r = n % 10;
  return r === 1 ? 'st' : r === 2 ? 'nd' : r === 3 ? 'rd' : 'th';
}

function toIsoDateLocal (d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getStartOfToday () {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseTimeToMinutes (t) {
  if (!t || !t.includes(':')) return null;
  const [h, m] = t.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function getProgramEndMinutes (p) {
  const start = parseTimeToMinutes(p.startTime);
  if (start === null) return null;
  const end = parseTimeToMinutes(p.endTime);
  if (end === null || end <= start) return Math.min(start + 60, 24 * 60);
  return end;
}

function getProgramType (p) {
  return p.recurrenceType || (p.recurring ? 'weekly' : 'onetime');
}

function getFirstWeeklyOccurrence (fromDate, dayName) {
  const dayIdx = WEEKDAY_INDEX[dayName];
  if (dayIdx === undefined) return null;
  const candidate = new Date(fromDate);
  const diff = (dayIdx - candidate.getDay() + 7) % 7;
  candidate.setDate(candidate.getDate() + diff);
  return candidate;
}

function generateProgramOccurrences (p, fromDate, toDate, limit = 36) {
  const out = [];
  const type = getProgramType(p);
  const fromIso = toIsoDateLocal(fromDate);
  const toIso = toIsoDateLocal(toDate);

  const pushIso = iso => {
    if (!iso) return;
    if (iso < fromIso || iso > toIso) return;
    if (p.repeatUntil && iso > p.repeatUntil) return;
    out.push(iso);
  };

  if (type === 'onetime') {
    pushIso(p.date || null);
    return out;
  }

  if (type === 'weekly') {
    let cursor = getFirstWeeklyOccurrence(fromDate, p.dayOfWeek);
    while (cursor && cursor <= toDate && out.length < limit) {
      pushIso(toIsoDateLocal(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }
    return out;
  }

  if (type === 'biweekly') {
    if (!p.refDate) return out;
    let cursor = new Date(p.refDate + 'T00:00:00');
    if (Number.isNaN(cursor.getTime())) return out;

    while (cursor < fromDate) cursor.setDate(cursor.getDate() + 14);
    while (cursor <= toDate && out.length < limit) {
      pushIso(toIsoDateLocal(cursor));
      cursor.setDate(cursor.getDate() + 14);
    }
    return out;
  }

  if (type === 'monthly') {
    const day = parseInt(p.dayOfMonth, 10);
    if (!Number.isFinite(day) || day < 1 || day > 28) return out;

    let cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), day);
    if (cursor < fromDate) cursor = new Date(fromDate.getFullYear(), fromDate.getMonth() + 1, day);

    while (cursor <= toDate && out.length < limit) {
      pushIso(toIsoDateLocal(cursor));
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, day);
    }
  }

  return out;
}

function findProgramConflicts (candidate, existingPrograms) {
  const venue = (candidate.venue || '').trim().toLowerCase();
  if (!venue) return [];

  const startA = parseTimeToMinutes(candidate.startTime);
  const endA = getProgramEndMinutes(candidate);
  if (startA === null || endA === null) return [];

  const fromDate = getStartOfToday();
  const toDate = new Date(fromDate);
  toDate.setDate(toDate.getDate() + 180);

  const candidateDates = generateProgramOccurrences(candidate, fromDate, toDate, 36);
  if (!candidateDates.length) return [];

  const conflicts = [];

  for (const existing of existingPrograms) {
    if ((existing.venue || '').trim().toLowerCase() !== venue) continue;

    const startB = parseTimeToMinutes(existing.startTime);
    const endB = getProgramEndMinutes(existing);
    if (startB === null || endB === null) continue;
    if (!(startA < endB && startB < endA)) continue;

    const existingDates = new Set(generateProgramOccurrences(existing, fromDate, toDate, 36));
    for (const d of candidateDates) {
      if (existingDates.has(d)) {
        conflicts.push({
          title: existing.title,
          date: d,
          startTime: existing.startTime,
          venue: existing.venue
        });
        break;
      }
    }
  }

  return conflicts;
}

function loadProgramsTable () {
  const list  = DB.getPrograms();
  const tbody = document.getElementById('programs-tbody');

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No programs yet – click "+ Add Program" to start.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(p => `
    <tr>
      <td><strong>${esc(p.title)}</strong></td>
      <td>${getRecurrenceLabel(p)}</td>
      <td>${esc(fmt12(p.startTime))}${p.endTime ? ' – ' + esc(fmt12(p.endTime)) : ''}</td>
      <td>${esc(p.venue)}</td>
      <td><span class="cat-badge cat-${esc(p.category)}">${esc(p.category)}</span></td>
      <td><div class="action-group">
        <button class="btn btn-sm btn-outline" onclick="editProgram('${esc(p.id)}')">Edit</button>
        <button class="btn btn-sm btn-danger"  onclick="deleteProgram('${esc(p.id)}')">Delete</button>
      </div></td>
    </tr>`).join('');
}

function openProgramModal () {
  _editProgId = null;
  document.getElementById('program-modal-title').textContent = 'Add Program';
  ['prog-id','prog-title','prog-date','prog-repeat-until','prog-start-time','prog-end-time','prog-venue','prog-description']
    .forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('prog-category').value = 'service';
  document.getElementById('prog-type').value = 'weekly';
  document.getElementById('prog-day').value = 'Sunday';
  document.getElementById('prog-ref-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('prog-dom').value = '1';
  toggleProgDateFields();
  document.getElementById('program-modal').classList.remove('hidden');
}

function editProgram (id) {
  const p = DB.getPrograms().find(x => x.id === id);
  if (!p) return;
  _editProgId = id;
  document.getElementById('program-modal-title').textContent = 'Edit Program';
  document.getElementById('prog-id').value          = p.id;
  document.getElementById('prog-title').value       = p.title;
  document.getElementById('prog-category').value    = p.category;
  const rType = p.recurrenceType || (p.recurring ? 'weekly' : 'onetime');
  document.getElementById('prog-type').value        = rType;
  document.getElementById('prog-day').value         = p.dayOfWeek || 'Sunday';
  document.getElementById('prog-ref-date').value    = p.refDate || new Date().toISOString().split('T')[0];
  document.getElementById('prog-dom').value         = p.dayOfMonth ? String(p.dayOfMonth) : '1';
  document.getElementById('prog-date').value        = p.date || '';
  document.getElementById('prog-repeat-until').value = p.repeatUntil || '';
  document.getElementById('prog-start-time').value  = p.startTime || '';
  document.getElementById('prog-end-time').value    = p.endTime || '';
  document.getElementById('prog-venue').value       = p.venue;
  document.getElementById('prog-description').value = p.description || '';
  toggleProgDateFields();
  document.getElementById('program-modal').classList.remove('hidden');
}

function closeProgramModal () {
  document.getElementById('program-modal').classList.add('hidden');
}

function toggleProgDateFields () {
  const type = document.getElementById('prog-type').value;
  document.getElementById('prog-day-group').classList.toggle('hidden',     type !== 'weekly' && type !== 'biweekly');
  document.getElementById('prog-ref-date-group').classList.toggle('hidden', type !== 'biweekly');
  document.getElementById('prog-dom-group').classList.toggle('hidden',      type !== 'monthly');
  document.getElementById('prog-date-group').classList.toggle('hidden',     type !== 'onetime');
  document.getElementById('prog-repeat-until-group').classList.toggle('hidden', type === 'onetime');
}

function saveProgram () {
  const title     = document.getElementById('prog-title').value.trim();
  const venue     = document.getElementById('prog-venue').value.trim();
  const startTime = document.getElementById('prog-start-time').value;
  const type      = document.getElementById('prog-type').value;
  const date      = document.getElementById('prog-date').value;
  const repeatUntil = document.getElementById('prog-repeat-until').value || null;

  if (!title || !venue || !startTime) {
    toast('Please fill all required fields: Title, Start Time, Venue', 'error'); return;
  }
  if (type === 'onetime' && !date) {
    toast('Please select a date for this one-time program', 'error'); return;
  }
  if (type === 'biweekly' && !document.getElementById('prog-ref-date').value) {
    toast('Please set a reference date for the biweekly schedule', 'error'); return;
  }
  if (type !== 'onetime' && repeatUntil && repeatUntil < toIsoDateLocal(getStartOfToday())) {
    toast('Repeat-until date cannot be in the past', 'error'); return;
  }

  const prog = {
    id:             _editProgId || genId(),
    title,
    category:       document.getElementById('prog-category').value,
    recurrenceType: type,
    recurring:      type !== 'onetime',
    dayOfWeek:      (type === 'weekly' || type === 'biweekly') ? document.getElementById('prog-day').value : null,
    refDate:        type === 'biweekly' ? document.getElementById('prog-ref-date').value : null,
    dayOfMonth:     type === 'monthly'  ? parseInt(document.getElementById('prog-dom').value, 10) : null,
    date:           type === 'onetime'  ? date : null,
    repeatUntil:    type === 'onetime'  ? null : repeatUntil,
    startTime,
    endTime:        document.getElementById('prog-end-time').value || null,
    venue,
    description:    document.getElementById('prog-description').value.trim()
  };

  const existingPrograms = DB.getPrograms().filter(p => p.id !== _editProgId);
  const conflicts = findProgramConflicts(prog, existingPrograms);
  if (conflicts.length) {
    const preview = conflicts.slice(0, 3)
      .map(c => `- ${c.title} on ${fmtDate(c.date)} at ${c.startTime ? fmt12(c.startTime) : 'time not set'}`)
      .join('\n');
    const extra = conflicts.length > 3 ? `\n(and ${conflicts.length - 3} more)` : '';
    const warn = `Possible schedule conflict at same venue/time:\n\n${preview}${extra}\n\nSave anyway?`;
    if (!confirm(warn)) return;
  }

  let list = DB.getPrograms();
  list = _editProgId ? list.map(p => p.id === _editProgId ? prog : p) : [...list, prog];
  DB.savePrograms(list);
  closeProgramModal();
  loadProgramsTable();
  loadDashboard();
  toast('Program saved!');
}

function deleteProgram (id) {
  if (!confirm('Delete this program?')) return;
  DB.savePrograms(DB.getPrograms().filter(p => p.id !== id));
  loadProgramsTable();
  loadDashboard();
  toast('Program deleted', 'info');
}

/* ════════════════════════════════════════════════════
   EVENTS CRUD
   ════════════════════════════════════════════════════ */
let _editEvtId = null;

function loadEventsTable () {
  const list  = DB.getEvents();
  const tbody = document.getElementById('events-tbody');

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No social activities yet - click "+ Add Social Activity" to start.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(e => `
    <tr>
      <td><strong>${esc(e.title)}</strong></td>
      <td>${esc(fmtDate(e.startDate))}</td>
      <td>${e.endDate ? esc(fmtDate(e.endDate)) : '—'}</td>
      <td>${e.time ? esc(fmt12(e.time)) : '—'}</td>
      <td>${esc(e.venue)}</td>
      <td>${e.featured ? '⭐ Yes' : 'No'}</td>
      <td><div class="action-group">
        <button class="btn btn-sm btn-outline" onclick="editEvent('${esc(e.id)}')">Edit</button>
        <button class="btn btn-sm btn-danger"  onclick="deleteEvent('${esc(e.id)}')">Delete</button>
      </div></td>
    </tr>`).join('');
}

function openEventModal () {
  _editEvtId = null;
  document.getElementById('event-modal-title').textContent = 'Add Social Activity';
  ['evt-id','evt-title','evt-start-date','evt-end-date','evt-time','evt-venue','evt-description']
    .forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('evt-featured').checked = false;
  document.getElementById('event-modal').classList.remove('hidden');
}

function editEvent (id) {
  const e = DB.getEvents().find(x => x.id === id);
  if (!e) return;
  _editEvtId = id;
  document.getElementById('event-modal-title').textContent  = 'Edit Social Activity';
  document.getElementById('evt-id').value          = e.id;
  document.getElementById('evt-title').value       = e.title;
  document.getElementById('evt-start-date').value  = e.startDate;
  document.getElementById('evt-end-date').value    = e.endDate || '';
  document.getElementById('evt-time').value        = e.time || '';
  document.getElementById('evt-venue').value       = e.venue;
  document.getElementById('evt-description').value = e.description || '';
  document.getElementById('evt-featured').checked  = e.featured || false;
  document.getElementById('event-modal').classList.remove('hidden');
}

function closeEventModal () {
  document.getElementById('event-modal').classList.add('hidden');
}

function saveEvent () {
  const title     = document.getElementById('evt-title').value.trim();
  const startDate = document.getElementById('evt-start-date').value;
  const venue     = document.getElementById('evt-venue').value.trim();

  if (!title || !startDate || !venue) {
    toast('Please fill all required fields: Title, Start Date, Venue', 'error'); return;
  }

  const evt = {
    id:          _editEvtId || genId(),
    title,
    startDate,
    endDate:     document.getElementById('evt-end-date').value    || null,
    time:        document.getElementById('evt-time').value        || null,
    venue,
    description: document.getElementById('evt-description').value.trim(),
    featured:    document.getElementById('evt-featured').checked
  };

  let list = DB.getEvents();
  list = _editEvtId ? list.map(e => e.id === _editEvtId ? evt : e) : [...list, evt];
  DB.saveEvents(list);
  closeEventModal();
  loadEventsTable();
  loadDashboard();
  toast('Social activity saved!');
}

function deleteEvent (id) {
  if (!confirm('Delete this social activity?')) return;
  DB.saveEvents(DB.getEvents().filter(e => e.id !== id));
  loadEventsTable();
  loadDashboard();
  toast('Social activity deleted', 'info');
}

/* ════════════════════════════════════════════════════
   ANNOUNCEMENTS CRUD
   ════════════════════════════════════════════════════ */
let _editAnnId = null;

function loadAnnouncementsTable () {
  const list  = DB.getAnnouncements();
  const tbody = document.getElementById('announcements-tbody');

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-row">No announcements yet – click "+ Add Announcement" to start.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(a => `
    <tr>
      <td>${esc(a.text)}</td>
      <td>
        <button class="btn btn-sm ${a.active ? 'btn-primary' : 'btn-outline'}"
                onclick="toggleAnnouncement('${esc(a.id)}')">
          ${a.active ? '✓ Active' : 'Inactive'}
        </button>
      </td>
      <td><div class="action-group">
        <button class="btn btn-sm btn-outline" onclick="editAnnouncement('${esc(a.id)}')">Edit</button>
        <button class="btn btn-sm btn-danger"  onclick="deleteAnnouncement('${esc(a.id)}')">Delete</button>
      </div></td>
    </tr>`).join('');
}

function openAnnouncementModal () {
  _editAnnId = null;
  document.getElementById('ann-modal-title').textContent = 'Add Announcement';
  document.getElementById('ann-id').value   = '';
  document.getElementById('ann-text').value = '';
  document.getElementById('ann-active').checked = true;
  document.getElementById('announcement-modal').classList.remove('hidden');
}

function editAnnouncement (id) {
  const a = DB.getAnnouncements().find(x => x.id === id);
  if (!a) return;
  _editAnnId = id;
  document.getElementById('ann-modal-title').textContent = 'Edit Announcement';
  document.getElementById('ann-id').value   = a.id;
  document.getElementById('ann-text').value = a.text;
  document.getElementById('ann-active').checked = a.active;
  document.getElementById('announcement-modal').classList.remove('hidden');
}

function closeAnnouncementModal () {
  document.getElementById('announcement-modal').classList.add('hidden');
}

function saveAnnouncement () {
  const text = document.getElementById('ann-text').value.trim();
  if (!text) { toast('Please enter announcement text', 'error'); return; }

  const ann = {
    id:     _editAnnId || genId(),
    text,
    active: document.getElementById('ann-active').checked
  };

  let list = DB.getAnnouncements();
  list = _editAnnId ? list.map(a => a.id === _editAnnId ? ann : a) : [...list, ann];
  DB.saveAnnouncements(list);
  closeAnnouncementModal();
  loadAnnouncementsTable();
  loadDashboard();
  toast('Announcement saved!');
}

function toggleAnnouncement (id) {
  const list = DB.getAnnouncements().map(a => a.id === id ? { ...a, active: !a.active } : a);
  DB.saveAnnouncements(list);
  loadAnnouncementsTable();
  loadDashboard();
}

function deleteAnnouncement (id) {
  if (!confirm('Delete this announcement?')) return;
  DB.saveAnnouncements(DB.getAnnouncements().filter(a => a.id !== id));
  loadAnnouncementsTable();
  loadDashboard();
  toast('Announcement deleted', 'info');
}

/* ════════════════════════════════════════════════════
   SETTINGS
   ════════════════════════════════════════════════════ */
function clampInt (value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeDailyReloadTime (value) {
  if (typeof value !== 'string') return '04:00';
  const m = value.match(/^(\d{2}):(\d{2})$/);
  if (!m) return '04:00';
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return '04:00';
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

const VALID_TRANSITIONS = ['fade', 'fly', 'zoom', 'flip', 'wipe', 'morph', 'glitch'];

function pickTransition (pickerId, hiddenId, btn) {
  const picker = document.getElementById(pickerId);
  const hidden = document.getElementById(hiddenId);
  if (!picker || !hidden || !btn) return;
  picker.querySelectorAll('.tx-opt').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  hidden.value = btn.dataset.val || 'fade';
}

function setTransitionPicker (pickerId, hiddenId, value) {
  const picker = document.getElementById(pickerId);
  const hidden = document.getElementById(hiddenId);
  if (!picker || !hidden) return;
  const safe = VALID_TRANSITIONS.includes(value) ? value : 'fade';
  hidden.value = safe;
  picker.querySelectorAll('.tx-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.val === safe);
  });
}

function loadSettingsForm () {
  const s = DB.getSettings();
  const speed = clampInt(s.tickerSpeed, 10, 120, 40);
  const legacySwitch = clampInt(s.cardSwitchSeconds, 5, 60, 10);
  const programSwitch = clampInt(s.programSwitchSeconds, 5, 60, legacySwitch);
  const socialSwitch = clampInt(s.socialSwitchSeconds, 5, 60, legacySwitch);
  const timeoutMin = clampInt(s.adminSessionTimeoutMinutes, 5, 120, DEFAULT_ADMIN_TIMEOUT_MINUTES);

  document.getElementById('set-ticker-speed').value = speed;
  document.getElementById('ticker-speed-val').textContent = speed;

  document.getElementById('set-program-switch-seconds').value = programSwitch;
  document.getElementById('program-switch-seconds-val').textContent = programSwitch;

  document.getElementById('set-social-switch-seconds').value = socialSwitch;
  document.getElementById('social-switch-seconds-val').textContent = socialSwitch;

  document.getElementById('set-daily-reload-time').value = sanitizeDailyReloadTime(s.dailyReloadTime);
  document.getElementById('set-auto-reload-on-error').checked = s.autoReloadOnError !== false;

  document.getElementById('set-admin-session-timeout').value = timeoutMin;
  document.getElementById('admin-session-timeout-val').textContent = timeoutMin;

  setTransitionPicker('prog-tx-picker',   'set-program-transition', s.programTransition || 'fade');
  setTransitionPicker('social-tx-picker', 'set-social-transition',  s.socialTransition  || 'fade');

  const backupInput = document.getElementById('backup-file');
  if (backupInput) backupInput.value = '';
}

function saveSettings () {
  const s = DB.getSettings();
  const programSwitch = clampInt(document.getElementById('set-program-switch-seconds').value, 5, 60, 10);
  const socialSwitch = clampInt(document.getElementById('set-social-switch-seconds').value, 5, 60, 10);

  s.churchName    = FIXED_DISPLAY_TITLE;
  s.churchTagline = FIXED_DISPLAY_SUBTITLE;
  s.tickerSpeed   = clampInt(document.getElementById('set-ticker-speed').value, 10, 120, 40);
  s.cardSwitchSeconds = programSwitch; // Legacy fallback for older displays.
  s.programSwitchSeconds = programSwitch;
  s.socialSwitchSeconds = socialSwitch;
  s.dailyReloadTime = sanitizeDailyReloadTime(document.getElementById('set-daily-reload-time').value);
  s.autoReloadOnError = document.getElementById('set-auto-reload-on-error').checked;
  s.adminSessionTimeoutMinutes = clampInt(document.getElementById('set-admin-session-timeout').value, 5, 120, DEFAULT_ADMIN_TIMEOUT_MINUTES);

  const progTx   = document.getElementById('set-program-transition').value;
  const socialTx = document.getElementById('set-social-transition').value;
  s.programTransition = VALID_TRANSITIONS.includes(progTx)   ? progTx   : 'fade';
  s.socialTransition  = VALID_TRANSITIONS.includes(socialTx) ? socialTx : 'fade';

  DB.saveSettings(s);
  startAdminSessionWatchdog();
  showMsg('settings-msg', '✓ Settings saved successfully!');
  toast('Settings saved!');
}

function parseBackupPayload (raw) {
  const src = raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object' ? raw.data : raw;
  if (!src || typeof src !== 'object') throw new Error('Invalid backup format');

  if (!Array.isArray(src.programs)) throw new Error('Backup is missing programs');
  if (!Array.isArray(src.events)) throw new Error('Backup is missing social activities');
  if (!Array.isArray(src.announcements)) throw new Error('Backup is missing announcements');
  if (!src.settings || typeof src.settings !== 'object') throw new Error('Backup is missing settings');

  return {
    programs: src.programs,
    events: src.events,
    announcements: src.announcements,
    settings: src.settings
  };
}

function exportBackup () {
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    data: {
      programs: DB.getPrograms(),
      events: DB.getEvents(),
      announcements: DB.getAnnouncements(),
      settings: DB.getSettings()
    }
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  link.href = url;
  link.download = `gmct-backup-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('Backup exported', 'info');
}

function importBackup (files) {
  const file = files && files[0];
  const backupInput = document.getElementById('backup-file');
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = parseBackupPayload(JSON.parse(String(reader.result || '')));

      if (!confirm('Import will replace all current content and settings. Continue?')) {
        if (backupInput) backupInput.value = '';
        return;
      }

      DB.savePrograms(parsed.programs);
      DB.saveEvents(parsed.events);
      DB.saveAnnouncements(parsed.announcements);

      const mergedSettings = Object.assign({}, DB.getSettings(), parsed.settings || {});
      mergedSettings.churchName = FIXED_DISPLAY_TITLE;
      mergedSettings.churchTagline = FIXED_DISPLAY_SUBTITLE;
      mergedSettings.dailyReloadTime = sanitizeDailyReloadTime(mergedSettings.dailyReloadTime);
      DB.saveSettings(mergedSettings);

      startAdminSessionWatchdog();
      loadDashboard();
      loadProgramsTable();
      loadEventsTable();
      loadAnnouncementsTable();
      loadSettingsForm();
      showMsg('settings-msg', '✓ Backup imported successfully!');
      toast('Backup imported!');
    } catch (err) {
      toast('Invalid backup file format', 'error');
    } finally {
      if (backupInput) backupInput.value = '';
    }
  };

  reader.onerror = () => {
    toast('Could not read backup file', 'error');
    if (backupInput) backupInput.value = '';
  };

  reader.readAsText(file);
}

function changePassword () {
  const current  = document.getElementById('set-current-pass').value;
  const newPw    = document.getElementById('set-new-pass').value;
  const confirm  = document.getElementById('set-confirm-pass').value;
  const s        = DB.getSettings();

  if (current !== s.adminPassword)  { toast('Current password is incorrect', 'error');          return; }
  if (newPw.length < 6)             { toast('New password must be at least 6 characters', 'error'); return; }
  if (newPw !== confirm)            { toast('Passwords do not match', 'error');                  return; }

  s.adminPassword = newPw;
  DB.saveSettings(s);
  ['set-current-pass','set-new-pass','set-confirm-pass'].forEach(id => { document.getElementById(id).value = ''; });
  showMsg('settings-msg', '✓ Password changed successfully!');
  toast('Password changed!');
}

function showMsg (id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

/* ── Toast ───────────────────────────────────────── */
let _toastTimer;
function toast (msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast toast-${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

/* ── On page load ────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  if (checkSession()) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('admin-panel').classList.remove('hidden');
    initAdmin();
  }
});

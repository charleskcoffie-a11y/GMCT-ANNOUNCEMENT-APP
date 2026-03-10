/* ══════════════════════════════════════════════════
   GMCT CHURCH APP – Data layer (shared by both pages)
   Uses localStorage for persistence. No backend needed.
   ══════════════════════════════════════════════════ */

const KEYS = {
  PROGRAMS:      'gmct_programs',
  EVENTS:        'gmct_events',
  ANNOUNCEMENTS: 'gmct_announcements',
  SETTINGS:      'gmct_settings'
};

const DEFAULT_SETTINGS = {
  churchName:    'GMCT-Ghana Methodist Church of Toronto',
  churchTagline: 'Upcoming Programs and Social Activities',
  adminPassword: 'admin123',
  tickerSpeed:   40,
  cardSwitchSeconds: 10,
  programSwitchSeconds: 10,
  socialSwitchSeconds: 10,
  dailyReloadTime: '04:00',
  autoReloadOnError: true,
  adminSessionTimeoutMinutes: 30,
  programTransition: 'fade',
  socialTransition: 'fade'
};

/* ── Storage helpers ─────────────────────────────── */
const DB = {
  _get (key)       { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  _set (key, val)  { localStorage.setItem(key, JSON.stringify(val)); },

  getPrograms ()      { return this._get(KEYS.PROGRAMS)      || []; },
  getEvents ()        { return this._get(KEYS.EVENTS)        || []; },
  getAnnouncements () { return this._get(KEYS.ANNOUNCEMENTS) || []; },
  getSettings ()      { return Object.assign({}, DEFAULT_SETTINGS, this._get(KEYS.SETTINGS) || {}); },

  savePrograms (d)      { this._set(KEYS.PROGRAMS, d);      },
  saveEvents (d)        { this._set(KEYS.EVENTS, d);        },
  saveAnnouncements (d) { this._set(KEYS.ANNOUNCEMENTS, d); },
  saveSettings (d)      { this._set(KEYS.SETTINGS, d);      }
};

/* ── Utilities ───────────────────────────────────── */
function genId () {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Converts "13:45" → "1:45 PM" */
function fmt12 (t) {
  if (!t) return '';
  const [hh, mm] = t.split(':').map(Number);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h = hh % 12 || 12;
  return `${h}:${mm.toString().padStart(2, '0')} ${ampm}`;
}

/** Formats "2026-03-15" → "Sun, Mar 15 2026" */
function fmtDate (s) {
  if (!s) return '';
  return new Date(s + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
  });
}

/** Returns whole days from today to dateStr (negative = past) */
function daysUntil (dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr + 'T00:00:00') - today) / 86400000);
}

/** Safely escape strings before inserting into HTML */
function esc (str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

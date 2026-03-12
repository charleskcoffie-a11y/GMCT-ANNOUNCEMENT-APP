/* ══════════════════════════════════════════════════
   GMCT CHURCH APP – Data layer (shared by both pages)
   Uses localStorage for persistence. No backend needed.
   ══════════════════════════════════════════════════ */

const KEYS = {
  PROGRAMS:      'gmct_programs',
  EVENTS:        'gmct_events',
  FLYERS:        'gmct_flyers',
  ANNOUNCEMENTS: 'gmct_announcements',
  LEADERS:       'gmct_leaders',
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
  leaderSwitchSeconds: 18,
  dailyReloadTime: '04:00',
  autoReloadOnError: true,
  adminSessionTimeoutMinutes: 5,
  programTransition: 'fade',
  socialTransition: 'fade',
  leaderTransition: 'fade',
  hallOfFameEnabled: true,
  minSocialItemsShowLeaders: 2
};

const CLOUD_SYNC_KEYS = [
  KEYS.LEADERS,
  KEYS.PROGRAMS,
  KEYS.EVENTS,
  KEYS.FLYERS,
  KEYS.ANNOUNCEMENTS,
  KEYS.SETTINGS
];

/* ── Storage helpers ─────────────────────────────── */
const DB = {
  _get (key)       { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  _set (key, val)  {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        console.error('localStorage quota exceeded for key:', key, '- data not saved locally.');
        if (typeof window !== 'undefined' && typeof window.toast === 'function') {
          window.toast('Storage full — upload flyers to Cloudinary to free up space.', 'error');
        }
      } else {
        throw e;
      }
    }
    if (window.CloudSync && typeof window.CloudSync.queuePush === 'function') {
      window.CloudSync.queuePush(key);
    }
  },

  getPrograms ()      { return this._get(KEYS.PROGRAMS)      || []; },
  getEvents ()        { return this._get(KEYS.EVENTS)        || []; },
  getFlyers ()        { return this._get(KEYS.FLYERS)        || []; },
  getAnnouncements () { return this._get(KEYS.ANNOUNCEMENTS) || []; },
  getLeaders ()       { return this._get(KEYS.LEADERS)       || []; },
  getSettings ()      { return Object.assign({}, DEFAULT_SETTINGS, this._get(KEYS.SETTINGS) || {}); },

  savePrograms (d)      { this._set(KEYS.PROGRAMS, d);      },
  saveEvents (d)        { this._set(KEYS.EVENTS, d);        },
  saveFlyers (d)        { this._set(KEYS.FLYERS, d);        },
  saveAnnouncements (d) { this._set(KEYS.ANNOUNCEMENTS, d); },
  saveLeaders (d)       { this._set(KEYS.LEADERS, d);       },
  saveSettings (d)      { this._set(KEYS.SETTINGS, d);      }
};

/* ── Optional Firebase cloud sync ────────────────── */
const CloudSync = {
  _initPromise: null,
  _bootPromise: null,
  _ready: false,
  _suppressPush: false,
  _pushTimer: null,
  _unsubscribe: null,
  _docRef: null,
  _lastAppliedVersion: 0,

  isEnabled () {
    return window.GMCT_FIREBASE_ENABLED === true;
  },

  isConfigured () {
    const cfg = window.GMCT_FIREBASE_CONFIG || {};
    return !!(
      this.isEnabled() &&
      cfg.apiKey &&
      cfg.authDomain &&
      cfg.projectId &&
      cfg.appId &&
      typeof window.GMCT_FIREBASE_ROOM === 'string' &&
      window.GMCT_FIREBASE_ROOM.trim()
    );
  },

  async init () {
    if (this._ready) return true;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      if (!this.isConfigured()) return false;
      if (!window.firebase || !firebase.initializeApp || !firebase.firestore) return false;

      try {
        const cfg = window.GMCT_FIREBASE_CONFIG;
        const room = window.GMCT_FIREBASE_ROOM.trim();
        const appName = 'gmct-announcement-sync';

        const app = firebase.apps.find(a => a.name === appName) || firebase.initializeApp(cfg, appName);

        if (window.GMCT_FIREBASE_USE_ANON_AUTH !== false && firebase.auth) {
          try {
            await firebase.auth(app).signInAnonymously();
          } catch {
            // Continue without auth when rules allow public access.
          }
        }

        this._docRef = firebase.firestore(app).collection('gmctRooms').doc(room);
        this._ready = true;
        return true;
      } catch {
        this._ready = false;
        return false;
      }
    })();

    return this._initPromise;
  },

  _applyPayloadToLocal (payload) {
    if (!payload || typeof payload !== 'object') return;

    const hasPrograms = Array.isArray(payload.programs);
    const hasEvents = Array.isArray(payload.events);
    const hasFlyers = Array.isArray(payload.flyers);
    const hasAnnouncements = Array.isArray(payload.announcements);
    const hasSettings = payload.settings && typeof payload.settings === 'object';
    if (!hasPrograms && !hasEvents && !hasFlyers && !hasAnnouncements && !hasSettings) return;

    this._suppressPush = true;
    try {
      if (hasPrograms) localStorage.setItem(KEYS.PROGRAMS, JSON.stringify(payload.programs));
      if (hasEvents) localStorage.setItem(KEYS.EVENTS, JSON.stringify(payload.events));
      if (hasFlyers) {
        // imageData (Base64) is never synced — restore from local store.
        // imageUrl (Cloudinary) comes from Firestore and is the source of truth.
        const localFlyers = DB._get(KEYS.FLYERS) || [];
        const localMap = {};
        localFlyers.forEach(f => { if (f.id) localMap[f.id] = f.imageData || ''; });
        const merged = payload.flyers.map(f => {
          const copy = Object.assign({}, f);
          // Only restore local Base64 if there's no cloud URL for this flyer
          if (!copy.imageUrl) copy.imageData = localMap[f.id] || '';
          return copy;
        });
        localStorage.setItem(KEYS.FLYERS, JSON.stringify(merged));
      }
      if (hasAnnouncements) localStorage.setItem(KEYS.ANNOUNCEMENTS, JSON.stringify(payload.announcements));
      if (hasSettings) {
        // churchLogo handling:
        //  - If Firestore has a URL (Cloudinary), that is the source of truth.
        //  - If Firestore has no logo, preserve the local copy (Base64 or URL).
        const localSettings = DB._get(KEYS.SETTINGS);
        const localLogo = localSettings && localSettings.churchLogo ? localSettings.churchLogo : null;
        const merged = Object.assign({}, DEFAULT_SETTINGS, payload.settings);
        if (!merged.churchLogo && localLogo) merged.churchLogo = localLogo;
        localStorage.setItem(KEYS.SETTINGS, JSON.stringify(merged));
      }
    } finally {
      this._suppressPush = false;
    }

    window.dispatchEvent(new CustomEvent('gmct-data-updated', {
      detail: { source: 'firebase' }
    }));
  },

  async pullOnce () {
    const ok = await this.init();
    if (!ok || !this._docRef) return false;

    try {
      const snap = await this._docRef.get();
      if (!snap.exists) return false;

      const payload = snap.data() || {};
      const ver = Number(payload.updatedAtMs || 0);
      if (Number.isFinite(ver) && ver > 0) this._lastAppliedVersion = ver;
      this._applyPayloadToLocal(payload);
      return true;
    } catch {
      return false;
    }
  },

  startRealtimeListener () {
    if (!this._ready || !this._docRef || this._unsubscribe) return;

    this._unsubscribe = this._docRef.onSnapshot(snap => {
      if (!snap.exists) return;

      const payload = snap.data() || {};
      const ver = Number(payload.updatedAtMs || 0);
      if (Number.isFinite(ver) && ver > 0 && ver <= this._lastAppliedVersion) return;

      if (Number.isFinite(ver) && ver > 0) this._lastAppliedVersion = ver;
      this._applyPayloadToLocal(payload);
    }, () => {
      // Ignore listener errors and continue in local-only mode.
    });
  },

  async pushNow () {
    if (this._suppressPush) return false;
    const ok = await this.init();
    if (!ok || !this._docRef) return false;

    // If churchLogo is a URL (Cloudinary), it is small enough for Firestore — keep it.
    // If it is a Base64 blob (starts with 'data:'), strip it to avoid the 1 MB limit.
    const settingsForCloud = Object.assign({}, DB.getSettings());
    if (settingsForCloud.churchLogo && settingsForCloud.churchLogo.startsWith('data:')) {
      delete settingsForCloud.churchLogo;
    }

    // Strip imageData from flyers — binary blobs would exceed Firestore's 1 MB
    // document limit. Only flyer metadata is synced; images stay in localStorage.
    const flyersForCloud = DB.getFlyers().map(f => {
      const copy = Object.assign({}, f);
      delete copy.imageData;
      return copy;
    });

    const payload = {
      schemaVersion: 1,
      updatedAtMs: Date.now(),
      programs: DB.getPrograms(),
      events: DB.getEvents(),
      flyers: flyersForCloud,
      announcements: DB.getAnnouncements(),
      settings: settingsForCloud
    };

    this._lastAppliedVersion = payload.updatedAtMs;

    try {
      await this._docRef.set(payload, { merge: true });
      return true;
    } catch {
      return false;
    }
  },

  queuePush (changedKey) {
    if (this._suppressPush) return;
    if (!this.isEnabled()) return;
    if (!CLOUD_SYNC_KEYS.includes(changedKey)) return;

    if (this._pushTimer) clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => {
      this.pushNow();
    }, 300);
  },

  async bootstrap () {
    if (this._bootPromise) return this._bootPromise;

    this._bootPromise = (async () => {
      const ok = await this.init();
      if (!ok) return false;
      await this.pullOnce();
      this.startRealtimeListener();
      return true;
    })();

    return this._bootPromise;
  }
};

window.CloudSync = CloudSync;

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

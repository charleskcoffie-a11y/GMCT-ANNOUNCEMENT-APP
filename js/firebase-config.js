/*
  Firebase Cloud Sync Configuration
  --------------------------------
  1) Set GMCT_FIREBASE_ENABLED to true.
  2) Paste your Firebase Web App config values below.
  3) Keep the same room name on all devices that should share data.
*/

window.GMCT_FIREBASE_ENABLED = true;
window.GMCT_FIREBASE_USE_ANON_AUTH = true;
window.GMCT_SUPER_ADMIN_PASSWORD = '192712';
window.GMCT_SOCIETY_OPTIONS = [
  { id: 'gmct-main', label: 'GMCT Main' },
  { id: 'ebenezer-hamilton', label: 'Ebenezer, Hamilton' },
  { id: 'st-paul-baltimore', label: 'St. Paul Society, Baltimore' }
];

const GMCT_DEFAULT_ROOM = 'gmct-main';
const GMCT_ROOM_PARAM_KEYS = ['society', 'org', 'room'];
const GMCT_ROOM_STORAGE_KEY = 'gmct_active_society';

function normalizeRoomId (value) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function readRoomFromQuery () {
  try {
    const params = new URLSearchParams(window.location.search || '');
    for (const key of GMCT_ROOM_PARAM_KEYS) {
      const raw = params.get(key);
      const room = normalizeRoomId(raw);
      if (room) return room;
    }
  } catch {
    // Ignore malformed URL and use fallback resolution.
  }
  return '';
}

function readRoomFromStorage () {
  try {
    return normalizeRoomId(localStorage.getItem(GMCT_ROOM_STORAGE_KEY) || '');
  } catch {
    return '';
  }
}

function saveRoomToStorage (room) {
  if (!room) return;
  try {
    localStorage.setItem(GMCT_ROOM_STORAGE_KEY, room);
  } catch {
    // Ignore storage errors and continue.
  }
}

const _queryRoom = readRoomFromQuery();
const _activeRoom = _queryRoom || GMCT_DEFAULT_ROOM;
saveRoomToStorage(_activeRoom);

window.GMCT_FIREBASE_ROOM = _activeRoom;
window.GMCT_ACTIVE_SOCIETY = _activeRoom;

window.GMCT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyATzWRb3PwmwUGYMJ-cyfd5I6D5RC1DD0c',
  authDomain: 'gmct-announcement.firebaseapp.com',
  projectId: 'gmct-announcement',
  storageBucket: 'gmct-announcement.appspot.com',
  messagingSenderId: '112212748992',
  appId: '1:112212748992:web:1b1b70df7d023a71da9b25',
  measurementId: 'G-B9R9M5JQZF'
};

# GMCT Announcement App

A local HTML/CSS/JavaScript church announcement display application for **GMCT – Ghana Methodist Church of Toronto**.

## Features

- **Split-panel display** — Upcoming Programs (2×2 grid) and Social Activities side by side
- **Rolling cards** — pages automatically cycle with 7 selectable transition styles (Fade, Fly In, Zoom, Flip 3D, Wipe, Morph, Glitch)
- **Live ticker** — scrolling announcement bar at the bottom
- **Admin panel** — full CRUD for Programs, Social Activities, and Announcements
- **Recurrence engine** — supports one-time, weekly, bi-weekly, and monthly repeating programs with optional end dates
- **Conflict detection** — warns when two programs overlap at the same venue and time
- **Smart auto-fit** — cards automatically switch to compact/dense layout to prevent overflow
- **Configurable timers** — separate switch speeds for Programs and Social panels
- **Daily TV reload** — automatically reloads the display at a set time (default 4 AM)
- **Backup & Restore** — export/import all data as a JSON file
- **Security hardening** — admin login lockout after 5 failed attempts, inactivity session timeout
- **Optional Firebase cloud sync** — share programs/events/announcements/settings across devices

## Project Structure

```text
├── index.html        # Public display page (shown on TV/screen)
├── admin.html        # Admin panel (add/edit content and settings)
├── css/
│   └── style.css     # All styles for display and admin pages
└── js/
    ├── data.js       # localStorage data layer and shared utilities
    ├── app.js        # Display page runtime (clock, rolling cards, ticker)
    └── admin.js      # Admin panel logic (auth, CRUD, settings, backup)
```

## Usage

1. Open `index.html` in a browser for the display screen (TV / projector).
2. Open `admin.html` in a browser to manage content.
3. Default admin password: `admin123` — **change it immediately** in Settings → Change Admin Password.

> All data is stored in the browser's `localStorage`. No server or internet connection required.

## Live Site (GitHub Pages)

| Page | URL |
|------|-----|
| 📺 Display | https://charleskcoffie-a11y.github.io/GMCT-ANNOUNCEMENT-APP/ |
| ⚙️ Admin Panel | https://charleskcoffie-a11y.github.io/GMCT-ANNOUNCEMENT-APP/admin.html |

## Deployment

This is a fully static app — no build step needed. You can:

- Host it on **GitHub Pages** (free) by pushing this repo and enabling Pages on the `master` branch in **Settings → Pages**.
- Drop it on any static file host (Netlify, Vercel, etc.).
- Open the HTML files directly from a local folder.

> **Note:** A `.nojekyll` file is included so GitHub Pages serves files as-is without Jekyll processing.

## Firebase Cloud Sync

Firebase has a free tier called **Spark** (good for small projects and testing).

### 1) Create Firebase project

1. Go to Firebase Console and create a new project.
2. Add a **Web App**.
3. Copy the web config values.

### 2) Enable Firestore and Anonymous Auth

1. In Firebase Console, create a **Cloud Firestore** database.
2. In Authentication, enable **Anonymous** sign-in provider.

### 3) Configure this app

Edit `js/firebase-config.js`:

- Set `window.GMCT_FIREBASE_ENABLED = true`
- Paste your Firebase config in `window.GMCT_FIREBASE_CONFIG`
- Set `window.GMCT_FIREBASE_ROOM` to a shared room name (for example: `gmct-main`)

All devices must use the same room name to share one data set.

### 4) Firestore security rules (starter)

Use strict rules in production. A simple starter (requires anonymous sign-in):

```text
rules_version = '2';
service cloud.firestore {
    match /databases/{database}/documents {
        match /gmctRooms/{roomId} {
            allow read, write: if request.auth != null;
        }
    }
}
```

### 5) Publish

Push to GitHub and host on GitHub Pages. Once enabled, changes made from `admin.html` sync to all devices opening the same hosted link.

## License

Church internal use. All rights reserved — GMCT Toronto.

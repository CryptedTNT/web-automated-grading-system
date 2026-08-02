# Automated Grading System — Vue 3 migration

This folder is the Vue 3 version of the app. The original vanilla JavaScript
app in the parent folder still works and is untouched — run either one.

## Prerequisites

Node.js is **not currently installed** on the development machine. Install the
LTS build from <https://nodejs.org>, then close and reopen your terminal so
`node` and `npm` are on the PATH. Verify with:

```
node --version
npm --version
```

## Running it

Note the repository has two nested folders with the same name. `vue-app` is
inside the **inner** one, next to `js/` and `css/`:

```
web-automated-grading-system-main\        <- outer (extracted zip)
└── web-automated-grading-system-main\    <- inner (the app)
    ├── js\  css\  index.html             <- original vanilla app
    └── vue-app\                          <- this project
```

From the outer folder:

```
cd web-automated-grading-system-main\vue-app
npm install
npm run dev
```

Vite prints a local URL (usually <http://localhost:5173>). Open it in a browser.

**Immediately after the first `npm install`, commit `package-lock.json`.** That
file pins every dependency to an exact version, so the project keeps building
identically for the whole thesis regardless of what gets released upstream. Do
not run `npm update` before the defense.

## Building and deploying

```
npm run build      # writes dist/
npm run preview    # serve dist/ locally to check the production build
```

`dist/` is plain static files. Deploy by connecting the repository to
[Vercel](https://vercel.com) or [Netlify](https://netlify.com) — both have free
tiers, detect Vite automatically, and give you a public URL for testers.

The router uses **hash history** (`/#/dashboard`), so deep links work on static
hosts without SPA rewrite rules. If you switch to clean URLs later, change
`createWebHashHistory()` to `createWebHistory()` in `src/router/index.js` and
add a rewrite rule sending all paths to `index.html`.

## Project structure

```
vue-app/
├── index.html                 Entry document (loads SheetJS from CDN)
├── vite.config.js             Build config; '@' aliases to src/
├── src/
│   ├── main.js                Bootstrap: Pinia, router, theme, v-focus
│   ├── App.vue                Shell — sidebar, top bar, dialog host
│   ├── assets/styles.css      Copied unchanged from ../css/styles.css
│   ├── router/index.js        Routes + the signed-in guard
│   ├── stores/
│   │   ├── app.js             Shared state (replaces App.state)
│   │   └── processing.js      Progress, log, and session of the running job
│   ├── services/
│   │   ├── database.js        localStorage CRUD (ported from ../js/database.js)
│   │   ├── processing.js      Placeholder grading adapter — the model seam
│   │   ├── export.js          Workbook building and download
│   │   ├── backup.js          Whole-app backup file download and read
│   │   ├── theme.js           Palettes and CSS variable swapping
│   │   └── dialog.js          showMessage() / showConfirm()
│   ├── components/            HeroPanel, PasswordField, PasswordRules,
│   │                          DialogHost
│   └── views/                 One component per page
```

## Migration status

| Page | Status | Source |
| --- | --- | --- |
| Account setup | Ported | `js/auth.js` |
| Login | Ported | `js/auth.js` |
| Forgot password | Ported | `js/auth.js` |
| Dashboard | Ported | `js/dashboard.js` |
| How to Use | Ported | `js/how_to_use.js` |
| Answer Keys | Ported | `js/answer_key.js` |
| Upload Sheets | Ported | `js/upload.js` |
| Processing | Ported | `js/processing.js` |
| Results | Ported | `js/results.js` |
| Student Result | Ported | `js/student_result.js` |
| Review Flagged | Ported | `js/review.js` |
| Reports | Ported | `js/reports.js` |
| Settings | Ported | `js/settings.js` |

Every page is ported — there are no placeholder screens left.

## Processing sessions

A run is driven by `stores/processing.js`, so the progress bar and log
survive navigating to another page and back. A session moves through these
statuses:

| Status | Meaning |
| --- | --- |
| Processing | A run is live in this tab right now. |
| Completed | Every queued image produced a record. |
| Cancelled | Stopped with **Cancel Processing**. Records already written are kept and the upload queue is left intact, so the run can be restarted. |
| Failed | The adapter threw, or the tab was closed mid-run. |

Cancelling takes effect after the image being processed finishes, so a
partial record is never written. Because a run cannot survive a page load,
`DB.failInterruptedSessions()` runs once at startup in `main.js` and marks
any session still sitting at "Processing" as Failed — otherwise a session
from a closed tab would report itself as in progress forever.

## Backup and restore

All data lives in `localStorage`, which is scoped to one browser profile on one
origin — data created on `localhost` does **not** follow you to a deployed
GitHub Pages build. **Settings → Data** is the supported way to move it.

- **Download Backup** writes a single `ags_backup_YYYY-MM-DD.json` containing
  every key in `STORAGE_KEYS`: the teacher account, answer keys, sessions,
  student results, and every manual review decision.
- **Restore from File** validates the file, confirms what it contains, then
  **replaces** everything in this browser — a key absent from the backup is
  removed, so the result matches the machine the backup came from. Validation
  runs fully before the first write, so a rejected file cannot leave storage
  half-overwritten. The page reloads afterwards so no in-memory state survives.

Useful for seeding a defense demo: build one realistic dataset, export it, and
import it on whatever machine you present from.

> **Keep the backup file private.** It contains the account's password and
> security-answer hashes and salts. Do not commit it or email it.

## Porting a page

Each old page module is an IIFE exposing `refresh()` that builds an HTML string
and then attaches listeners by element id. The Vue equivalent:

1. Move the HTML string into `<template>`, replacing `${...}` with `{{ ... }}`.
2. Replace loops that concatenate rows with `v-for`.
3. Replace `document.getElementById(...).addEventListener('click', fn)` with
   `@click="fn"`.
4. Replace `App.showPage('x')` with `<RouterLink :to="{ name: 'x' }">`.
5. Replace `App.showMessage(...)` with `showMessage(...)` from
   `@/services/dialog.js`.
6. Read data through `DB` exactly as before — wrap it in `computed()` so the
   page updates when the data changes.

`DashboardView.vue` is the clearest worked example of all six steps.

## Notes for the thesis

- **Data is per-browser.** Everything is in `localStorage`. Deployed online,
  each tester gets an isolated sandbox — nothing is shared between them, and
  clearing browser data erases it. State this explicitly rather than implying
  a shared database.
- **Passwords are hashed in the browser** and stored in `localStorage`. That is
  a prototype measure, not authentication. Real accounts need a backend.
  The hash input is UTF-8 encoded first (`_utf8` in `database.js`), because the
  bundled SHA-256 takes one byte per character. Without that step a password
  containing a smart quote, an emoji, or any character above U+00FF produced no
  hash at all, and the account it created would accept *any* such password.
  Do not remove that encoding step.
- **OCR and grading are not connected.** `processing.js` writes placeholder
  records.

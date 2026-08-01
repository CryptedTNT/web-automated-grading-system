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
│   ├── stores/app.js          Shared state (replaces App.state)
│   ├── services/
│   │   ├── database.js        localStorage CRUD (ported from ../js/database.js)
│   │   ├── theme.js           Palettes and CSS variable swapping
│   │   └── dialog.js          showMessage() / showConfirm()
│   ├── components/            HeroPanel, PasswordField, PasswordRules,
│   │                          DialogHost, PendingPage
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
| Processing | Placeholder | `js/processing.js` |
| Results | Ported | `js/results.js` |
| Student Result | Ported | `js/student_result.js` |
| Review Flagged | Ported | `js/review.js` |
| Reports | Ported | `js/reports.js` |
| Settings | Placeholder | `js/settings.js` |

Placeholder pages are reachable from the sidebar and explain which file to port.
Suggested order: Results → Student Result → Reports → Upload → Settings →
Processing, then **Answer Keys and Review Flagged last** — those two gain the
most from reactivity and are best attempted once the team is comfortable.

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
- **OCR and grading are not connected.** `processing.js` writes placeholder
  records.

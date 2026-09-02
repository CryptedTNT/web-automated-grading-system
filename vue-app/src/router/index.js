/* ============================================================
   router/index.js — replaces the PAGE_MODULES map and showPage()

   Each page the sidebar used to toggle is now a route, so screens
   have real URLs. That matters once the system is deployed: a
   tester can be sent straight to /review instead of being told
   which buttons to click.
   ============================================================ */

import { createRouter, createWebHashHistory } from 'vue-router'
import { useAppStore } from '@/stores/app.js'

/* Views are lazy-loaded so each page becomes its own chunk and the
   first paint does not wait on code the teacher has not opened. */
const routes = [
  { path: '/', redirect: '/dashboard' },

  // --- Auth screens (no sidebar shell) ---
  { path: '/setup', name: 'setup', component: () => import('@/views/AuthSetup.vue'), meta: { public: true } },
  { path: '/login', name: 'login', component: () => import('@/views/AuthLogin.vue'), meta: { public: true } },
  { path: '/forgot', name: 'forgot', component: () => import('@/views/AuthForgot.vue'), meta: { public: true } },
  // Authenticated (not `public`) so the router guard still requires sign-in,
  // but rendered bare like the auth screens — see App.vue's isAuthScreen.
  { path: '/verify-email', name: 'verify_email', component: () => import('@/views/VerifyEmailView.vue'), meta: { bare: true } },

  // --- Application pages (rendered inside the shell) ---
  { path: '/dashboard', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { title: 'Dashboard' } },
  { path: '/answer-key', name: 'answer_key', component: () => import('@/views/AnswerKeyView.vue'), meta: { title: 'Answer Keys' } },
  { path: '/upload', name: 'upload', component: () => import('@/views/UploadView.vue'), meta: { title: 'Upload Sheets' } },
  { path: '/processing', name: 'processing', component: () => import('@/views/ProcessingView.vue'), meta: { title: 'Processing' } },
  { path: '/results', name: 'results', component: () => import('@/views/ResultsView.vue'), meta: { title: 'Results' } },
  { path: '/student-result', name: 'student_result', component: () => import('@/views/StudentResultView.vue'), meta: { title: 'Student Result' } },
  { path: '/review', name: 'review', component: () => import('@/views/ReviewView.vue'), meta: { title: 'Review Flagged' } },
  { path: '/reports', name: 'reports', component: () => import('@/views/ReportsView.vue'), meta: { title: 'Reports' } },
  { path: '/how-to-use', name: 'how_to_use', component: () => import('@/views/HowToUseView.vue'), meta: { title: 'How to Use' } },
  { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { title: 'Settings' } },

  // Anything unrecognised falls back to the dashboard guard below.
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
]

const router = createRouter({
  /* Hash history keeps deep links working on static hosts that do not
     support SPA rewrites (notably GitHub Pages). Switch to
     createWebHistory() once a rewrite rule is configured. */
  history: createWebHashHistory(),
  routes,
})

/* Replaces _showStartPage(): decide where an unauthenticated visitor lands.
   Async now — auth lives behind the FastAPI backend (api.js), a network
   call rather than a synchronous localStorage read.

   The landing page is always Login, regardless of how many accounts
   exist -- Login itself links to Sign Up for a teacher who needs to
   create an account, so there's no need to branch on API.hasUser() here. */
router.beforeEach(async (to) => {
  const store = useAppStore()

  if (to.meta.public) return true
  if (store.isSignedIn) return true

  // Try the saved session cookie before bouncing to sign-in.
  if (await store.restoreRememberedUser()) return true

  return { name: 'login' }
})

export default router

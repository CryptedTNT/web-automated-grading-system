<script setup>
/* ============================================================
   App.vue — application shell (sidebar + top bar)

   Replaces the static markup in the original index.html plus the
   view/page switching in app.js. Auth screens render on their own;
   every other route renders inside the shell.
   ============================================================ */

import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app.js'
import DialogHost from '@/components/DialogHost.vue'
import AppIcon from '@/components/AppIcon.vue'

const route = useRoute()
const router = useRouter()
const store = useAppStore()

/* Auth routes are marked `public` in the router and render bare. Verify
   Email is authenticated (not `public`) but still wants the bare,
   sidebar-less look, so it's marked `bare` instead. */
const isAuthScreen = computed(() => route.meta.public === true || route.meta.bare === true)
const pageTitle = computed(() => route.meta.title || 'Workspace')

const NAV_ITEMS = [
  { name: 'dashboard', icon: 'dashboard', label: 'Dashboard', title: 'View overall grading statistics and recent system activity.' },
  { name: 'answer_key', icon: 'answerKeys', label: 'Answer Keys', title: 'Create, edit, save, and delete answer keys.' },
  { name: 'upload', icon: 'upload', label: 'Upload Sheets', title: 'Upload scanned or captured answer sheet images.' },
  { name: 'processing', icon: 'processing', label: 'Processing', title: 'Run automated grading (YOLO detection + TrOCR recognition) on the upload queue.' },
  { name: 'results', icon: 'results', label: 'Results', title: 'View grading session summaries and student scores.' },
  { name: 'student_result', icon: 'student', label: 'Student Result', title: 'View item-level results for a selected student.' },
  { name: 'review', icon: 'review', label: 'Review Flagged', title: 'Manually check flagged answers that need teacher review.' },
  { name: 'reports', icon: 'reports', label: 'Reports', title: 'Export grading sessions.' },
  { name: 'how_to_use', icon: 'help', label: 'How to Use', title: 'Open the step-by-step guide for using the system.' },
  { name: 'settings', icon: 'settings', label: 'Settings', title: 'Change account, export, template, and display settings.' },
]

/* ---------- Mobile sidebar ---------- */
const mobileOpen = ref(false)
const closeMobile = () => { mobileOpen.value = false }

// Close the drawer whenever navigation happens — the old code had to
// call closeMobileSidebar() by hand at every call site.
watch(() => route.fullPath, closeMobile)

function onKeydown(event) {
  if (event.key === 'Escape') closeMobile()
}
function onResize() {
  if (window.innerWidth > 720) closeMobile()
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
})

/* ---------- Global search ---------- */
const searchText = ref('')
watch(searchText, (value) => {
  store.searchTerm = value
  if (value.trim() && route.name !== 'results') {
    router.push({ name: 'results' })
  }
})

/* The search only applies to Results, so leaving that page clears it.
   Otherwise a stale term stayed in the box and silently re-filtered —
   and re-selected a different session — the next time Results opened. */
watch(
  () => route.name,
  (name, previous) => {
    if (previous === 'results' && name !== 'results') {
      searchText.value = ''
      store.searchTerm = ''
    }
  },
)

/* ---------- Logout ---------- */
async function logout() {
  await store.signOut()
  router.push({ name: 'login', query: { status: 'loggedout' } })
}
</script>

<template>
  <div id="app-root">
    <!-- Auth screens: no sidebar, no top bar -->
    <main v-if="isAuthScreen" class="auth-view active">
      <RouterView />
    </main>

    <!-- Application shell -->
    <div v-else id="shell" class="active">
      <nav
        id="sidebar"
        :class="{ 'mobile-open': mobileOpen }"
        aria-label="Primary navigation"
      >
        <!-- .sidebar-title is `white-space: pre-line`, so this newline is
             intentional. Bound from JS so the template compiler's whitespace
             handling cannot collapse it. -->
        <div class="brand-lockup">
          <div class="brand-mark" aria-hidden="true"><span>A</span><span>G</span></div>
          <div>
            <div class="sidebar-title">{{ 'Automated\nGrading System' }}</div>
            <div class="sidebar-subtitle">Assessment workspace</div>
          </div>
        </div>

        <div class="nav-kicker">Workspace</div>

        <div class="sidebar-nav">
          <RouterLink
            v-for="item in NAV_ITEMS"
            :key="item.name"
            v-slot="{ navigate, isActive }"
            :to="{ name: item.name }"
            custom
          >
            <button
              class="sidebar-btn"
              :class="{ active: isActive }"
              :title="item.title"
              @click="navigate"
            >
              <span class="nav-icon"><AppIcon :name="item.icon" /></span>
              <span>{{ item.label }}</span>
            </button>
          </RouterLink>
        </div>

        <div class="sidebar-spacer"></div>
        <div class="sidebar-account">
          <span class="account-avatar" aria-hidden="true">{{ store.teacherLabel?.charAt(0) || 'T' }}</span>
          <span class="sidebar-user">{{ store.teacherLabel }}</span>
        </div>
        <button
          class="logout-btn"
          title="Sign out and return to the login page."
          @click="logout"
        >
          <span class="nav-icon"><AppIcon name="logout" /></span> Logout
        </button>
      </nav>

      <div id="content-root">
        <div id="top-bar">
          <button
            type="button"
            class="mobile-menu-btn"
            aria-label="Open navigation"
            aria-controls="sidebar"
            :aria-expanded="String(mobileOpen)"
            @click="mobileOpen = !mobileOpen"
          >
            ☰
          </button>
          <div class="top-heading">
            <span class="top-eyebrow">Assessment workspace</span>
            <span class="top-title">{{ pageTitle }}</span>
          </div>
          <div class="top-spacer"></div>
          <input
            v-model="searchText"
            type="text"
            class="top-search"
            placeholder="Search student, section, answer key..."
            title="Search grading results by student name, section, or answer key."
            aria-label="Search grading results by student name, section, or answer key"
          >
          <span class="top-teacher">{{ store.teacherLabel }}</span>
        </div>

        <main id="pages-container" @click="closeMobile">
          <!-- `key` forces a fresh component per route, matching the old
               one-page-visible-at-a-time behaviour. -->
          <RouterView v-slot="{ Component }">
            <component :is="Component" :key="route.name" class="page active" />
          </RouterView>
        </main>
      </div>
    </div>

    <!-- Mounted once for the whole app; any page can call showMessage(). -->
    <DialogHost />
  </div>
</template>

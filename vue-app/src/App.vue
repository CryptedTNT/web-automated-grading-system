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
import { DB } from '@/services/database.js'
import DialogHost from '@/components/DialogHost.vue'

const route = useRoute()
const router = useRouter()
const store = useAppStore()

/* Auth routes are marked `public` in the router and render bare. */
const isAuthScreen = computed(() => route.meta.public === true)

const NAV_ITEMS = [
  { name: 'dashboard', icon: '▦', label: 'Dashboard', title: 'View overall grading statistics and recent system activity.' },
  { name: 'answer_key', icon: '▣', label: 'Answer Keys', title: 'Create, edit, save, and delete answer keys.' },
  { name: 'upload', icon: '⇧', label: 'Upload Sheets', title: 'Upload scanned or captured answer sheet images.' },
  { name: 'processing', icon: '⚙', label: 'Processing', title: 'Start placeholder processing and create model-ready records.' },
  { name: 'results', icon: '☑', label: 'Results', title: 'View grading session summaries and student scores.' },
  { name: 'student_result', icon: '◫', label: 'Student Result', title: 'View item-level results for a selected student.' },
  { name: 'review', icon: '⚑', label: 'Review Flagged', title: 'Manually check flagged answers that need teacher review.' },
  { name: 'reports', icon: '▤', label: 'Reports', title: 'Export grading sessions.' },
  { name: 'how_to_use', icon: '?', label: 'How to Use', title: 'Open the step-by-step guide for using the system.' },
  { name: 'settings', icon: '⚙', label: 'Settings', title: 'Change account, export, template, and display settings.' },
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

/* ---------- Logout ---------- */
function logout() {
  store.signOut()
  router.push(
    DB.hasUser()
      ? { name: 'login', query: { status: 'loggedout' } }
      : { name: 'setup' },
  )
}
</script>

<template>
  <div id="app-root">
    <!-- Auth screens: no sidebar, no top bar -->
    <div v-if="isAuthScreen" class="auth-view active">
      <RouterView />
    </div>

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
        <div class="sidebar-title">{{ 'Automated\nGrading System' }}</div>
        <div class="sidebar-subtitle">Handwritten Objective Exams</div>

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
              {{ item.icon }}&nbsp; {{ item.label }}
            </button>
          </RouterLink>
        </div>

        <div class="sidebar-spacer"></div>
        <div class="sidebar-user">{{ store.teacherLabel }}</div>
        <button
          class="logout-btn"
          title="Sign out and return to the login page."
          @click="logout"
        >
          ↩&nbsp; Logout
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
          <span class="top-title">Automated Grading System</span>
          <div class="top-spacer"></div>
          <input
            v-model="searchText"
            type="text"
            class="top-search"
            placeholder="Search student, section, answer key..."
            title="Search grading results by student name, section, or answer key."
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

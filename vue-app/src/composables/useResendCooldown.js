/* ============================================================
   useResendCooldown.js — a ticking mm:ss countdown for "resend code"
   buttons.

   This is a UI mirror, not the enforcement -- the backend is the real
   gatekeeper (see backend/app/routers/auth.py's RESEND_COOLDOWN /
   _require_not_cooling_down). Call start(300) optimistically right
   after a successful send, or start(e.retryAfterSeconds) when a 429
   response says a code was already sent recently (e.g. this page was
   reloaded mid-cooldown) -- see api.js's request() for where
   retryAfterSeconds comes from.
   ============================================================ */

import { ref, computed, onUnmounted } from 'vue'

export function useResendCooldown() {
  const secondsLeft = ref(0)
  let timer = null

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function start(seconds) {
    stop()
    secondsLeft.value = Math.max(0, Math.round(seconds || 0))
    if (secondsLeft.value <= 0) return
    timer = setInterval(() => {
      secondsLeft.value -= 1
      if (secondsLeft.value <= 0) stop()
    }, 1000)
  }

  onUnmounted(stop)

  const active = computed(() => secondsLeft.value > 0)
  const formatted = computed(() => {
    const m = Math.floor(secondsLeft.value / 60)
    const s = secondsLeft.value % 60
    return `${m}:${String(s).padStart(2, '0')}`
  })

  return { secondsLeft, active, formatted, start, stop }
}

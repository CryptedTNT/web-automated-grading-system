<script setup>
defineProps({
  footerText: { type: String, default: 'Web-based prototype' },
})
</script>

<template>
  <div class="hero-panel">
    <div class="hero-brand">
      <div class="hero-icon" aria-hidden="true"><span>A</span><span>G</span></div>
      <span class="hero-eyebrow">AGS</span>
    </div>
    <div class="hero-kicker">Teacher workspace</div>
    <div class="hero-title"><span>Automated</span> <span>Grading System</span></div>
    <div class="hero-subtitle"><span>A focused workspace for handwritten</span> <span>objective examinations.</span></div>
    <div class="hero-footer">{{ footerText }}</div>
  </div>
</template>

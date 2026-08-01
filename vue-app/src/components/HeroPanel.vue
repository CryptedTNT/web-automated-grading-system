<script setup>
defineProps({
  footerText: { type: String, default: 'Web-based prototype' },
})
</script>

<template>
  <div class="hero-panel">
    <div class="hero-icon">▣</div>
    <div class="hero-title"><span>Automated</span> <span>Grading System</span></div>
    <div class="hero-subtitle"><span>For Handwritten Objective</span> <span>Examinations</span></div>
    <div class="hero-footer">{{ footerText }}</div>
  </div>
</template>

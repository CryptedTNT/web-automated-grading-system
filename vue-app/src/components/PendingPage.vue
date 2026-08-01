<script setup>
/* Placeholder for a page that has not been ported yet.
   Keeps every route reachable so the shell, navigation, and layout
   can be tested end to end before all ten pages exist. Delete this
   component once the last view is ported. */

defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  sourceFile: { type: String, required: true },
})
</script>

<template>
  <div>
    <div class="title-block">
      <div class="page-title">{{ title }}</div>
      <div class="page-subtitle">{{ subtitle }}</div>
    </div>

    <div class="card">
      <div class="card-title">Not ported yet</div>
      <div class="muted-text" style="line-height:1.7;">
        This page still lives in the original app. Port it from
        <strong>js/{{ sourceFile }}</strong> into this component.
        <br><br>
        The data layer is already available here — import
        <strong>{ DB } from '@/services/database.js'</strong> and the
        existing functions work unchanged.
      </div>
    </div>
  </div>
</template>

<script setup>
/* ============================================================
   PaginationBar.vue — the per-page size filter (10/30/50/100) plus
   prev/next paging, for any table or list driven by usePagination().

   Pairs with v-model:page and v-model:pageSize on the composable's own
   `page`/`pageSize` refs, so a view just does:
     <PaginationBar v-model:page="pg.page" v-model:pageSize="pg.pageSize"
       :page-count="pg.pageCount" :total="pg.total"
       :range-start="pg.rangeStart" :range-end="pg.rangeEnd" item-label="session" />
   ============================================================ */

defineProps({
  page: { type: Number, required: true },
  pageSize: { type: Number, required: true },
  pageCount: { type: Number, required: true },
  total: { type: Number, required: true },
  rangeStart: { type: Number, required: true },
  rangeEnd: { type: Number, required: true },
  pageSizeOptions: { type: Array, default: () => [10, 30, 50, 100] },
  itemLabel: { type: String, default: 'item' },
  disabled: { type: Boolean, default: false },
})

defineEmits(['update:page', 'update:pageSize'])
</script>

<template>
  <div v-if="total > 0" class="pagination-bar no-print">
    <span class="pagination-info">
      Showing {{ rangeStart }}&ndash;{{ rangeEnd }} of {{ total }} {{ itemLabel }}{{ total === 1 ? '' : 's' }}
    </span>
    <div class="pagination-controls">
      <label class="pagination-size">
        Per page
        <select
          :value="pageSize"
          :disabled="disabled"
          @change="$emit('update:pageSize', Number($event.target.value))"
        >
          <option v-for="size in pageSizeOptions" :key="size" :value="size">{{ size }}</option>
        </select>
      </label>
      <div class="pagination-nav">
        <button
          type="button" class="btn btn-secondary btn-small"
          :disabled="disabled || page <= 1"
          aria-label="First page"
          @click="$emit('update:page', 1)"
        >
          &laquo;
        </button>
        <button
          type="button" class="btn btn-secondary btn-small"
          :disabled="disabled || page <= 1"
          aria-label="Previous page"
          @click="$emit('update:page', page - 1)"
        >
          &lsaquo; Prev
        </button>
        <span class="pagination-page" aria-live="polite">Page {{ page }} of {{ pageCount }}</span>
        <button
          type="button" class="btn btn-secondary btn-small"
          :disabled="disabled || page >= pageCount"
          aria-label="Next page"
          @click="$emit('update:page', page + 1)"
        >
          Next &rsaquo;
        </button>
        <button
          type="button" class="btn btn-secondary btn-small"
          :disabled="disabled || page >= pageCount"
          aria-label="Last page"
          @click="$emit('update:page', pageCount)"
        >
          &raquo;
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--card-border);
  color: var(--text-muted);
  font-size: 12.5px;
  /* This sits in containers as narrow as a ~220px sidebar card, not just
     wide tables -- without an explicit width cap, a flex item's default
     min-width:auto lets its content's natural size push it past the
     card's edge instead of wrapping to fit. */
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
.pagination-controls { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; min-width: 0; }
.pagination-size { display: flex; align-items: center; gap: 6px; }
.pagination-size select { padding: 4px 6px; }
/* Five buttons (First/Prev/page label/Next/Last) in one unbreakable row
   is itself wider than a narrow sidebar -- these must be able to wrap
   onto their own additional lines, not just drop to a new line as a
   single unbroken group. */
.pagination-nav { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: center; }
.pagination-page { min-width: 70px; text-align: center; }
@media (max-width: 520px) {
  .pagination-bar { justify-content: center; text-align: center; }
}
</style>

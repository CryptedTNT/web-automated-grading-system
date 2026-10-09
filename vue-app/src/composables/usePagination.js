/* ============================================================
   usePagination.js — client-side paging over an already-filtered list.

   The teacher picks how many rows to see per page (10/30/50/100, per
   PAGE_SIZE_OPTIONS); this only slices whatever list the caller already
   computed from its own filters/search, it does not know or care what
   produced that list.

   Policy for where the page lands when the list itself changes (a
   search term, a filter, or a bulk delete all do this):
     - Changing the page size always returns to page 1 -- the page/row
       math would otherwise be confusing to reconstruct.
     - A list that merely got shorter (filtering, deletion) clamps the
       current page into the new range instead of resetting to page 1,
       so deleting a row on page 3 does not throw the teacher back to
       page 1 while they are still working through a long list.
     - Callers that know a NEW query just replaced the list outright
       (for example, switching the Reports page between session view
       and student view) should call reset() explicitly.
   ============================================================ */

import { computed, ref, watch } from 'vue'

export const PAGE_SIZE_OPTIONS = [10, 30, 50, 100]
export const DEFAULT_PAGE_SIZE = 10

export function usePagination(itemsRef, { defaultPageSize = DEFAULT_PAGE_SIZE } = {}) {
  const page = ref(1)
  const pageSize = ref(defaultPageSize)

  const total = computed(() => itemsRef.value.length)
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

  watch(total, () => {
    if (page.value > pageCount.value) page.value = pageCount.value
  })
  watch(pageSize, () => {
    page.value = 1
  })

  const pageItems = computed(() => {
    const start = (page.value - 1) * pageSize.value
    return itemsRef.value.slice(start, start + pageSize.value)
  })

  const rangeStart = computed(() => (total.value === 0 ? 0 : (page.value - 1) * pageSize.value + 1))
  const rangeEnd = computed(() => Math.min(total.value, page.value * pageSize.value))

  function goToPage(target) {
    page.value = Math.min(Math.max(1, target), pageCount.value)
  }
  function reset() {
    page.value = 1
  }

  return { page, pageSize, pageCount, total, pageItems, rangeStart, rangeEnd, goToPage, reset, pageSizeOptions: PAGE_SIZE_OPTIONS }
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { nextTick, ref } from 'vue'
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, usePagination } from '../src/composables/usePagination.js'

function makeItems(count) {
  return Array.from({ length: count }, (_, i) => i + 1)
}

test('page size options are exactly 10/30/50/100, defaulting to 10', () => {
  assert.deepEqual(PAGE_SIZE_OPTIONS, [10, 30, 50, 100])
  assert.equal(DEFAULT_PAGE_SIZE, 10)
})

test('slices the current page and reports an accurate range', () => {
  const items = ref(makeItems(25))
  const pg = usePagination(items)
  assert.equal(pg.pageCount.value, 3)
  assert.deepEqual(pg.pageItems.value, makeItems(10))
  assert.equal(pg.rangeStart.value, 1)
  assert.equal(pg.rangeEnd.value, 10)

  pg.goToPage(3)
  assert.deepEqual(pg.pageItems.value, [21, 22, 23, 24, 25])
  assert.equal(pg.rangeStart.value, 21)
  assert.equal(pg.rangeEnd.value, 25)
})

test('goToPage clamps to the valid range', () => {
  const items = ref(makeItems(25))
  const pg = usePagination(items)
  pg.goToPage(999)
  assert.equal(pg.page.value, 3)
  pg.goToPage(-5)
  assert.equal(pg.page.value, 1)
})

test('changing page size returns to page 1', async () => {
  const items = ref(makeItems(120))
  const pg = usePagination(items)
  pg.goToPage(5)
  assert.equal(pg.page.value, 5)
  pg.pageSize.value = 50
  await nextTick()
  assert.equal(pg.page.value, 1)
  assert.equal(pg.pageCount.value, 3)
})

test('a shrinking list clamps the current page instead of resetting to 1', async () => {
  const items = ref(makeItems(25))
  const pg = usePagination(items)
  pg.goToPage(3)
  assert.equal(pg.page.value, 3)
  items.value = makeItems(12) // now only 2 pages at the default size of 10
  await nextTick()
  assert.equal(pg.page.value, 2)
  assert.deepEqual(pg.pageItems.value, [11, 12])
})

test('an empty list is one empty page, not a division error', () => {
  const items = ref([])
  const pg = usePagination(items)
  assert.equal(pg.pageCount.value, 1)
  assert.equal(pg.total.value, 0)
  assert.equal(pg.rangeStart.value, 0)
  assert.equal(pg.rangeEnd.value, 0)
  assert.deepEqual(pg.pageItems.value, [])
})

test('reset() returns to page 1 on demand, for callers that replace the list outright', () => {
  const items = ref(makeItems(30))
  const pg = usePagination(items)
  pg.goToPage(2)
  pg.reset()
  assert.equal(pg.page.value, 1)
})

test('a custom default page size is honored', () => {
  const items = ref(makeItems(60))
  const pg = usePagination(items, { defaultPageSize: 50 })
  assert.equal(pg.pageSize.value, 50)
  assert.equal(pg.pageCount.value, 2)
})

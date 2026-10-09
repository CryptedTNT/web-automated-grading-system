import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Run the real browser export service with API/download boundaries stubbed.
async function loadExportService(API, showMessage) {
  API.getSettings ??= async () => ({})
  globalThis.sectionExportTest = { API, showMessage }
  const source = (await readFile(new URL('../src/services/export.js', import.meta.url), 'utf8'))
    .replace("import { API } from '@/services/api.js'", 'const { API } = globalThis.sectionExportTest')
    .replace("import { showMessage } from '@/services/dialog.js'", 'const { showMessage } = globalThis.sectionExportTest')
    .replace("'./sectionExport.js'", JSON.stringify(new URL('../src/services/sectionExport.js', import.meta.url).href))
    .replace("'./sections.js'", JSON.stringify(new URL('../src/services/sections.js', import.meta.url).href))
    .replace("'./gradingScale.js'", JSON.stringify(new URL('../src/services/gradingScale.js', import.meta.url).href))
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`)
}

test('section download contains only matching summaries and items, with safe cells and session context', async () => {
  const writes = []
  const itemRequests = []
  const sessionRequests = []
  globalThis.XLSX = {
    utils: {
      book_new: () => ({}),
      aoa_to_sheet: rows => rows,
      book_append_sheet: (book, sheet, name) => { book[name] = sheet },
    },
    writeFile: (book, filename) => writes.push({ book, filename }),
  }
  const API = {
    sessions: async () => [
      { id: 1, answer_key_id: 4, answer_key_name: 'Quiz/One', status: 'Completed', created_at: '2026-10-01' },
      { id: 2, answer_key_id: 4, answer_key_name: 'Quiz/One', status: 'Completed', created_at: '2026-10-02' },
      { id: 3, answer_key_id: 5, status: 'Completed' },
      { id: 4, answer_key_id: 4, status: 'Processing' },
    ],
    studentResults: async id => {
      sessionRequests.push(id)
      return [
        { id: id * 10, student_name: '=unsafe', section: 'BSCS 1A', score: 2.5, total: 3, percentage: 83.33, flagged_count: 0, status: 'OK' },
        { id: id * 10 + 1, section: 'BSCS 1B' },
      ]
    },
    getExportPreferences: async () => ({ include_student_info: true, include_total_score: true,
      include_item_scores: true, include_flagged_notes: true, include_question_type: true }),
    resultItems: async id => {
      itemRequests.push(id)
      return [{ item_no: 1, type: 'Identification', student_answer: '+formula', points: 3, earned: 2.5, status: 'partial' }]
    },
  }
  try {
    const { exportSectionToFile } = await loadExportService(API, async () => {})
    await exportSectionToFile(4, 'BSCS 1-A')
    assert.deepEqual(sessionRequests, [1, 2])
    assert.deepEqual(itemRequests, [10, 20])
    assert.equal(writes.length, 1)
    const { book, filename } = writes[0]
    assert.match(filename, /^Quiz_One_BSCS_1-A_\d{4}-\d{2}-\d{2}\.xlsx$/)
    assert.equal(book.Results.length, 3)
    assert.equal(book['Item Details'].length, 3)
    assert.ok(book.Results[1].includes("'=unsafe"))
    assert.ok(book.Results[1].includes('BSCS 1-A'))
    assert.ok(book['Item Details'][1].includes("'+formula"))
    assert.ok(book['Item Details'][1].includes(2.5))
    assert.deepEqual(book.Results.slice(1).map(row => row[1]), [1, 2])
    sessionRequests.length = 0
    itemRequests.length = 0
    await exportSectionToFile(4, 'BSCS 1A', { sessionIds: [2] })
    assert.deepEqual(sessionRequests, [2], 'date-filtered export reads only visible sessions')
    assert.deepEqual(itemRequests, [20])
    assert.equal(writes.length, 2)
    assert.equal(writes[1].book.Results.length, 2)
    API.resultItems = async () => { throw new Error('Network failure') }
    await assert.rejects(exportSectionToFile(4, 'BSCS 1A'), /Network failure/)
    assert.equal(writes.length, 2, 'does not download a partial report after failed item reads')
    await exportSectionToFile(4, 'BSCS 3A')
    assert.equal(writes.length, 2, 'empty section does not download')
  } finally {
    delete globalThis.XLSX
    delete globalThis.sectionExportTest
  }
})

test('selected students across source groups export together once, in selection order, without session columns', async () => {
  const writes = []
  const itemRequests = []
  const groups = [
    { id: 1, answer_key_id: 4, answer_key_name: 'Quiz', status: 'Completed', created_at: '2026-10-01' },
    { id: 2, answer_key_id: 4, answer_key_name: 'Quiz', status: 'Completed', created_at: '2026-10-02' },
  ]
  const a = { id: 10, student_name: 'Amy', section: 'BSCS 1A', score: 2.5, total: 3, percentage: 83.33, session: groups[0] }
  const b = { id: 20, student_name: 'Bob', section: 'BSCS 1 - A', score: 2, total: 3, percentage: 66.67, session: groups[1] }
  const unselected = { ...a, id: 11, student_name: 'Not Selected' }
  globalThis.XLSX = {
    utils: { book_new: () => ({}), aoa_to_sheet: rows => rows,
      book_append_sheet: (book, sheet, name) => { book[name] = sheet } },
    writeFile: (book, filename) => writes.push({ book, filename }),
  }
  const API = {
    sessions: async () => groups,
    studentResults: async id => id === 1 ? [a, unselected] : [b],
    // A CSV preference must not override this button's Excel promise.
    getExportPreferences: async () => ({ filename_format: 'report.csv', include_student_info: false,
      include_total_score: false, include_item_scores: true }),
    resultItems: async id => { itemRequests.push(id); return [{ item_no: 1, earned: id === 10 ? 2.5 : 2, points: 3 }] },
  }
  try {
    const { exportStudentsToFile } = await loadExportService(API, async () => {})
    await exportStudentsToFile([b, a, b])
    assert.equal(writes.length, 1, 'exactly one workbook download, even across groups')
    assert.match(writes[0].filename, /\.xlsx$/)
    const summary = writes[0].book.Results
    assert.equal(summary.length, 3)
    assert.ok(!summary[0].includes('Session ID'))
    assert.ok(summary[0].includes('Questionnaire'))
    const nameColumn = summary[0].indexOf('Student Name')
    assert.deepEqual(summary.slice(1).map(row => row[nameColumn]), ['Bob', 'Amy'])
    assert.deepEqual(itemRequests, [20, 10], 'only selected students get item details')
    assert.equal(writes[0].book['Item Details'].length, 3)
    assert.ok(summary[2].includes(2.5), 'saved partial scores are included')
    API.studentResults = async () => [a]
    await assert.rejects(exportStudentsToFile([b, a]), /no longer available/)
    assert.equal(writes.length, 1, 'missing selected student fails the entire export')
    API.sessions = async () => []
    await assert.rejects(exportStudentsToFile([a]), /no longer available/)
    assert.equal(writes.length, 1)
    await exportStudentsToFile([])
    assert.equal(writes.length, 1, 'no selection cannot export')
  } finally {
    delete globalThis.XLSX
    delete globalThis.sectionExportTest
  }
})

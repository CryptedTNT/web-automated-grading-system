/* ============================================================
   services/processing.js — model-ready placeholder adapter
   Ported from the ProcessingAdapter IIFE in js/processing.js.

   Deliberately free of Vue imports: this is the seam where the real
   OCR/grading model will be plugged in, so it stays a plain async
   function over (files, answerKeyItems) with progress callbacks.
   Swap the body of _createPlaceholderResult() — and nothing else —
   once the model is connected.
   ============================================================ */

export const MODEL_NAME = 'Model Pending Placeholder'

export async function runProcessingJob(files, answerKeyItems, callbacks = {}) {
  const results = []

  try {
    for (let index = 0; index < files.length; index += 1) {
      /* Checked between files rather than mid-file so a cancelled run
         never leaves a half-written record behind. */
      if (callbacks.shouldCancel?.()) {
        callbacks.onCancel?.({ completed: results.length, total: files.length, results })
        return results
      }

      const entry = files[index]
      const rawFile = entry?.file || entry
      if (entry?.simulateProcessingError || rawFile?.simulateProcessingError) {
        throw new Error(`Placeholder processing failed for ${fileName(entry)}.`)
      }

      const context = { index, total: files.length, file: entry }
      callbacks.onFileStart?.(context)
      callbacks.onLog?.({ ...context, level: 'info', message: `Preparing ${fileName(entry)}.` })
      await delay(180)

      const result = createPlaceholderResult(entry, answerKeyItems)
      results.push(result)
      callbacks.onFileComplete?.({ ...context, result })

      const completed = index + 1
      callbacks.onProgress?.({
        ...context,
        completed,
        percent: Math.round((completed / files.length) * 100),
        result,
      })
      callbacks.onLog?.({
        ...context,
        level: 'success',
        message: `Placeholder record created for ${fileName(entry)}.`,
      })
    }

    callbacks.onComplete?.({ total: files.length, results })
    return results
  } catch (error) {
    callbacks.onError?.({ error, completed: results.length, total: files.length })
    throw error
  }
}

/* Every item comes back Flagged and worth zero, so nothing a
   placeholder produced can be mistaken for a real grade. */
function createPlaceholderResult(entry, answerKeyItems) {
  const name = fileName(entry)
  const total = answerKeyItems.reduce((sum, item) => sum + (Number(item.points) || 0), 0)
  return {
    student_name: name.replace(/\.[^.]+$/, '') || 'Model Pending Student',
    section: 'Model Pending',
    image_path: entry?.relativePath || name,
    score: 0,
    total,
    percentage: 0,
    flagged_count: answerKeyItems.length,
    status: 'Flagged',
    items: answerKeyItems.map((item) => ({
      item_no: item.item_no,
      type: item.type,
      enum_group: item.enum_group,
      student_answer: '[Model pending]',
      correct_answer: item.correct_answer,
      alternatives: item.alternatives,
      match_score: 0,
      points: Number(item.points) || 0,
      earned: 0,
      status: 'Flagged',
      auto_status: 'Flagged',
      remarks: 'Placeholder record. OCR and grading models are not connected yet.',
      model_used: MODEL_NAME,
      confidence: 0,
    })),
  }
}

function fileName(entry) {
  return String(entry?.name || entry?.file?.name || 'answer-sheet')
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

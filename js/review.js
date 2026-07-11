/* ============================================================
   review.js - Manual review progression for flagged items
   ============================================================ */

const Review = (() => {
  let currentItem = null;
  let notice = '';
  let lastReviewedResultId = null;
  let reviewSessionId = null;

  function render() { /* rendered by refresh */ }

  function refresh() {
    const el = document.getElementById('page-review');
    if (!el) return;

    const sessionId = App.state.currentSessionId;
    if (reviewSessionId !== sessionId) {
      reviewSessionId = sessionId;
      lastReviewedResultId = null;
      notice = '';
    }
    const selectedResult = App.state.selectedStudentResultId
      ? DB.getStudentResultById(App.state.selectedStudentResultId)
      : null;
    const validResultId = selectedResult?.session_id === sessionId ? selectedResult.id : null;
    currentItem = DB.getFirstFlaggedItem(validResultId, sessionId);

    if (!currentItem) {
      _renderComplete(el, sessionId);
      return;
    }

    const result = DB.getStudentResultById(currentItem.student_result_id);
    App.state.selectedStudentResultId = result?.id || null;
    const autoStatus = currentItem.auto_status || currentItem.status;

    el.innerHTML = `
      <div class="title-block">
        <div class="page-title">Review Flagged Answer</div>
        <div class="page-subtitle">Session #${sessionId || '-'} - ${_esc(result?.student_name || 'Unknown Student')} - Item ${currentItem.item_no}</div>
      </div>

      ${notice ? `<div class="inline-notice success-notice">${_esc(notice)}</div>` : ''}

      <div class="workflow-layout review-layout">
        <section class="card workflow-main">
          <div class="review-meta">
            <span class="badge badge-warning">Flagged</span>
            <span>${_esc(currentItem.type || 'Question')}</span>
            ${currentItem.enum_group ? `<span>Group ${_esc(currentItem.enum_group)}</span>` : ''}
          </div>
          <div class="comparison-row">
            <div class="comparison-card">
              <div class="card-title">Extracted Answer</div>
              <div class="big-answer">${_esc(currentItem.student_answer || '[blank]')}</div>
            </div>
            <div class="comparison-card">
              <div class="card-title">Correct Answer</div>
              <div class="big-answer">${_esc(currentItem.correct_answer || '[not set]')}</div>
            </div>
          </div>
          <dl class="review-details">
            <div><dt>Automatic result</dt><dd><span class="badge ${_statusClass(autoStatus)}">${_esc(autoStatus)}</span></dd></div>
            <div><dt>Match score</dt><dd>${_number(currentItem.match_score)}%</dd></div>
            <div><dt>Points</dt><dd>${_number(currentItem.points)}</dd></div>
            <div><dt>Model</dt><dd>${_esc(currentItem.model_used || 'Not recorded')}</dd></div>
          </dl>
          ${currentItem.remarks ? `<div class="remarks-box"><strong>Remarks</strong><span>${_esc(currentItem.remarks)}</span></div>` : ''}
        </section>

        <aside class="card workflow-sidebar">
          <div class="card-title">Choose Action</div>
          <div class="radio-group" id="review-actions">
            <label><input type="radio" name="rev-action" value="accept"> Accept as correct</label>
            <label><input type="radio" name="rev-action" value="wrong"> Mark as incorrect</label>
            <label><input type="radio" name="rev-action" value="override" checked> Override extracted answer</label>
          </div>
          <div class="form-group mt-14">
            <label class="form-label" for="rev-override">Manual Answer</label>
            <input type="text" id="rev-override" value="${_esc(currentItem.correct_answer)}">
          </div>
          <div class="workflow-actions vertical-actions">
            <button class="btn btn-primary w-full" id="rev-save-btn">Save and Continue</button>
            <button class="btn btn-secondary w-full" id="rev-back-btn">Back to Results</button>
          </div>
        </aside>
      </div>
    `;

    notice = '';
    el.querySelectorAll('input[name="rev-action"]').forEach(input => input.addEventListener('change', _syncManualInput));
    el.querySelector('#rev-save-btn')?.addEventListener('click', saveOverride);
    el.querySelector('#rev-back-btn')?.addEventListener('click', () => App.showPage('results'));
  }

  function _renderComplete(el, sessionId) {
    const title = lastReviewedResultId ? 'Review Complete' : 'No Flagged Answers';
    const message = lastReviewedResultId
      ? 'All flagged items in this session have been reviewed.'
      : 'There are no flagged items in the selected session.';
    el.innerHTML = `
      <div class="title-block">
        <div class="page-title">${title}</div>
        <div class="page-subtitle">Session #${sessionId || '-'}</div>
      </div>
      <section class="card review-complete">
        <div class="completion-mark" aria-hidden="true">&#10003;</div>
        <div class="section-title">${message}</div>
        <div class="muted-text mt-8">Scores and flagged counts reflect the latest manual decisions.</div>
        <div class="workflow-actions justify-center">
          <button class="btn btn-primary" id="rev-results-btn">Back to Results</button>
          ${lastReviewedResultId ? '<button class="btn btn-secondary" id="rev-student-btn">Open Last Student</button>' : ''}
        </div>
      </section>`;
    el.querySelector('#rev-results-btn')?.addEventListener('click', () => App.showPage('results'));
    el.querySelector('#rev-student-btn')?.addEventListener('click', () => {
      App.state.selectedStudentResultId = lastReviewedResultId;
      App.showPage('student_result');
    });
  }

  function _syncManualInput() {
    const action = document.querySelector('input[name="rev-action"]:checked')?.value;
    const input = document.getElementById('rev-override');
    if (input) input.disabled = action !== 'override';
  }

  async function saveOverride() {
    if (!currentItem) return;
    const action = document.querySelector('input[name="rev-action"]:checked')?.value || 'override';
    const manualInput = document.getElementById('rev-override');
    const originalAutoStatus = currentItem.auto_status || currentItem.status;
    const originalMatch = _number(currentItem.match_score);
    let updates;

    if (action === 'accept') {
      updates = {
        earned: _number(currentItem.points),
        status: 'OK',
        manual_override: 1,
        override_action: 'accepted_correct',
        remarks: `Manual review: accepted as correct. Automatic result was ${originalAutoStatus} at ${originalMatch}% match.`,
      };
    } else if (action === 'wrong') {
      updates = {
        earned: 0,
        status: 'Wrong',
        manual_override: 1,
        override_action: 'marked_incorrect',
        remarks: `Manual review: marked incorrect. Automatic result was ${originalAutoStatus} at ${originalMatch}% match.`,
      };
    } else {
      const answer = manualInput?.value.trim() || '';
      manualInput?.classList.remove('invalid');
      if (!answer) {
        manualInput?.classList.add('invalid');
        await App.showMessage('Manual Answer Required', 'Enter the corrected answer before saving.');
        manualInput?.focus();
        return;
      }
      updates = {
        student_answer: answer,
        earned: _number(currentItem.points),
        status: 'OK',
        match_score: 100,
        manual_override: 1,
        override_action: 'manual_answer_override',
        remarks: `Manual review: answer changed to '${answer}' and accepted as correct. Automatic result was ${originalAutoStatus} at ${originalMatch}% match.`,
      };
    }

    const reviewedResultId = currentItem.student_result_id;
    DB.updateResultItem(currentItem.id, updates);
    DB.recalculateStudentResult(reviewedResultId);
    lastReviewedResultId = reviewedResultId;

    const nextItem = DB.getFirstFlaggedItem(reviewedResultId, App.state.currentSessionId);
    if (nextItem) {
      App.state.selectedStudentResultId = nextItem.student_result_id;
      notice = 'Review saved. The next flagged item is ready.';
    } else {
      App.state.selectedStudentResultId = reviewedResultId;
      notice = '';
    }
    refresh();
  }

  function _statusClass(status) {
    if (status === 'OK') return 'badge-success';
    if (status === 'Flagged') return 'badge-warning';
    if (status === 'Wrong') return 'badge-danger';
    return 'badge-gray';
  }

  function _number(value) {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  function _esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return { render, refresh };
})();

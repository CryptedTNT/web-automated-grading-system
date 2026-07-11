/* ============================================================
   review.js — Review flagged items
   ============================================================ */

const Review = (() => {
  let currentItem = null;

  function render() { /* rendered in refresh */ }

  function refresh() {
    const el = document.getElementById('page-review');
    if (!el) return;

    const rid = App.state.selectedStudentResultId;
    const sid = App.state.currentSessionId;
    let item = DB.getFirstFlaggedItem(rid, sid);
    currentItem = item;

    if (!item) {
      el.innerHTML = `
        <div class="title-block">
          <div class="page-title">Review Flagged Answer</div>
          <div class="page-subtitle">Manual override workflow</div>
        </div>
        <div class="flex gap-16" style="align-items:flex-start;">
          <div class="card flex-2">
            <div class="card-title">Extracted Answer Recognition Details</div>
            <div class="muted-text" style="padding:24px;text-align:center;">No flagged answers found.</div>
          </div>
          <div class="card flex-1">
            <div class="card-title">Choose Action</div>
            <button class="btn btn-secondary w-full" id="rev-back-btn">Back to Results</button>
          </div>
        </div>`;
      document.getElementById('rev-back-btn')?.addEventListener('click', () => App.showPage('results'));
      return;
    }

    const autoStatus = item.auto_status || item.status;
    const finalStatus = item.status;
    const manual = item.manual_override ? true : false;
    const action = item.override_action || '';

    el.innerHTML = `
      <div class="title-block">
        <div class="page-title">Review Flagged Answer</div>
        <div class="page-subtitle">Manual override workflow</div>
      </div>
      <div class="flex gap-16" style="align-items:flex-start;">
        <div class="card flex-2">
          <div class="card-title">Extracted Answer Recognition Details</div>
          <div class="muted-text mb-8">Question #: ${item.item_no} &nbsp;•&nbsp; Question Type: ${item.type}</div>
          <div class="muted-text mb-8">Auto Result: <span class="badge ${autoStatus === 'Flagged' ? 'badge-warning' : 'badge-gray'}">${autoStatus}</span> &nbsp;•&nbsp; Final Result: <span class="badge ${finalStatus === 'Flagged' ? 'badge-warning' : finalStatus === 'OK' ? 'badge-success' : 'badge-danger'}">${finalStatus}</span></div>
          ${manual ? `<div class="muted-text mb-8">Manual Override: ${action || 'applied'}</div>` : ''}
          <div class="comparison-row">
            <div class="comparison-card">
              <div class="card-title">Extracted Answer</div>
              <div class="big-answer">${item.student_answer || '[blank]'}</div>
            </div>
            <div class="comparison-card">
              <div class="card-title">Correct Answer</div>
              <div class="big-answer">${item.correct_answer || ''}</div>
            </div>
          </div>
          <div class="muted-text mt-8">Match: ${item.match_score}% &nbsp;•&nbsp; Model: ${item.model_used || 'N/A'}</div>
          ${item.remarks ? `<div class="muted-text mt-8">Remarks: ${item.remarks}</div>` : ''}
        </div>
        <div class="card flex-1">
          <div class="card-title">Choose Action</div>
          <div class="radio-group mb-14">
            <label><input type="radio" name="rev-action" value="accept"> Accept as correct</label>
            <label><input type="radio" name="rev-action" value="wrong"> Mark as incorrect</label>
            <label><input type="radio" name="rev-action" value="override" checked> Override manually</label>
          </div>
          <label class="form-label">Manual Override Input</label>
          <input type="text" id="rev-override" value="${_esc(item.correct_answer)}" title="Enter the manual override answer.">
          <div class="spacer" style="min-height:20px;"></div>
          <button class="btn btn-primary w-full" id="rev-save-btn">Save Override</button>
        </div>
      </div>
    `;

    document.getElementById('rev-save-btn')?.addEventListener('click', saveOverride);
  }

  function _esc(val) {
    return String(val || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  async function saveOverride() {
    if (!currentItem) return;
    const item = currentItem;
    const originalScore = item.match_score || 0;
    const originalAuto = item.auto_status || item.status;

    const action = document.querySelector('input[name="rev-action"]:checked')?.value || 'override';
    let earned, status, actionName, remarks, ans = item.student_answer, matchScore = originalScore;

    if (action === 'accept') {
      earned = item.points;
      status = 'OK';
      actionName = 'accepted_correct';
      remarks = `Manual override: accepted as correct. Auto result was ${originalAuto} with ${originalScore}% match.`;
    } else if (action === 'wrong') {
      earned = 0;
      status = 'Wrong';
      actionName = 'marked_incorrect';
      remarks = `Manual override: marked incorrect. Auto result was ${originalAuto} with ${originalScore}% match.`;
    } else {
      ans = (document.getElementById('rev-override')?.value || '').trim();
      earned = item.points;
      status = 'OK';
      actionName = 'manual_answer_override';
      matchScore = 100;
      remarks = `Manual override: answer changed to '${ans}' and accepted as correct. Auto result was ${originalAuto} with ${originalScore}% match.`;
    }

    // Update result item
    DB.updateResultItem(item.id, {
      student_answer: ans,
      earned,
      status,
      match_score: matchScore,
      manual_override: 1,
      override_action: actionName,
      remarks,
    });

    // Recalculate student result totals
    const rid = item.student_result_id;
    const items = DB.resultItems(rid);
    const score = items.reduce((s, x) => s + (parseFloat(x.earned) || 0), 0);
    const total = items.reduce((s, x) => s + (parseFloat(x.points) || 0), 0);
    const flagged = items.filter(x => x.status === 'Flagged').length;
    const pct = total ? Math.round((score / total) * 10000) / 100 : 0;
    const st = flagged ? 'Flagged' : 'OK';
    DB.updateStudentResult(rid, { score, total, percentage: pct, flagged_count: flagged, status: st });

    await App.showMessage('Saved', 'Manual override saved.');
    App.state.selectedStudentResultId = rid;
    App.showPage('student_result');
  }

  return { render, refresh };
})();

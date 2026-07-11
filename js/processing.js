/* ============================================================
   processing.js — Processing page (OCR not available in web)
   ============================================================ */

const Processing = (() => {
  function render() { /* rendered in refresh */ }

  function refresh() {
    const el = document.getElementById('page-processing');
    if (!el) return;

    const uploadCount = (App.state.uploadPaths || []).length;

    el.innerHTML = `
      <div class="title-block">
        <div class="page-title">Processing Answer Sheets</div>
        <div class="page-subtitle">Segmenting, recognizing, and grading uploaded sheets.</div>
      </div>
      <div class="flex gap-16" style="align-items:flex-start;">
        <div class="card flex-3">
          <div class="card-title">Processing Queue</div>
          <div class="muted-text mb-8" id="proc-current">${uploadCount ? `${uploadCount} image(s) selected.` : 'No images uploaded.'}</div>
          <div class="muted-text mb-8">Overall Progress: N/A</div>
          <div class="progress-bar mb-8"><div class="progress-fill" style="width:0%"></div></div>
          <div class="log-box" id="proc-log" style="min-height:180px;">
            <div style="padding:24px;text-align:center;">
              <div style="font-size:32px;margin-bottom:12px;">⚙️</div>
              <div style="font-size:14px;font-weight:700;color:var(--text-heading);margin-bottom:8px;">
                Ready to Process
              </div>
              <div style="color:var(--text-muted);line-height:1.6;">
                Click "Start Processing" to begin the automated grading pipeline.<br><br>
                <em>Note: Python deep learning models (YOLO11-seg, TrOCR, CRNN) are not yet integrated into the web version. A placeholder process will run.</em>
              </div>
            </div>
          </div>
        </div>
        <div class="card flex-1">
          <div class="card-title">Current Pipeline</div>
          <div class="muted-text mb-8">Segmentation: YOLO11-seg best.pt</div>
          <div class="muted-text mb-8">OCR: TrOCR primary</div>
          <div class="muted-text mb-8">Fallback: CRNN + CTC</div>
          <div class="muted-text mb-8">Preprocessing: OpenCV</div>
          <div class="spacer" style="min-height:40px;"></div>
          <button class="btn btn-primary w-full mb-8" id="proc-start-btn" title="Start automated grading.">Start Processing</button>
          <button class="btn btn-success w-full" id="proc-results-btn" title="View existing results.">Open Results</button>
        </div>
      </div>
    `;

    document.getElementById('proc-results-btn')?.addEventListener('click', () => App.showPage('results'));
    document.getElementById('proc-start-btn')?.addEventListener('click', startProcessing);
  }

  async function startProcessing() {
    const paths = App.state.uploadPaths || [];
    if (!paths.length) {
      App.showMessage('No Images', 'No images to process.');
      return;
    }
    const keyId = App.state.selectedAnswerKeyId;
    if (!keyId) {
      App.showMessage('No Answer Key', 'No answer key selected.');
      return;
    }

    const startBtn = document.getElementById('proc-start-btn');
    startBtn.disabled = true;
    startBtn.textContent = 'Processing...';
    
    const logBox = document.getElementById('proc-log');
    logBox.innerHTML = '<div style="padding:16px;">Starting automated pipeline...</div>';
    
    const sid = DB.createSession(keyId, 'Web Upload');
    App.state.currentSessionId = sid;
    
    const items = DB.answerKeyItems(keyId);
    
    for (let i = 0; i < paths.length; i++) {
      const file = paths[i];
      const progress = Math.round(((i + 1) / paths.length) * 100);
      document.querySelector('.progress-fill').style.width = `${progress}%`;
      
      logBox.innerHTML += `<div>[${i+1}/${paths.length}] Processing ${file.name}... (Placeholder)</div>`;
      logBox.scrollTop = logBox.scrollHeight;
      
      // Simulate processing delay
      await new Promise(r => setTimeout(r, 1000));
      
      // Add placeholder result
      const rid = DB.addStudentResult(sid, file.name.split('.')[0] || 'Unknown', 'Placeholder Section', file.name, 0, items.reduce((sum, it) => sum + it.points, 0), 0, items.length, 'Flagged');
      for (const item of items) {
        DB.addResultItem(rid, {
          item_no: item.item_no,
          type: item.type,
          enum_group: item.enum_group,
          student_answer: '[Placeholder]',
          correct_answer: item.correct_answer,
          alternatives: item.alternatives,
          match_score: 0,
          points: item.points,
          earned: 0,
          status: 'Flagged',
          auto_status: 'Flagged',
          remarks: 'Automated processing placeholder',
          model_used: 'Placeholder Model'
        });
      }
    }
    
    DB.updateSessionStatus(sid, 'Completed');
    logBox.innerHTML += `<div style="color:var(--success);font-weight:bold;margin-top:8px;">Processing complete! Session #${sid} saved.</div>`;
    logBox.scrollTop = logBox.scrollHeight;
    
    startBtn.textContent = 'Completed';
    App.state.uploadPaths = []; // clear queue
  }

  return { render, refresh };
})();

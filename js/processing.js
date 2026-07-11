/* ============================================================
   processing.js - Model-ready processing UI and placeholder adapter
   ============================================================ */

const ProcessingAdapter = (() => {
  const MODEL_NAME = 'Model Pending Placeholder';

  async function runProcessingJob(files, answerKeyItems, callbacks) {
    callbacks = callbacks || {};
    const results = [];

    try {
      for (let index = 0; index < files.length; index += 1) {
        const entry = files[index];
        const rawFile = entry?.file || entry;
        if (entry?.simulateProcessingError || rawFile?.simulateProcessingError) {
          throw new Error(`Placeholder processing failed for ${entry?.name || rawFile?.name || 'an image'}.`);
        }

        const context = { index, total: files.length, file: entry };
        callbacks.onFileStart?.(context);
        callbacks.onLog?.({ ...context, level: 'info', message: `Preparing ${_fileName(entry)}.` });
        await _delay(180);

        const result = _createPlaceholderResult(entry, answerKeyItems);
        results.push(result);
        callbacks.onFileComplete?.({ ...context, result });

        const completed = index + 1;
        callbacks.onProgress?.({
          ...context,
          completed,
          percent: Math.round((completed / files.length) * 100),
          result,
        });
        callbacks.onLog?.({ ...context, level: 'success', message: `Placeholder record created for ${_fileName(entry)}.` });
      }

      callbacks.onComplete?.({ total: files.length, results });
      return results;
    } catch (error) {
      callbacks.onError?.({ error, completed: results.length, total: files.length });
      throw error;
    }
  }

  function _createPlaceholderResult(entry, answerKeyItems) {
    const name = _fileName(entry);
    const total = answerKeyItems.reduce((sum, item) => sum + (Number(item.points) || 0), 0);
    return {
      student_name: name.replace(/\.[^.]+$/, '') || 'Model Pending Student',
      section: 'Model Pending',
      image_path: entry?.relativePath || name,
      score: 0,
      total,
      percentage: 0,
      flagged_count: answerKeyItems.length,
      status: 'Flagged',
      items: answerKeyItems.map(item => ({
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
    };
  }

  function _fileName(entry) {
    return String(entry?.name || entry?.file?.name || 'answer-sheet');
  }

  function _delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  return { runProcessingJob, MODEL_NAME };
})();

const Processing = (() => {
  const state = {
    status: 'idle',
    progress: 0,
    completed: 0,
    total: 0,
    currentFile: '',
    logs: [],
    sessionId: null,
    error: '',
    sourceSignature: '',
  };
  let runningPromise = null;

  function render() { /* rendered by refresh */ }

  function refresh() {
    const el = document.getElementById('page-processing');
    if (!el) return;

    _syncQueueState();
    const files = App.state.uploadPaths || [];
    const key = DB.answerKeys().find(answerKey => answerKey.id === App.state.selectedAnswerKeyId);
    const items = key ? DB.answerKeyItems(key.id) : [];
    const canOpenResults = Boolean(state.sessionId || App.state.currentSessionId);

    el.innerHTML = `
      <div class="title-block">
        <div class="page-title">Processing Answer Sheets</div>
        <div class="page-subtitle">Run the model-ready placeholder workflow and create reviewable grading records.</div>
      </div>

      <div class="processing-banner">
        <span class="badge badge-blue">${ProcessingAdapter.MODEL_NAME}</span>
        <span>Outputs remain flagged until reviewed or replaced by the future OCR model.</span>
      </div>

      <div class="workflow-layout processing-layout">
        <section class="card workflow-main">
          <div class="processing-heading">
            <div>
              <div class="card-title">Processing Queue</div>
              <div class="muted-text" id="proc-current">${_currentLabel(files)}</div>
            </div>
            <span class="badge ${_statusBadgeClass()}" id="proc-status">${_statusLabel()}</span>
          </div>

          <div class="progress-meta">
            <span id="proc-progress-label">${state.progress}% complete</span>
            <span id="proc-count-label">${state.completed} / ${state.total || files.length} files</span>
          </div>
          <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${state.progress}">
            <div class="progress-fill" id="proc-progress-fill" style="width:${state.progress}%"></div>
          </div>

          <div class="log-box processing-log" id="proc-log" aria-live="polite">${_renderLogs()}</div>
        </section>

        <aside class="card workflow-sidebar processing-sidebar">
          <div class="card-title">Job Details</div>
          <dl class="job-details">
            <div><dt>Answer key</dt><dd>${_esc(key?.name || 'Not selected')}</dd></div>
            <div><dt>Key items</dt><dd>${items.length}</dd></div>
            <div><dt>Queued images</dt><dd>${files.length}</dd></div>
            <div><dt>Session</dt><dd id="proc-session-label">${state.sessionId ? `#${state.sessionId}` : 'Not created'}</dd></div>
          </dl>
          <div class="workflow-actions vertical-actions">
            <button class="btn btn-primary w-full" id="proc-start-btn" ${state.status === 'running' || (state.status === 'completed' && !files.length) ? 'disabled' : ''}>${_startButtonLabel()}</button>
            <button class="btn btn-success w-full" id="proc-results-btn" ${canOpenResults ? '' : 'disabled'}>Open Results</button>
            <button class="btn btn-secondary w-full" id="proc-upload-btn">Back to Upload</button>
          </div>
        </aside>
      </div>
    `;

    el.querySelector('#proc-start-btn')?.addEventListener('click', startProcessing);
    el.querySelector('#proc-results-btn')?.addEventListener('click', openResults);
    el.querySelector('#proc-upload-btn')?.addEventListener('click', () => App.showPage('upload'));
  }

  async function startProcessing() {
    if (runningPromise) return runningPromise;

    const files = [...(App.state.uploadPaths || [])];
    const keyId = parseInt(App.state.selectedAnswerKeyId) || null;
    if (!files.length) {
      await App.showMessage('Images Required', 'Return to Upload and add at least one answer sheet image.');
      return null;
    }
    if (!keyId) {
      await App.showMessage('Answer Key Required', 'Select an answer key before processing.');
      return null;
    }
    const answerKeyItems = DB.answerKeyItems(keyId);
    if (!answerKeyItems.length) {
      await App.showMessage('Answer Key Is Empty', 'The selected answer key must contain at least one valid item.');
      return null;
    }

    _beginRun(files);
    let sessionId = null;

    runningPromise = (async () => {
      try {
        sessionId = DB.createSession(keyId, _sourceLabel(files));
        state.sessionId = sessionId;
        App.state.currentSessionId = sessionId;
        _appendLog(`Session #${sessionId} created with ${files.length} image(s).`, 'info');
        _renderState();

        await ProcessingAdapter.runProcessingJob(files, answerKeyItems, {
          onFileStart: ({ index, total, file }) => {
            state.currentFile = file?.name || file?.file?.name || 'answer-sheet';
            _appendLog(`[${index + 1}/${total}] Starting ${state.currentFile}.`, 'info');
            _renderState();
          },
          onProgress: ({ completed, percent }) => {
            state.completed = completed;
            state.progress = percent;
            _renderState();
          },
          onLog: ({ message, level }) => {
            _appendLog(message, level);
            _renderState();
          },
          onFileComplete: ({ result }) => {
            _persistResult(sessionId, result);
          },
          onComplete: ({ total }) => {
            _appendLog(`All ${total} placeholder record(s) were saved.`, 'success');
          },
          onError: ({ error, completed, total }) => {
            _appendLog(`Processing stopped after ${completed} of ${total} files: ${error.message}`, 'error');
          },
        });

        DB.updateSessionStatus(sessionId, 'Completed');
        state.status = 'completed';
        state.progress = 100;
        state.completed = state.total;
        state.currentFile = '';
        App.state.uploadPaths = [];
        _appendLog(`Session #${sessionId} completed. Open Results to continue.`, 'success');
        _renderState();
        return sessionId;
      } catch (error) {
        if (sessionId) DB.updateSessionStatus(sessionId, 'Failed');
        state.status = 'error';
        state.error = error.message || 'The processing job failed.';
        state.currentFile = '';
        _renderState();
        return null;
      } finally {
        runningPromise = null;
      }
    })();

    return runningPromise;
  }

  function _beginRun(files) {
    state.status = 'running';
    state.progress = 0;
    state.completed = 0;
    state.total = files.length;
    state.currentFile = '';
    state.logs = [];
    state.sessionId = null;
    state.error = '';
    state.sourceSignature = _queueSignature(files);
    _appendLog('Starting the model-pending processing adapter.', 'info');
    refresh();
  }

  function _persistResult(sessionId, result) {
    const resultId = DB.addStudentResult(
      sessionId,
      result.student_name,
      result.section,
      result.image_path,
      result.score,
      result.total,
      result.percentage,
      result.flagged_count,
      result.status
    );
    result.items.forEach(item => DB.addResultItem(resultId, item));
  }

  function _syncQueueState() {
    const files = App.state.uploadPaths || [];
    if (state.status === 'running' || !files.length) return;
    const signature = _queueSignature(files);
    if (signature !== state.sourceSignature) {
      state.status = 'idle';
      state.progress = 0;
      state.completed = 0;
      state.total = files.length;
      state.currentFile = '';
      state.logs = [];
      state.sessionId = null;
      state.error = '';
      state.sourceSignature = signature;
    }
  }

  function _queueSignature(files) {
    return `${App.state.selectedAnswerKeyId || 'no-key'}::${files.map(entry => entry.key || `${entry.name}|${entry.size}|${entry.lastModified}`).join('::')}`;
  }

  function _sourceLabel(files) {
    const hasFolder = files.some(entry => entry.source === 'Folder' || String(entry.relativePath || '').includes('/'));
    return hasFolder ? 'Web Folder Upload' : 'Web Image Upload';
  }

  function _appendLog(message, level) {
    state.logs.push({ message: String(message || ''), level: level || 'info', time: new Date().toLocaleTimeString() });
    if (state.logs.length > 200) state.logs.shift();
  }

  function _renderState() {
    const status = document.getElementById('proc-status');
    const current = document.getElementById('proc-current');
    const progressLabel = document.getElementById('proc-progress-label');
    const countLabel = document.getElementById('proc-count-label');
    const fill = document.getElementById('proc-progress-fill');
    const bar = fill?.parentElement;
    const log = document.getElementById('proc-log');
    const sessionLabel = document.getElementById('proc-session-label');
    const start = document.getElementById('proc-start-btn');
    const results = document.getElementById('proc-results-btn');

    if (status) {
      status.className = `badge ${_statusBadgeClass()}`;
      status.textContent = _statusLabel();
    }
    if (current) current.textContent = _currentLabel(App.state.uploadPaths || []);
    if (progressLabel) progressLabel.textContent = `${state.progress}% complete`;
    if (countLabel) countLabel.textContent = `${state.completed} / ${state.total} files`;
    if (fill) fill.style.width = `${state.progress}%`;
    if (bar) bar.setAttribute('aria-valuenow', String(state.progress));
    if (log) {
      log.innerHTML = _renderLogs();
      log.scrollTop = log.scrollHeight;
    }
    if (sessionLabel) sessionLabel.textContent = state.sessionId ? `#${state.sessionId}` : 'Not created';
    if (start) {
      start.textContent = _startButtonLabel();
      start.disabled = state.status === 'running' || (state.status === 'completed' && !(App.state.uploadPaths || []).length);
    }
    if (results) results.disabled = !(state.sessionId || App.state.currentSessionId);
  }

  function _renderLogs() {
    if (!state.logs.length) {
      const message = state.error || 'Ready. Start processing when the answer key and upload queue are complete.';
      return `<div class="log-empty">${_esc(message)}</div>`;
    }
    return state.logs.map(entry => `<div class="log-line log-${entry.level}"><span>${_esc(entry.time)}</span>${_esc(entry.message)}</div>`).join('');
  }

  function _currentLabel(files) {
    if (state.status === 'running' && state.currentFile) return `Processing ${state.currentFile}`;
    if (state.status === 'completed') return `Session #${state.sessionId} is ready for review.`;
    if (state.status === 'error') return state.error || 'Processing failed.';
    return files.length ? `${files.length} image(s) ready.` : 'No images are queued.';
  }

  function _statusLabel() {
    return { idle: 'Ready', running: 'Processing', completed: 'Completed', error: 'Failed' }[state.status] || 'Ready';
  }

  function _statusBadgeClass() {
    return { idle: 'badge-gray', running: 'badge-warning', completed: 'badge-success', error: 'badge-danger' }[state.status] || 'badge-gray';
  }

  function _startButtonLabel() {
    if (state.status === 'running') return 'Processing...';
    if (state.status === 'completed') return 'Completed';
    if (state.status === 'error') return 'Retry Processing';
    return 'Start Processing';
  }

  function openResults() {
    if (state.sessionId) App.state.currentSessionId = state.sessionId;
    App.showPage('results');
  }

  function _esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return { render, refresh, startProcessing };
})();

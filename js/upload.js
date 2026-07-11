/* ============================================================
   upload.js - Image and folder upload queue
   ============================================================ */

const Upload = (() => {
  const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff']);

  function render() { /* rendered by refresh */ }

  function refresh() {
    const el = document.getElementById('page-upload');
    if (!el) return;

    App.state.uploadPaths = (App.state.uploadPaths || []).map(entry => _normalizeEntry(entry, entry.source || 'Images'));
    const files = App.state.uploadPaths;
    const keys = DB.answerKeys();
    const selectedKeyId = keys.some(key => key.id === App.state.selectedAnswerKeyId)
      ? App.state.selectedAnswerKeyId
      : keys[0]?.id || null;
    App.state.selectedAnswerKeyId = selectedKeyId;

    const totalBytes = files.reduce((sum, entry) => sum + entry.size, 0);
    const folderCount = new Set(files.map(entry => _parentFolder(entry.relativePath)).filter(Boolean)).size;
    const keyOptions = keys.length
      ? keys.map(key => `<option value="${key.id}" ${key.id === selectedKeyId ? 'selected' : ''}>${_esc(key.name)}</option>`).join('')
      : '<option value="">No answer keys available</option>';

    el.innerHTML = `
      <div class="title-block">
        <div class="page-title">Upload Answer Sheets</div>
        <div class="page-subtitle">Prepare individual images or a class folder for processing.</div>
      </div>

      <div class="workflow-layout upload-layout">
        <aside class="card workflow-sidebar">
          <div class="card-title">Upload Setup</div>
          <div class="form-group">
            <label class="form-label" for="upload-key-combo">Answer Key</label>
            <select id="upload-key-combo">${keyOptions}</select>
          </div>
          ${keys.length ? '' : '<button class="btn btn-secondary w-full mb-14" id="upload-new-key-btn">Create Answer Key</button>'}
          <div class="queue-summary" aria-label="Upload queue summary">
            <div><span>Images</span><strong>${files.length}</strong></div>
            <div><span>Total size</span><strong>${_formatBytes(totalBytes)}</strong></div>
            <div><span>Folders</span><strong>${folderCount}</strong></div>
          </div>
          <div class="model-note mt-14">
            <span class="badge badge-blue">Model Pending</span>
            <p>Processing creates clearly labeled placeholder records until the OCR model is connected.</p>
          </div>
        </aside>

        <section class="card workflow-main">
          <div class="card-title">Batch Upload</div>
          <div class="drop-zone" id="upload-dropzone" role="button" tabindex="0" aria-label="Choose or drop answer sheet images">
            <div class="drop-icon" aria-hidden="true">+</div>
            <div class="drop-text">Drop answer sheet images here</div>
            <div class="muted-text">JPG, JPEG, PNG, BMP, TIF, and TIFF</div>
            <div class="flex gap-8 flex-wrap justify-center">
              <button type="button" class="btn btn-primary" id="upload-browse-btn">Browse Images</button>
              <button type="button" class="btn btn-secondary" id="upload-folder-btn">Browse Folder</button>
            </div>
            <input type="file" id="upload-file-input" multiple accept=".jpg,.jpeg,.png,.bmp,.tif,.tiff" hidden>
            <input type="file" id="upload-folder-input" multiple webkitdirectory directory accept=".jpg,.jpeg,.png,.bmp,.tif,.tiff" hidden>
          </div>

          <div class="queue-heading">
            <div>
              <div class="section-title">Selected Images</div>
              <div class="muted-text">${files.length ? `${files.length} image(s) ready for processing.` : 'No images selected.'}</div>
            </div>
            <button type="button" class="btn btn-danger btn-small" id="upload-clear-btn" ${files.length ? '' : 'disabled'}>Clear Queue</button>
          </div>

          <div class="file-list upload-file-list" id="upload-preview">
            ${_renderFiles(files)}
          </div>

          <div class="workflow-actions">
            <button type="button" class="btn btn-primary" id="upload-proceed-btn">Proceed to Processing</button>
          </div>
        </section>
      </div>
    `;

    _attachEvents(el);
  }

  function _attachEvents(el) {
    const fileInput = el.querySelector('#upload-file-input');
    const folderInput = el.querySelector('#upload-folder-input');
    const dropZone = el.querySelector('#upload-dropzone');

    el.querySelector('#upload-browse-btn')?.addEventListener('click', event => {
      event.stopPropagation();
      fileInput?.click();
    });
    el.querySelector('#upload-folder-btn')?.addEventListener('click', event => {
      event.stopPropagation();
      folderInput?.click();
    });
    fileInput?.addEventListener('change', event => {
      addFiles(Array.from(event.target.files || []), 'Images');
      event.target.value = '';
    });
    folderInput?.addEventListener('change', event => {
      addFiles(Array.from(event.target.files || []), 'Folder');
      event.target.value = '';
    });

    dropZone?.addEventListener('click', event => {
      if (!event.target.closest('button')) fileInput?.click();
    });
    dropZone?.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput?.click();
      }
    });
    dropZone?.addEventListener('dragover', event => {
      event.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone?.addEventListener('dragleave', event => {
      if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('drag-over');
    });
    dropZone?.addEventListener('drop', event => {
      event.preventDefault();
      dropZone.classList.remove('drag-over');
      addFiles(Array.from(event.dataTransfer?.files || []), 'Drop');
    });

    el.querySelector('#upload-key-combo')?.addEventListener('change', event => {
      App.state.selectedAnswerKeyId = parseInt(event.target.value) || null;
    });
    el.querySelector('#upload-new-key-btn')?.addEventListener('click', () => App.showPage('answer_key'));
    el.querySelector('#upload-clear-btn')?.addEventListener('click', () => {
      App.state.uploadPaths = [];
      refresh();
    });
    el.querySelector('#upload-proceed-btn')?.addEventListener('click', proceed);
    el.querySelectorAll('[data-remove-upload]').forEach(button => {
      button.addEventListener('click', () => removeFile(parseInt(button.dataset.removeUpload)));
    });
  }

  async function addFiles(files, source) {
    const existing = new Set((App.state.uploadPaths || []).map(entry => entry.key));
    const accepted = [...(App.state.uploadPaths || [])];
    const unsupported = [];
    let duplicateCount = 0;

    files.forEach(file => {
      const entry = _normalizeEntry(file, source);
      if (!SUPPORTED_EXTENSIONS.has(_extension(entry.name))) {
        unsupported.push(entry.name);
        return;
      }
      if (existing.has(entry.key)) {
        duplicateCount += 1;
        return;
      }
      existing.add(entry.key);
      accepted.push(entry);
    });

    App.state.uploadPaths = accepted;
    refresh();

    const messages = [];
    if (unsupported.length) {
      const examples = unsupported.slice(0, 3).join(', ');
      messages.push(`${unsupported.length} unsupported file(s) skipped${examples ? `: ${examples}` : ''}.`);
    }
    if (duplicateCount) messages.push(`${duplicateCount} duplicate file(s) skipped.`);
    if (messages.length) await App.showMessage('Upload Notice', messages.join(' '));
  }

  function removeFile(index) {
    App.state.uploadPaths = (App.state.uploadPaths || []).filter((entry, entryIndex) => entryIndex !== index);
    refresh();
  }

  async function proceed() {
    const keyId = parseInt(document.getElementById('upload-key-combo')?.value) || null;
    if (!keyId) {
      await App.showMessage('Answer Key Required', 'Select or create an answer key before processing.');
      return;
    }
    if (!DB.answerKeyItems(keyId).length) {
      await App.showMessage('Answer Key Is Empty', 'Add at least one valid item to the selected answer key.');
      return;
    }
    if (!(App.state.uploadPaths || []).length) {
      await App.showMessage('Images Required', 'Add at least one supported answer sheet image.');
      return;
    }
    App.state.selectedAnswerKeyId = keyId;
    App.showPage('processing');
  }

  function _normalizeEntry(value, source) {
    const rawFile = value?.file || value;
    const name = String(value?.name || rawFile?.name || 'answer-sheet');
    const relativePath = String(value?.relativePath || rawFile?.webkitRelativePath || name);
    const size = Number(value?.size ?? rawFile?.size) || 0;
    const lastModified = Number(value?.lastModified ?? rawFile?.lastModified) || 0;
    const key = value?.key || `${relativePath.toLowerCase()}|${size}|${lastModified}`;
    return {
      key,
      file: rawFile,
      name,
      size,
      type: String(value?.type || rawFile?.type || ''),
      lastModified,
      relativePath,
      source: value?.source || source || 'Images',
    };
  }

  function _renderFiles(files) {
    if (!files.length) return '<div class="file-empty">Choose images to build the processing queue.</div>';
    return files.map((entry, index) => `
      <div class="file-item upload-file-row">
        <div class="upload-file-main">
          <strong>${_esc(entry.name)}</strong>
          <span>${_esc(entry.relativePath)}</span>
        </div>
        <span class="badge badge-gray">${_esc(entry.source)}</span>
        <span class="upload-file-size">${_formatBytes(entry.size)}</span>
        <button type="button" class="btn btn-secondary btn-small" data-remove-upload="${index}" aria-label="Remove ${_esc(entry.name)}">Remove</button>
      </div>`).join('');
  }

  function _extension(name) {
    const index = String(name).lastIndexOf('.');
    return index >= 0 ? String(name).slice(index).toLowerCase() : '';
  }

  function _parentFolder(path) {
    const parts = String(path || '').split('/');
    return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
  }

  function _formatBytes(bytes) {
    if (!bytes) return '0 KB';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${Math.round(bytes / (1024 * 1024) * 10) / 10} MB`;
  }

  function _esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return { render, refresh, addFiles };
})();

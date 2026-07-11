/* ============================================================
   upload.js — Upload page with drag-drop & file browse
   ============================================================ */

const Upload = (() => {
  const SUPPORTED_EXTS = ['.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff'];

  function render() { /* rendered in refresh */ }

  function refresh() {
    const el = document.getElementById('page-upload');
    if (!el) return;

    const keys = DB.answerKeys();
    const selectedKeyId = App.state.selectedAnswerKeyId;
    let keyOptions = keys.map(k => {
      const sel = k.id === selectedKeyId ? 'selected' : '';
      return `<option value="${k.id}" ${sel}>${k.name}</option>`;
    }).join('');
    if (!keyOptions) keyOptions = '<option value="">No answer keys available</option>';

    const fileItems = (App.state.uploadPaths || []).map(f =>
      `<div class="file-item">${f.name}</div>`
    ).join('');

    el.innerHTML = `
      <div class="title-block">
        <div class="page-title">Upload Answer Sheets</div>
        <div class="page-subtitle">Upload one sheet or a full class folder.</div>
      </div>
      <div class="flex gap-16" style="align-items:flex-start;">
        <div class="card flex-1">
          <div class="card-title">Upload Options</div>
          <label class="form-label">Select Answer Key</label>
          <select id="upload-key-combo" title="Choose the answer key for grading.">${keyOptions}</select>
          <div class="muted-text mt-8">Processing uses: OpenCV → YOLO11-seg → TrOCR → CRNN fallback → grading</div>
          <!--<div class="muted-text mt-8" style="color:var(--danger);font-weight:600;">Note: Image processing / OCR is not available at the moment.</div>-->
        </div>
        <div class="card flex-3">
          <div class="card-title">Batch Upload</div>
          <div class="drop-zone" id="upload-dropzone">
            <div class="drop-icon">☁</div>
            <div class="drop-text">Drag & drop images here</div>
            <div class="muted-text">or</div>
            <div class="flex gap-8">
              <button class="btn btn-primary" id="upload-browse-btn" title="Select answer sheet image files.">Browse Images</button>
            </div>
            <input type="file" id="upload-file-input" multiple accept=".jpg,.jpeg,.png,.bmp,.tif,.tiff" style="display:none;">
          </div>
          <label class="form-label mt-8">Selected Images</label>
          <div class="file-list" id="upload-preview">${fileItems || '<div class="file-item muted-text">No images selected.</div>'}</div>
          <div class="flex justify-end mt-8">
            <button class="btn btn-danger" id="upload-clear-btn" title="Clear selected images." style="margin-right:8px;">Clear</button>
            <button class="btn btn-primary" id="upload-proceed-btn" title="Continue to the processing page.">Proceed to Processing</button>
          </div>
        </div>
      </div>
    `;

    // File input
    const fileInput = document.getElementById('upload-file-input');
    document.getElementById('upload-browse-btn')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', (e) => {
      setUploadFiles(Array.from(e.target.files));
    });

    // Drag & drop
    const dz = document.getElementById('upload-dropzone');
    if (dz) {
      dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
      dz.addEventListener('drop', (e) => {
        e.preventDefault();
        dz.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer.files).filter(f => {
          const ext = '.' + f.name.split('.').pop().toLowerCase();
          return SUPPORTED_EXTS.includes(ext);
        });
        if (files.length) setUploadFiles(files);
      });
    }

    // Answer key selector
    document.getElementById('upload-key-combo')?.addEventListener('change', (e) => {
      App.state.selectedAnswerKeyId = parseInt(e.target.value) || null;
    });

    // Clear
    document.getElementById('upload-clear-btn')?.addEventListener('click', () => {
      App.state.uploadPaths = [];
      _renderPreview();
    });

    // Proceed
    document.getElementById('upload-proceed-btn')?.addEventListener('click', proceed);
  }

  function setUploadFiles(files) {
    // Deduplicate by name
    const existing = new Set((App.state.uploadPaths || []).map(f => f.name));
    const newFiles = files.filter(f => !existing.has(f.name));
    App.state.uploadPaths = [...(App.state.uploadPaths || []), ...newFiles];
    _renderPreview();
  }

  function _renderPreview() {
    const preview = document.getElementById('upload-preview');
    if (!preview) return;
    const paths = App.state.uploadPaths || [];
    if (!paths.length) {
      preview.innerHTML = '<div class="file-item muted-text">No images selected.</div>';
      return;
    }
    preview.innerHTML = paths.map(f => `<div class="file-item">${f.name}</div>`).join('');
  }

  function proceed() {
    const keyId = parseInt(document.getElementById('upload-key-combo')?.value) || null;
    if (!keyId) {
      App.showMessage('Missing Answer Key', 'Please select an answer key first.');
      return;
    }
    if (!App.state.uploadPaths || !App.state.uploadPaths.length) {
      App.showMessage('No Images', 'Please select answer sheet images.');
      return;
    }
    App.state.selectedAnswerKeyId = keyId;
    App.showPage('processing');
  }

  return { render, refresh };
})();

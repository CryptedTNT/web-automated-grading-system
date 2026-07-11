/* ============================================================
   answer_key.js — Answer Key CRUD + item table
   ============================================================ */

const AnswerKey = (() => {
  const HEADERS = ['#', 'Type', 'Group', 'Correct Answer(s)', 'Alternative Answers', 'Points', 'Threshold'];
  const Q_TYPES = ['Multiple Choice', 'True or False', 'Identification', 'Enumeration'];

  let currentKeyId = null;
  let creatingNew = false;
  let keyRows = [];

  function render() { /* initial render in refresh */ }

  function refresh(selectKeyId) {
    const el = document.getElementById('page-answer_key');
    if (!el) return;

    keyRows = DB.answerKeys();
    const selectedId = selectKeyId || currentKeyId || keyRows[0]?.id || null;

    let listItems = '';
    let selectedIdx = -1;
    keyRows.forEach((k, i) => {
      const isActive = k.id === selectedId;
      if (isActive) selectedIdx = i;
      listItems += `<div class="list-item ${isActive ? 'active' : ''}" data-id="${k.id}">${k.name}</div>`;
    });

    el.innerHTML = `
      <div class="title-block">
        <div class="page-title">Answer Key Management</div>
        <div class="page-subtitle">Create, save, and reuse answer keys.</div>
      </div>
      <div class="workflow-layout">
        <div class="card workflow-sidebar">
          <div class="card-title">Saved Answer Keys</div>
          <button class="btn btn-primary w-full mb-8" id="ak-new-btn" title="Create a new answer key.">+ New Answer Key</button>
          <div class="list-widget" id="ak-list">${listItems || '<div class="list-item muted-text">No answer keys yet.</div>'}</div>
          <button class="btn btn-danger w-full mt-8" id="ak-delete-key-btn" title="Delete the selected answer key.">Delete Answer Key</button>
        </div>
        <div class="card workflow-main">
          <div class="card-title">Answer Key Details</div>
          <div class="form-group">
            <label class="form-label">Answer Key Name</label>
            <input type="text" id="ak-name" title="Enter a descriptive name for this answer key." value="">
          </div>
          <div class="table-wrapper" style="max-height:400px; overflow-y:auto;">
            <table id="ak-table">
              <thead><tr>${HEADERS.map(h => `<th>${h}</th>`).join('')}</tr></thead>
              <tbody id="ak-tbody"></tbody>
            </table>
          </div>
          <div class="flex gap-8 mt-8 items-center">
            <button class="btn btn-secondary" id="ak-add-btn" title="Add another item row.">Add Item</button>
            <button class="btn btn-danger" id="ak-del-row-btn" title="Delete the selected item row.">Delete Row</button>
            <div class="spacer"></div>
            <button class="btn btn-primary" id="ak-save-btn" title="Save the answer key.">Save Key</button>
          </div>
        </div>
      </div>
    `;

    // Attach list click
    el.querySelectorAll('#ak-list .list-item[data-id]').forEach(item => {
      item.addEventListener('click', () => {
        creatingNew = false;
        const id = parseInt(item.dataset.id);
        currentKeyId = id;
        loadKey(id);
        _highlightListItem(id);
      });
    });

    // Load selected key
    if (selectedIdx >= 0 && !creatingNew) {
      currentKeyId = keyRows[selectedIdx].id;
      loadKey(currentKeyId);
    }

    document.getElementById('ak-new-btn')?.addEventListener('click', newKey);
    document.getElementById('ak-add-btn')?.addEventListener('click', () => addRow());
    document.getElementById('ak-del-row-btn')?.addEventListener('click', deleteRow);
    document.getElementById('ak-save-btn')?.addEventListener('click', saveKey);
    document.getElementById('ak-delete-key-btn')?.addEventListener('click', deleteAnswerKey);
  }

  function _highlightListItem(id) {
    document.querySelectorAll('#ak-list .list-item').forEach(li => {
      li.classList.toggle('active', parseInt(li.dataset.id) === id);
    });
  }

  function loadKey(keyId) {
    const key = keyRows.find(k => k.id === keyId);
    if (!key) return;
    const nameInput = document.getElementById('ak-name');
    if (nameInput) nameInput.value = key.name;
    const items = DB.answerKeyItems(keyId);
    const tbody = document.getElementById('ak-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    items.forEach(it => {
      addRow([it.item_no, it.type, it.enum_group ?? '', it.correct_answer, it.alternatives, it.points, it.fuzzy_threshold]);
    });
  }

  function newKey() {
    creatingNew = true;
    currentKeyId = null;
    document.querySelectorAll('#ak-list .list-item').forEach(li => li.classList.remove('active'));
    const nameInput = document.getElementById('ak-name');
    if (nameInput) nameInput.value = `Answer Key ${keyRows.length + 1}`;
    const tbody = document.getElementById('ak-tbody');
    if (tbody) tbody.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      addRow([i, 'Multiple Choice', '', 'A', '', 1, 85]);
    }
  }

  function addRow(values) {
    const tbody = document.getElementById('ak-tbody');
    if (!tbody) return;
    const r = tbody.rows.length;
    if (!values) values = [r + 1, 'Identification', '', '', '', 1, 85];

    const typeOptions = Q_TYPES.map(t => `<option ${t === String(values[1]) ? 'selected' : ''}>${t}</option>`).join('');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="text-align:center;font-weight:700;">${r + 1}</td>
      <td><select title="Question type">${typeOptions}</select></td>
      <td><input type="text" value="${values[2] ?? ''}" style="text-align:center;width:60px;" title="Enumeration group number"></td>
      <td><input type="text" value="${_esc(values[3])}" title="Correct answer(s)"></td>
      <td><input type="text" value="${_esc(values[4])}" title="Alternative answers"></td>
      <td><input type="number" value="${values[5]}" style="text-align:center;width:60px;" title="Points"></td>
      <td><input type="number" value="${values[6]}" style="text-align:center;width:70px;" title="Fuzzy match threshold %"></td>
    `;
    tr.addEventListener('click', () => {
      tbody.querySelectorAll('tr').forEach(t => t.classList.remove('selected'));
      tr.classList.add('selected');
    });
    tbody.appendChild(tr);
    _renumber();
  }

  function _esc(val) {
    return String(val || '').replace(/"/g, '&quot;');
  }

  function deleteRow() {
    const tbody = document.getElementById('ak-tbody');
    if (!tbody) return;
    const selected = tbody.querySelector('tr.selected');
    if (selected) { selected.remove(); _renumber(); }
    else if (tbody.rows.length) { tbody.rows[tbody.rows.length - 1].remove(); _renumber(); }
  }

  function _renumber() {
    const tbody = document.getElementById('ak-tbody');
    if (!tbody) return;
    Array.from(tbody.rows).forEach((tr, i) => {
      tr.cells[0].textContent = i + 1;
    });
  }

  function _collectItems() {
    const tbody = document.getElementById('ak-tbody');
    if (!tbody) return [];
    const items = [];
    Array.from(tbody.rows).forEach((tr, r) => {
      const type = tr.cells[1].querySelector('select').value;
      const group = tr.cells[2].querySelector('input').value.trim();
      const correct = tr.cells[3].querySelector('input').value.trim();
      const alt = tr.cells[4].querySelector('input').value.trim();
      const points = parseFloat(tr.cells[5].querySelector('input').value) || 1;
      const threshold = parseInt(tr.cells[6].querySelector('input').value) || 85;
      if (!correct) return;
      let enumGroup = group ? parseInt(group) : null;
      if (isNaN(enumGroup)) throw new Error(`Invalid group number in row ${r + 1}.`);
      if (!type.toLowerCase().includes('enumeration')) enumGroup = null;
      items.push({
        item_no: r + 1,
        type: type || 'Identification',
        enum_group: enumGroup,
        correct_answer: correct,
        alternatives: alt,
        points,
        fuzzy_threshold: threshold,
      });
    });
    return items;
  }

  async function saveKey() {
    const name = (document.getElementById('ak-name')?.value || '').trim() || 'Untitled Answer Key';
    let items;
    try { items = _collectItems(); }
    catch (e) { App.showMessage('Invalid Answer Key', e.message); return; }
    if (!items.length) { App.showMessage('No Items', 'Add at least one answer key item before saving.'); return; }

    let keyId;
    if (currentKeyId === null || creatingNew) {
      keyId = DB.createAnswerKey(name, '');
    } else {
      keyId = currentKeyId;
      DB.updateAnswerKey(keyId, name, '');
    }
    DB.replaceAnswerKeyItems(keyId, items);
    currentKeyId = keyId;
    creatingNew = false;
    await App.showMessage('Saved', 'Answer key saved.');
    refresh(keyId);
  }

  async function deleteAnswerKey() {
    if (currentKeyId === null) {
      App.showMessage('No Answer Key Selected', 'Select an answer key to delete.');
      return;
    }
    const yes = await App.showConfirm('Delete Answer Key', 'Delete this answer key? This cannot be undone.');
    if (!yes) return;
    DB.deleteAnswerKey(currentKeyId);
    currentKeyId = null;
    refresh();
  }

  return { render, refresh };
})();

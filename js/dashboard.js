/* ============================================================
   dashboard.js — Dashboard page
   ============================================================ */

const Dashboard = (() => {
  function render() { /* initial render happens in refresh */ }

  function refresh() {
    const el = document.getElementById('page-dashboard');
    if (!el) return;

    const user = App.state.currentUser;
    const teacherName = user ? (user.full_name || 'Teacher') : 'Teacher';
    const stats = DB.dashboardStats();
    const sessions = DB.sessions().slice(0, 8);

    let sessionRows = '';
    for (const s of sessions) {
      const results = DB.studentResults(s.id);
      const avg = results.length ? Math.round(results.reduce((sum, r) => sum + (r.percentage || 0), 0) / results.length * 100) / 100 : 0;
      const flagged = results.reduce((sum, r) => sum + (r.flagged_count || 0), 0);
      sessionRows += `<tr>
        <td>${s.created_at}</td>
        <td>${s.answer_key_name || 'No key'}</td>
        <td>${results.length}</td>
        <td>${avg}%</td>
        <td>${flagged}</td>
        <td><span class="badge ${s.status === 'Completed' ? 'badge-success' : s.status === 'Processing' ? 'badge-warning' : 'badge-gray'}">${s.status}</span></td>
      </tr>`;
    }

    el.innerHTML = `
      <div class="title-block">
        <div class="page-title">Dashboard</div>
        <div class="page-subtitle">Good day, ${teacherName}. Here is the current grading overview.</div>
      </div>

      <div class="flex gap-16 mb-14" style="flex-wrap:wrap;">
        <div class="stat-card">
          <div class="stat-label">Total Sheets Graded</div>
          <div class="stat-value">${stats.sheets}</div>
          <div class="stat-delta">Stored in local storage</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Sessions</div>
          <div class="stat-value">${stats.sessions}</div>
          <div class="stat-delta">Completed and processing sessions</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Flagged for Review</div>
          <div class="stat-value">${stats.flagged}</div>
          <div class="stat-delta">Needs teacher review</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Average Score</div>
          <div class="stat-value">${stats.average}%</div>
          <div class="stat-delta">Across all saved results</div>
        </div>
      </div>

      <div class="flex gap-16" style="align-items:flex-start;">
        <div class="card flex-3">
          <div class="card-title">Recent Grading Sessions</div>
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Date</th><th>Answer Key</th><th>Sheets</th><th>Average</th><th>Flagged</th><th>Status</th></tr></thead>
              <tbody>${sessionRows || '<tr><td colspan="6" class="muted-text" style="text-align:center;padding:24px;">No grading sessions yet. Create an answer key, upload sheets, then process them.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        <div class="card flex-1">
          <div class="card-title">Quick Actions</div>
          <div class="flex flex-col gap-8">
            <button class="btn btn-primary w-full" id="dash-new-key" title="Create or edit an answer key.">New Answer Key</button>
            <button class="btn btn-success w-full" id="dash-upload" title="Upload answer sheet images.">Upload Answer Sheets</button>
            <button class="btn btn-secondary w-full" id="dash-results" title="View grading results.">View Results</button>
            <button class="btn btn-secondary w-full" id="dash-reports" title="Export reports.">Reports & Analytics</button>
          </div>
        </div>
      </div>
    `;

    // Quick action navigation
    document.getElementById('dash-new-key')?.addEventListener('click', () => App.showPage('answer_key'));
    document.getElementById('dash-upload')?.addEventListener('click', () => App.showPage('upload'));
    document.getElementById('dash-results')?.addEventListener('click', () => App.showPage('results'));
    document.getElementById('dash-reports')?.addEventListener('click', () => App.showPage('reports'));
  }

  return { render, refresh };
})();

# Integration Contract

What has to happen for the Vue app to actually run on this database, who does
each part, and the exact SQL behind every operation.

WAIM Weeks 5–6 deliverable — "Complete system development" / "Functional
end-to-end system prototype."

---

## 1. The architectural fact this all rests on

**The Vue app cannot connect to MySQL. Not with a config change, not with a
library, not at all.**

Browsers have no TCP sockets and no MySQL driver, and they never will — if a
web page could open a database connection, anyone who opened DevTools would
have your credentials. Every web application that uses a database puts a server
in between. There is no version of this where `vue-app` talks to `ags_db`
directly.

```
  TODAY                              TARGET
  ─────                              ──────
  ┌──────────────┐                   ┌──────────────┐
  │  Vue app     │                   │  Vue app     │
  │  (browser)   │                   │  (browser)   │
  │              │                   │              │
  │ database.js  │                   │  api.js      │
  │      ↓       │                   │      ↓       │
  │ localStorage │                   │  fetch()  ───┼──── HTTP/JSON
  └──────────────┘                   └──────────────┘        │
   data dies with                                             ▼
   the browser profile                              ┌──────────────────┐
                                                    │  Flask API       │
                                                    │  (SQLAlchemy)    │
                                                    └────────┬─────────┘
                                                             │ SQL
                                                             ▼
                                                    ┌──────────────────┐
                                                    │  MySQL  ags_db   │
                                                    └──────────────────┘
```

So "applying the database to the web application" is three jobs, and only the
first is yours.

---

## 2. Who does what

### Your job (database — done, or specified below)

- [x] Schema, constraints, views, migrations, seed data
- [x] Setup and reproducibility (`SETUP.md`, `tools\migrate.ps1`)
- [x] The `ags_app` account with data-only rights
- [x] **This contract** — the SQL behind every operation the app performs
- [ ] Hand over credentials privately (never in the repo)
- [ ] Run the integrity checks in §6 once real data starts arriving

### The Flask developer's job

- [ ] Endpoints in §4, each returning the JSON shapes the pages already expect
- [ ] Session/auth handling, password hashing via `werkzeug.security`
- [ ] Transaction boundaries in §5
- [ ] File storage for uploads, crops, exports (paths only go in the database)

### The front-end job

- [ ] Replace `src/services/database.js` with an HTTP client of the same shape

That last point is why the app was written the way it was. Its own header says
it: *"The logic is storage-agnostic, so if this system later moves to a hosted
database the call sites stay the same and only the bodies below change."* Every
page calls `DB.something()` and none of them know it is `localStorage`. Swap the
module for one that calls `fetch()` and the pages need no changes.

Two functions disappear entirely in the move:

| Function | Why it goes away |
| --- | --- |
| `recalculateStudentResult()` | The view `v_sheet_result` derives totals from item scores. Nothing to recalculate, nothing to drift. |
| `failInterruptedSessions()` | It exists because `localStorage` has no transactions, so a closed tab left half-written sessions stuck at "Processing" forever. A real transaction either commits or does not. |

---

## 3. Connecting

```
mysql+pymysql://ags_app:PASSWORD@127.0.0.1:3306/ags_db?charset=utf8mb4
```

```
pip install flask flask-sqlalchemy pymysql cryptography python-dotenv
```

`cryptography` is required — MySQL 8 defaults to `caching_sha2_password` and
PyMySQL cannot speak it otherwise. The failure message names the missing
package but not the reason, so it costs people an afternoon.

Connect as **`ags_app`**, never `root`. It holds SELECT/INSERT/UPDATE/DELETE on
`ags_db` and nothing else — it cannot drop the schema or reach another database.

---

## 4. Endpoint map

Each row: what the app calls today → the endpoint → the SQL behind it.

### Authentication

| `database.js` | Endpoint | SQL |
| --- | --- | --- |
| `hasUser()` | `GET /api/setup-state` | `SELECT COUNT(*) FROM faculty;` |
| `createUser(...)` | `POST /api/auth/register` | `INSERT INTO faculty (...)` — hash with `generate_password_hash()`, leave `password_salt` NULL |
| `verifyUser(u,p)` | `POST /api/auth/login` | `SELECT faculty_id, full_name, institution, username, password_hash FROM faculty WHERE username = %s;` then `check_password_hash()`, then `UPDATE faculty SET last_login_at = NOW()` |
| `getUserByUsername(u)` | `GET /api/auth/security-question` | `SELECT security_question FROM faculty WHERE username = %s;` |
| `updateUserProfile(...)` | `PATCH /api/account/profile` | `UPDATE faculty SET full_name = %s, institution = %s WHERE faculty_id = %s;` |
| `updateUserPassword(...)` | `POST /api/account/password` | verify current hash, then `UPDATE faculty SET password_hash = %s;` |
| `resetPasswordWithSecurityAnswer(...)` | `POST /api/auth/reset` | verify `security_answer_hash`, then update |

> **Never `SELECT *` from `faculty` in a response.** It carries the password and
> security-answer hashes. Name your columns.

### Answer keys

| `database.js` | Endpoint | SQL |
| --- | --- | --- |
| `answerKeys()` | `GET /api/answer-keys` | `SELECT answer_key_id, title, subject, year_level, section, created_at FROM answer_key WHERE faculty_id = %s ORDER BY answer_key_id DESC;` |
| `createAnswerKey(...)` | `POST /api/answer-keys` | `INSERT INTO answer_key (faculty_id, title, subject) VALUES (...);` |
| `updateAnswerKey(...)` | `PATCH /api/answer-keys/<id>` | `UPDATE answer_key SET title = %s, subject = %s WHERE answer_key_id = %s AND faculty_id = %s;` |
| `deleteAnswerKey(id)` | `DELETE /api/answer-keys/<id>` | `DELETE FROM answer_key WHERE answer_key_id = %s AND faculty_id = %s;` — items cascade |
| `answerKeyItems(id)` | `GET /api/answer-keys/<id>/items` | `SELECT * FROM answer_key_item WHERE answer_key_id = %s ORDER BY item_no;` |
| `replaceAnswerKeyItems(...)` | `PUT /api/answer-keys/<id>/items` | `DELETE` then bulk `INSERT`, **in one transaction** |

Note the `AND faculty_id = %s` on every write. Without it, any signed-in user
can edit anyone's answer key by guessing an id.

Map the display labels to the stored codes on the way in — `Multiple Choice` →
`MC`, and so on. `v_result_item` already returns `question_type_label` on the
way out.

### Sessions and processing

| `database.js` | Endpoint | SQL |
| --- | --- | --- |
| `sessions()` | `GET /api/sessions` | `SELECT * FROM v_session_summary WHERE faculty_id = %s ORDER BY session_id DESC;` |
| `createSession(...)` | `POST /api/sessions` | `INSERT INTO grading_session (faculty_id, answer_key_id, session_name, source_folder, total_sheets) VALUES (...);` |
| `updateSessionStatus(...)` | `PATCH /api/sessions/<id>` | `UPDATE grading_session SET status = %s, finished_at = NOW() WHERE session_id = %s;` |
| `clearSession(id)` | `DELETE /api/sessions/<id>` | `DELETE FROM grading_session WHERE session_id = %s;` — sheets, answers, results all cascade |
| — | `POST /api/sessions/<id>/sheets` | the transaction in §5 |

### Results and review

| `database.js` | Endpoint | SQL |
| --- | --- | --- |
| `studentResults(sid)` | `GET /api/sessions/<id>/results` | `SELECT * FROM v_sheet_result WHERE session_id = %s ORDER BY sheet_id;` |
| `getStudentResultById(id)` | `GET /api/sheets/<id>` | `SELECT * FROM v_sheet_result WHERE sheet_id = %s;` |
| `resultItems(id)` | `GET /api/sheets/<id>/items` | `SELECT * FROM v_result_item WHERE sheet_id = %s ORDER BY item_no;` |
| `getFirstFlaggedItem(...)` | `GET /api/sessions/<id>/next-flagged` | `SELECT * FROM v_flagged_queue WHERE session_id = %s LIMIT 1;` |
| `updateResultItem(...)` | `POST /api/results/<id>/review` | the transaction in §5 |
| `dashboardStats()` | `GET /api/dashboard` | `SELECT * FROM v_dashboard_stats WHERE faculty_id = %s;` |

### Settings and reports

| `database.js` | Endpoint | SQL |
| --- | --- | --- |
| `getSettings()` | `GET /api/settings` | `SELECT setting_key, setting_value FROM app_setting WHERE faculty_id = %s;` |
| `setSetting(k,v)` | `PUT /api/settings/<key>` | `INSERT ... ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);` |
| export runs | `POST /api/reports` | `INSERT INTO report (answer_key_id, session_id, generated_by, file_name, file_path) VALUES (...);` |

`exportAllData()` / `importAllData()` — the browser backup feature — become
`mysqldump` and `source`. See `SETUP.md` §7. Don't reimplement them.

---

## 5. The two transactions that matter

Everything else is a single statement. These two are not, and getting them
wrong is what produces data a panel can pick apart.

### Grading one sheet — all or nothing

```python
with db.session.begin():
    sheet = ExamSheet(
        session_id=session_id,
        answer_key_id=session.answer_key_id,   # from the session, never from the client
        sheet_code=make_sheet_code(session_id, n),
        original_filename=f.filename,
        image_path=saved_path,
        processing_status='preprocessing',
    )
    db.session.add(sheet); db.session.flush()      # need sheet.sheet_id

    db.session.add(StudentInfo(sheet_id=sheet.sheet_id, **recognized_identity))

    for item, crop in segmented:
        ans = StudentAnswer(
            sheet_id=sheet.sheet_id, item_id=item.item_id,
            crop_path=crop.path, recognized_text=crop.text,
            htr_confidence=crop.confidence,       # 0-1
            model_used=MODEL_NAME, recognized_at=func.now(),
        )
        db.session.add(ans); db.session.flush()

        verdict = grade(crop.text, item)           # match_score is 0-100
        db.session.add(GradingResult(
            sheet_id=sheet.sheet_id, item_id=item.item_id,
            recognized_id=ans.student_answer_id,
            score=verdict.points,  auto_score=verdict.points,
            status=verdict.status, auto_status=verdict.status,
            match_score=verdict.match_score,
        ))

    sheet.processing_status = 'completed'
    session.processed_sheets += 1
```

One `commit`. A crash halfway leaves **no** trace of that sheet rather than a
half-graded one — which is precisely what `failInterruptedSessions()` was
working around in the browser version.

Note `auto_score`/`auto_status` are set to the same values as `score`/`status`
here, and **`auto_*` is never written again**. That is the whole mechanism
behind the Week 8 comparison.

### Saving a manual review — two rows, one commit

```python
with db.session.begin():
    result = db.session.get(GradingResult, result_id)

    if action == 'accepted_correct':
        result.score, result.status = item.points, 'correct'
    elif action == 'marked_incorrect':
        result.score, result.status = 0, 'incorrect'
    else:                                    # manual_answer_override
        result.score, result.status = item.points, 'correct'
        result.match_score = 100

    result.is_manual_override = 1
    # result.auto_status and result.auto_score are deliberately untouched.

    db.session.merge(ManualReview(
        result_id=result_id, reviewed_by=current_user.faculty_id,
        override_action=action,
        original_answer=answer.recognized_text,
        corrected_answer=corrected_text,
        final_score=result.score,
        review_status='corrected' if corrected_text else 'reviewed',
        review_seconds=elapsed,              # for the efficiency objective
        reviewed_at=func.now(),
    ))
```

No total needs updating anywhere. `v_sheet_result` recomputes the sheet's score
the next time it is read.

---

## 6. Integrity checks

Run these before Week 8's analysis. Each should return **zero rows**. When one
doesn't, the backend has a bug — better to find it now than in your results
chapter.

```sql
-- A sheet's answer key must match its session's.
SELECT es.sheet_id FROM exam_sheet es
JOIN grading_session gs ON gs.session_id = es.session_id
WHERE es.answer_key_id <> gs.answer_key_id;

-- Every graded item must be scored against an answer that exists.
SELECT result_id FROM grading_result WHERE recognized_id IS NULL;

-- A score can never exceed the item's points.
SELECT gr.result_id FROM grading_result gr
JOIN answer_key_item aki ON aki.item_id = gr.item_id
WHERE gr.score > aki.points;

-- auto_status must survive review. If a reviewed item lost its original
-- verdict, the accuracy figures are already compromised.
SELECT gr.result_id FROM grading_result gr
JOIN manual_review mr ON mr.result_id = gr.result_id
WHERE gr.is_manual_override = 0;

-- Non-consenting sheets must never have been graded (RA 10173, Chapter 3).
SELECT es.sheet_id FROM exam_sheet es
JOIN student_info si ON si.sheet_id = es.sheet_id
JOIN grading_result gr ON gr.sheet_id = es.sheet_id
WHERE si.consent_status = 'not_consented';
```

---

## 7. The shortest path to a working demo

If the goal is one screen running end-to-end rather than the whole API:

1. Flask app, one blueprint, SQLAlchemy pointed at `ags_db`.
2. Implement **three** endpoints: `POST /api/auth/login`,
   `GET /api/sessions`, `GET /api/sessions/<id>/results`.
3. In the Vue app, add `src/services/api.js` exposing `verifyUser`,
   `sessions`, and `studentResults` with the same signatures, backed by
   `fetch()`.
4. In `DashboardView.vue` and `ResultsView.vue`, change the import from
   `@/services/database.js` to `@/services/api.js`.
5. Enable CORS for `http://localhost:5173`.

The seeded demo data means the Results page renders three real sheets from
MySQL immediately — enough to demonstrate the integration without the pipeline
being finished.

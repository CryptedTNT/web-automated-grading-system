# App ↔ Database Mapping

How the Vue front end's current `localStorage` data lines up with the MySQL
schema, what had to be added to make them fit, and what the Flask backend will
need to do in between.

Read this alongside the migrations in `migrations\` — the comments there give
the reason for each individual column. For the API-level view of the same
ground (endpoints, transactions, integrity checks), see
`INTEGRATION_CONTRACT.md`.

---

## 1. Where the app keeps its data today

`vue-app\src\services\database.js` is a `localStorage` layer. Everything lives
under seven keys in one browser profile:

| localStorage key | Holds | Maps to |
| --- | --- | --- |
| `ags_users` | the teacher account | `faculty` |
| `ags_answer_keys` | exam definitions | `answer_key` |
| `ags_answer_key_items` | questions in a key | `answer_key_item` |
| `ags_sessions` | one processing run | `grading_session` **(new table)** |
| `ags_student_results` | per-sheet totals | `exam_sheet` + `student_info` + view `v_sheet_result` |
| `ags_result_items` | per-question outcome | `student_answer` + `grading_result` + `manual_review` + view `v_result_item` |
| `ags_settings` | preferences object | `app_setting` **(new table)** |

The last three are where the two models genuinely differ, and they are worth
understanding before writing the API.

---

## 2. Field-by-field

### `ags_users` → `faculty`

| App field | Column | Note |
| --- | --- | --- |
| `id` | `faculty_id` | |
| `full_name` | `full_name` | |
| `institution` | `institution` | **added** — the app collects it, the draft ERD had no column |
| `username` | `username` | unique |
| `password_hash` | `password_hash` | |
| `salt` | `password_salt` | **added** — see hashing note below |
| `security_question` | `security_question` | **added** — Forgot Password flow |
| `security_answer_hash` | `security_answer_hash` | **added** |
| `security_answer_salt` | `security_answer_salt` | **added** |
| `created_at` | `created_at` | |
| `last_login` | `last_login_at` | **added** |

### `ags_answer_keys` → `answer_key`

| App field | Column | Note |
| --- | --- | --- |
| `id` | `answer_key_id` | |
| `name` | `title` | **added** — the ERD had `subject` but no key name |
| `subject` | `subject` | |
| — | `faculty_id` | **required by the DB**: every key belongs to a teacher. The app never stored an owner because there is only ever one local account. The API fills this from the signed-in user. |
| — | `year_level`, `section` | from the ERD; the app does not collect them yet |

### `ags_answer_key_items` → `answer_key_item`

| App field | Column | Note |
| --- | --- | --- |
| `item_no` | `item_no` | unique within a key |
| `type` | `question_type` | **label ↔ code mapping needed** (below) |
| `enum_group` | `enum_group` | **added** — only allowed on `ENUMERATION`, enforced by a CHECK |
| `correct_answer` | `correct_answer` | |
| `alternatives` | `alternative_answers` | |
| `points` | `points` | |
| `fuzzy_threshold` | `fuzzy_threshold` | **scale changed** — see below |

**Question type mapping.** The app stores display labels; the database stores
codes. The API translates:

| Database | UI label |
| --- | --- |
| `MC` | Multiple Choice |
| `TF` | True or False |
| `IDENTIFICATION` | Identification |
| `ENUMERATION` | Enumeration |

The view `v_result_item` already returns `question_type_label`, so read paths
usually get this for free; only writes need the reverse map.

**Threshold scale.** The draft ERD had `fuzzy_threshold DECIMAL(4,3)` on a
0.000–1.000 scale. The app's Answer Key editor collects `85`, and the How To Use
page documents "70–99% is flagged". The schema now uses `DECIMAL(5,2)` on a
**0–100 percent** scale, and `grading_result.match_score` uses the same scale,
so the grading check is a direct comparison:

```sql
match_score >= fuzzy_threshold
```

One scale everywhere removes a conversion that is easy to get backwards. If your
matching library returns 0–1, multiply by 100 once, at the boundary.

### `ags_sessions` → `grading_session` (new table)

The draft ERD has no session concept, but the Upload, Processing, Results, and
Reports pages are all organised around one. A session is one batch of sheets
processed against one answer key in one run.

| App field | Column |
| --- | --- |
| `id` | `session_id` |
| `name` | `session_name` |
| `answer_key_id` | `answer_key_id` |
| `folder` | `source_folder` |
| `status` | `status` |
| `created_at` | `started_at` |

Status values are lowercased in the database: `Processing` → `processing`,
`Completed` → `completed`, `Cancelled` → `cancelled`, `Failed` → `failed`.

### `ags_student_results` → `exam_sheet` + `student_info` + `v_sheet_result`

This is the biggest structural difference, and the one to be ready to explain.

The app stores `score`, `total`, `percentage`, and `flagged_count` **on the
result row**, and recalculates them by hand after every manual review
(`recalculateStudentResult()`). The database **does not store those columns**.
They are computed by the view `v_sheet_result` from the item scores.

Why: a stored total can drift out of agreement with the items it summarises —
one missed recalculation and the sheet reports a score its own items do not
support. Deriving it means that cannot happen. A review updates one row, and
every total that depends on it follows.

| App field | Where it comes from |
| --- | --- |
| `id` | `exam_sheet.sheet_id` |
| `session_id` | `exam_sheet.session_id` |
| `student_name` | `student_info.name` |
| `section` | `student_info.section` |
| `image_path` | `exam_sheet.image_path` |
| `score`, `total`, `percentage`, `flagged_count`, `status` | **computed** by `v_sheet_result` |

So `SELECT * FROM v_sheet_result WHERE session_id = ?` returns rows in almost
exactly the shape the Results page already expects.

Two columns the app has no equivalent for, both required:

- **`sheet_code`** — the de-identified handle from the methodology. `NOT NULL`
  and unique; the backend generates it on insert, e.g.
  `AGS-0001-0003`. This is what lets results and reports reference a sheet
  without exposing a name.
- **`student_info.consent_status` / `participant_code`** — the ethics
  requirement that only consenting sheets are processed and results are reported
  by code. Default is `consented`; set it honestly at capture time.

### `ags_result_items` → `student_answer` + `grading_result` (+ `manual_review`)

The app keeps one flat row per graded question. The database splits it in three,
following the ERD, because the three are produced by different stages and at
different times:

- **`student_answer`** — what the *model* read: `crop_path`, `recognized_text`,
  `htr_confidence`, `model_used`. Written by the recognition stage.
- **`grading_result`** — what the *grader* decided: `score`, `status`,
  `match_score`. Written by the grading stage.
- **`manual_review`** — what a *human* decided, and only for items that got one.

The view `v_result_item` joins all three back into the flat shape the Student
Result and Review pages want.

| App field | Column |
| --- | --- |
| `student_answer` | `student_answer.recognized_text` |
| `crop_path` | `student_answer.crop_path` |
| `confidence` | `student_answer.htr_confidence` (a **fraction**, 0–1) |
| `model_used` | `student_answer.model_used` — **added** |
| `match_score` | `grading_result.match_score` (a **percentage**, 0–100) |
| `earned` | `grading_result.score` |
| `status` | `grading_result.status` |
| `auto_status` | `grading_result.auto_status` — **added** |
| `manual_override` | `grading_result.is_manual_override` — **added** |
| `override_action` | `manual_review.override_action` — **added** |
| `remarks` | `grading_result.remarks` |
| `points`, `correct_answer`, `alternatives`, `type`, `enum_group` | read from `answer_key_item`, not copied per result |

Status values: `OK` → `correct`, `Wrong` → `incorrect`, `Flagged` → `flagged`.

> **Note the two confidence scales.** `htr_confidence` is 0–1 (it comes out of
> the model that way) and `match_score` is 0–100 (it is compared against
> `fuzzy_threshold`). Both are CHECK-constrained, so getting one wrong fails
> loudly at insert instead of quietly producing a wrong grade.

**`auto_status` vs `status` is the important one.** `auto_status` and
`auto_score` record what the system decided on its own and are never
overwritten; `status` and `score` are what stands after review. That separation
is what keeps the thesis's accuracy claim measurable *after* teachers have
corrected sheets — the view `v_model_accuracy` reports on `auto_status` only.
Do not collapse these into one column.

### `ags_settings` → `app_setting` (new table)

One row per `(faculty_id, setting_key)`, value stored as JSON. Keys currently in
use: `theme`, `remember_me`, `export_preferences`. Key/value rather than a
column per preference, so a new Settings toggle does not need a migration.

---

## 3. Views, and which page each one serves

| View | Serves |
| --- | --- |
| `v_sheet_result` | Results table, Student Result header, Excel export |
| `v_result_item` | Student Result item table, Review Flagged, Excel export |
| `v_flagged_queue` | Review Flagged, in walk order |
| `v_session_summary` | Dashboard recent sessions, Reports page |
| `v_dashboard_stats` | the four Dashboard tiles |
| `v_model_accuracy` | **the accuracy figures for the manuscript** |

---

## 4. Notes for whoever writes the Flask backend

Not part of this database task — recorded here so it is not re-derived later.

1. **Connection.** `mysql+pymysql://ags_app:PASSWORD@127.0.0.1:3306/ags_db?charset=utf8mb4`.
   Needs `pymysql` **and** `cryptography` (MySQL 8's default auth plugin).
   Credentials from `.env`, never hard-coded.
2. **Connect as `ags_app`, not root.** It has data rights only — it cannot drop
   the schema.
3. **Switch the password hashing.** The seeded account uses the front end's
   SHA-256 + salt scheme so it works today. Move to
   `werkzeug.security.generate_password_hash` / `check_password_hash`, leave
   `password_salt` NULL, and re-hash the demo account.
4. **Generate `sheet_code` on insert** — it is `NOT NULL` and unique.
5. **Wrap a sheet's grading in one transaction.** `exam_sheet` → `student_info`
   → `student_answer` rows → `grading_result` rows should commit together, so a
   crash mid-sheet cannot leave a half-graded record. The app's own
   `failInterruptedSessions()` exists because it has no transactions; the
   database version should not need that workaround.
6. **Read through the views** for anything the UI displays. Do not recompute
   totals in Python — that reintroduces exactly the drift the views prevent.
7. **Do not `SELECT *` from `faculty`** in any endpoint that returns JSON to the
   browser. It contains the password and security-answer hashes. Select explicit
   columns.
8. **Images stay on disk.** The tables hold paths. Settle on an uploads folder,
   store paths relative to it, and back that folder up alongside the SQL dump.

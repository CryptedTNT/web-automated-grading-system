# Migrations

Every change to the database schema happens here, as a numbered script.
Nothing is ever applied by hand.

## The two kinds of script

| Pattern | Behaviour |
| --- | --- |
| `V<nnn>__<description>.sql` | **Versioned.** Runs exactly once, in numeric order. Frozen after it runs. |
| `R__<name>.sql` | **Repeatable.** Re-runs whenever its contents change. Always applied after all `V` scripts. Every statement must be `CREATE OR REPLACE` or otherwise safe to repeat. |

Views live in `R__views.sql` because they get edited constantly during
development — a new column on a report, a different sort order. Forcing a
new numbered file for each tweak would bury the real schema history in noise.

## The one rule

**Never edit a `V` migration that has already been applied.**

The runner stores a SHA-256 checksum of every script it applies. If a `V`
file changes afterwards it refuses to run and tells you which file. This is
not bureaucracy — a database that already applied `V002` will never see your
edit, so your machine and everyone else's would silently diverge, and neither
would match what the scripts say.

Need to change something already applied? **Write a new migration.**

```sql
-- V004__add_scan_dpi_to_exam_sheet.sql
ALTER TABLE exam_sheet ADD COLUMN scan_dpi SMALLINT UNSIGNED NULL AFTER image_path;
```

The only exception is a database with nothing real in it yet: run
`bootstrap\99_reset.sql` and start clean. **That exception expires in Week 7**,
when real collected exam sheets land in the tables.

## Running them

```powershell
.\tools\migrate.ps1 -LoginPath ags
```

| Flag | Effect |
| --- | --- |
| `-Status` | Show applied / pending / changed. Changes nothing. |
| `-DryRun` | List what would run, in order, without running it. |
| `-Seed` | After migrating, load `seed\demo_data.sql`. Refuses if the database already has data. |

Authentication is via a stored login path, so no password is ever typed,
echoed, or written to disk by the script. Set it up once:

```powershell
mysql_config_editor set --login-path=ags --host=127.0.0.1 --user=root --password
```

Without `-LoginPath` the script prompts and uses a temporary option file that
it deletes when the run ends. Either way the password never appears in the
command line, where any other user on the machine could read it out of the
process list.

## The ledger

`schema_migration` records every application:

| Column | Meaning |
| --- | --- |
| `version` | `001`, `002`, … or `R` |
| `script_name` | file applied |
| `checksum` | SHA-256, for the frozen-file check |
| `applied_at` | **when it landed** |
| `execution_ms` | how long it took |

```sql
SELECT version, script_name, applied_at FROM schema_migration ORDER BY applied_at;
```

That output is a timestamped, machine-generated record of the database being
built up in stages — useful evidence for the weekly monitoring sheet, and a
straight answer if a panel member asks how the schema was managed.

## What is here, and which week it belongs to

| Script | WAIM week | Milestone it serves |
| --- | --- | --- |
| `V001__core_users_and_answer_keys.sql` | **3** (Aug 10–16) | "Initial system modules and database set up" — faculty, answer keys, key items. |
| `V002__sheets_recognition_and_grading.sql` | **4** (Aug 17–23) | "Segmentation, recognition, grading modules" — the tables all three write into. |
| `V003__review_reports_and_settings.sql` | **5–6** (Aug 24 – Sep 6) | "Functional end-to-end system prototype" — human review, exports, preferences. |
| `R__views.sql` | **5–6** | The derived reads every page depends on. |

The split follows the layer boundaries in the approved ERD, and each slice is
what that week's modules actually need — `V001` alone is enough to build and
test the Answer Keys page, `V002` adds everything the pipeline writes.

## Still to come

| Week | Expected migration |
| --- | --- |
| **7** (Sep 7–13) | Real-data ingestion support: participant-code generation, consent gating, dataset validation queries. |
| **8** (Sep 14–20) | The manual-vs-automated comparison — accuracy and efficiency queries feeding Chapter 4. Likely `R__analysis.sql`, since those get rewritten as the analysis firms up. |
| **9** (Sep 21–27) | ISO/IEC 25010 evidence: index tuning and query timings. |

Numbers are not reserved in advance — take the next free one when you write it.

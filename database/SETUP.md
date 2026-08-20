# Database Setup Guide

Automated Grading System for Handwritten Objective Examinations Using Deep Learning

Everything needed to get the database running on a Windows machine, and to
get your IDE talking to it. Follow the sections in order the first time.

---

## 0. What you are installing, and why

| Piece | Why it is needed |
| --- | --- |
| **MySQL Community Server 8.0+** | The database engine itself. The schema uses InnoDB foreign keys and CHECK constraints, so **8.0.16 or newer**. |
| **MySQL Workbench** | Official GUI. Used to run the scripts, browse tables, and export the ERD picture for the manuscript. |
| **VS Code + a SQL extension** | So you can write and run `.sql` files without leaving your editor. |

You do **not** need Node.js, Python, or the Vue app to complete this guide.
The database stands on its own.

---

## 1. Install MySQL Server

> **Which version, and why.** MySQL Installer is **deprecated and installs
> MySQL 8.0 only** — Oracle's download page states "MySQL 8.0 is the final
> series with MySQL Installer. As of MySQL 8.1, use a MySQL product's MSI or
> Zip archive." This guide uses the Installer anyway, because it configures
> the server and bundles **MySQL Workbench** in one wizard, and 8.0.46 is far
> past the 8.0.16 the CHECK constraints need.
>
> The tradeoff is that **MySQL 8.0 reached end-of-life in April 2026**, so it
> stops receiving security patches. For a local, non-internet-facing thesis
> database that is acceptable. If this system is ever deployed on a real
> server, move to **MySQL 8.4 LTS**: download the standalone
> `mysql-8.4.x-winx64.msi` plus MySQL Workbench separately, and configure via
> the bundled MySQL Configurator. The schema and scripts run unchanged on 8.4 —
> only the install paths below change from `MySQL Server 8.0` to
> `MySQL Server 8.4`.

1. Download the **MySQL Installer for Windows** from
   <https://dev.mysql.com/downloads/installer/>. Take the larger
   `mysql-installer-community-8.0.46.0.msi` (~566 MB) rather than the 2 MB
   `-web-` one — the web version downloads the same components anyway and
   needs a live connection throughout setup.
2. Run it and choose **Custom**, then select:
   - MySQL Server 8.0.x
   - MySQL Workbench 8.0.x
   - MySQL Shell (optional but handy)
3. **Type and Networking** — accept `Development Computer`, port **3306**.
4. **Authentication Method** — choose **"Use Strong Password Encryption"**
   (`caching_sha2_password`), the default.
   > If you later hit `Authentication plugin 'caching_sha2_password' cannot be
   > loaded` from an old client library, see [Troubleshooting](#8-troubleshooting)
   > rather than weakening this setting.
5. **Accounts and Roles** — set a **root password** and write it down. You will
   need it for every script in section 3.
6. **Windows Service** — leave "Start the MySQL Server at System Startup"
   ticked, service name `MySQL80`.
7. Finish, then **Execute** to apply the configuration.

### Verify the install

Open a new PowerShell window and run:

```bash
mysql --version
```

If you get `'mysql' is not recognized`, the client is not on your PATH.

The safe way to fix it permanently: press **Win**, type *"Edit the system
environment variables"* → **Environment Variables** → under **User variables**
select **Path** → **Edit** → **New** → paste:

```
C:\Program Files\MySQL\MySQL Server 8.0\bin
```

Then close and reopen PowerShell and check `mysql --version` again.

> Do **not** use `setx PATH "$env:PATH;..."` for this. `$env:PATH` is the
> *combined* machine + user path, so that command copies the whole thing into
> your user variable, and `setx` silently truncates anything past 1024
> characters. It is a well-known way to corrupt your PATH.

To just get through this guide without changing anything, add the folder for the
current window only — it lasts until you close it:

```bash
$env:PATH += ";C:\Program Files\MySQL\MySQL Server 8.0\bin"
```

Confirm the service is running:

```bash
Get-Service MySQL80
```

`Status` should be `Running`. If it is `Stopped`:

```bash
Start-Service MySQL80
```

---

## 2. The files in this folder

```
Database Schema\
├── ags_schema.sql              <- the original approved ERD script (reference only)
├── SETUP.md                    <- this file
├── APP_MAPPING.md              <- how each table maps to the Vue app
├── INTEGRATION_CONTRACT.md     <- what Flask must do, endpoint by endpoint
├── .env.example                <- connection settings template for the backend
├── bootstrap\
│   ├── 01_create_database.sql    creates ags_db + the ags_app user (root, once)
│   └── 99_reset.sql              DROPS EVERYTHING -- only to start over
├── migrations\                 <- THE SCHEMA. See migrations\README.md.
│   ├── V001__core_users_and_answer_keys.sql
│   ├── V002__sheets_recognition_and_grading.sql
│   ├── V003__review_reports_and_settings.sql
│   └── R__views.sql
├── seed\
│   └── demo_data.sql             demo data (one class, three sheets)
└── tools\
    └── migrate.ps1               applies pending migrations
```

**`migrations\` is the single source of truth for the schema.** There is no
second copy of the table definitions anywhere — that is deliberate, because two
copies drift and then nobody can say which is real. To see the current schema,
read the migrations, or dump the live database:

```bash
mysqldump -u root -p --no-data ags_db --result-file=current_schema.sql
```

`ags_schema.sql` in the root is the original approved ERD script, kept untouched
for reference. The migrations implement that design and extend it to cover what
the app actually stores; `APP_MAPPING.md` lists every difference and why.

---

## 3. Create the database

> **Do not use `mysql -u root -p < script.sql` in PowerShell.** PowerShell
> reserves `<` for future use and fails with *"The '<' operator is reserved for
> future use."* That form works only in `cmd.exe` or bash. Use the client's own
> `source` command instead, as below — it is shell-independent and only asks
> for the password once.

Open PowerShell and move into this folder:

```bash
cd "C:\Users\Sojie\Desktop\Database Thesis\Database Schema"
```

Start the MySQL client as root:

```bash
mysql -u root -p
```

Type the root password you set in section 1. At the `mysql>` prompt, create the
database and the application account:

```sql
source bootstrap/01_create_database.sql
```

Then set a real password for `ags_app` — **replace `PutYourOwnPasswordHere`**
with one you choose, and write it down (the Flask developer will need it):

```sql
ALTER USER 'ags_app'@'localhost' IDENTIFIED BY 'PutYourOwnPasswordHere';
```

> The placeholder in `01_create_database.sql` is left deliberately fake. Don't
> put your real password in that file — it is a thesis deliverable you will
> share with an adviser and possibly submit with the paper.

```sql
EXIT;
```

### Step 2 — apply the migrations

Store your credentials once, encrypted by MySQL, so no password is ever typed
into a script or left in your shell history:

```bash
mysql_config_editor set --login-path=ags --host=127.0.0.1 --user=root --password
```

Then create every table and view:

```bash
.\tools\migrate.ps1 -LoginPath ags -Seed
```

That applies `V001` → `V002` → `V003` → `R__views` in order, records each one in
the `schema_migration` ledger with a checksum and timestamp, and loads the demo
dataset. Re-running it is safe: already-applied migrations are skipped.

To see the state at any time without changing anything:

```bash
.\tools\migrate.ps1 -LoginPath ags -Status
```

See `migrations\README.md` for the conventions — in particular, **never edit a
migration that has already been applied.**

### Prefer clicking to typing?

In MySQL Workbench: open the connection → **File → Open SQL Script** → pick
`bootstrap\01_create_database.sql` → click the **lightning bolt** to execute.
You can run the migration files the same way, in filename order, but then
nothing is recorded in `schema_migration` and the runner will try to apply them
again. Use `migrate.ps1` unless you have a reason not to.

---

## 4. Verify it worked

```bash
mysql -u root -p ags_db -e "SHOW TABLES;"
```

You should see 12 tables and 6 views:

```
answer_key, answer_key_item, app_setting, exam_sheet, faculty,
grading_result, grading_session, manual_review, report,
schema_migration, student_answer, student_info

v_dashboard_stats, v_flagged_queue, v_model_accuracy,
v_result_item, v_session_summary, v_sheet_result
```

`schema_migration` is the ledger the runner maintains — it is not part of the
ERD. Confirm it recorded the four scripts:

```bash
mysql -u root -p ags_db -e "SELECT version, script_name, applied_at FROM schema_migration ORDER BY id;"
```

Now check that the grading logic adds up:

```bash
mysql -u root -p ags_db -e "SELECT sheet_code, student_name, score, total, percentage, flagged_count, status FROM v_sheet_result ORDER BY sheet_id;"
```

Expected:

| sheet_code | student_name | score | total | percentage | flagged_count | status |
| --- | --- | --- | --- | --- | --- | --- |
| AGS-0001-0001 | Ana Reyes | 12.00 | 12.00 | 100.00 | 0 | OK |
| AGS-0001-0002 | Ben Cruz | 9.00 | 12.00 | 75.00 | 1 | Flagged |
| AGS-0001-0003 | Carla Domingo | 12.00 | 12.00 | 100.00 | 0 | OK |

If those three rows match, the schema, the foreign keys, and the views are all
correct. **This is a good screenshot for the manuscript.**

Confirm the application user can connect too:

```bash
mysql -u ags_app -p ags_db -e "SELECT COUNT(*) AS sheets FROM exam_sheet;"
```

---

## 5. IDE setup

### 5a. MySQL Workbench (use this for the ERD diagram)

1. Open Workbench → **+** beside "MySQL Connections".
2. Fill in:

   | Field | Value |
   | --- | --- |
   | Connection Name | `AGS Local` |
   | Hostname | `127.0.0.1` |
   | Port | `3306` |
   | Username | `root` (or `ags_app` for day-to-day work) |
   | Default Schema | `ags_db` |

3. **Test Connection**, then OK.

**To generate the ERD for your paper:** **Database → Reverse Engineer** → pick
the `AGS Local` connection → Next through the prompts → select `ags_db` →
Execute. Workbench draws the full diagram with every relationship. Rearrange the
boxes, then **File → Export → Export as PNG**.

### 5b. VS Code

Install one of these extensions (either is fine — the first is simpler):

- **MySQL** by Weijan Chen (`cweijan.vscode-mysql-client2`) — tree view, run
  queries, edit table data inline.
- **SQLTools** (`mtxr.sqltools`) **plus** the **SQLTools MySQL/MariaDB Driver**
  (`mtxr.sqltools-driver-mysql`).

From the command line:

```bash
code --install-extension cweijan.vscode-mysql-client2
```

Then in VS Code: click the new database icon in the sidebar → **Create
Connection** → MySQL → host `127.0.0.1`, port `3306`, user `ags_app`,
password as set, database `ags_db`.

Once connected, opening any file in `sql\` gives you a **Run** action, and you
get autocomplete for your own table and column names.

**Optional — commit the connection profile for your teammates.** Create
`.vscode\settings.json` in the project with:

```json
{
  "sqltools.connections": [
    {
      "name": "AGS Local",
      "driver": "MySQL",
      "server": "127.0.0.1",
      "port": 3306,
      "database": "ags_db",
      "username": "ags_app"
    }
  ]
}
```

Leave the password out of that file and let the extension prompt for it —
never commit a password.

### 5c. DBeaver (alternative, if you prefer it)

Download from <https://dbeaver.io>. **New Database Connection → MySQL** → same
host/port/user/database as above. DBeaver downloads the JDBC driver on first
connect. Its **ER Diagram** tab on the `ags_db` schema is another way to produce
a diagram for the paper.

---

## 6. Connection settings (hand these to whoever writes the Flask backend)

| Setting | Value |
| --- | --- |
| Host | `127.0.0.1` |
| Port | `3306` |
| Database | `ags_db` |
| User | `ags_app` |
| Password | whatever you set in section 3 |
| Charset | `utf8mb4` |

`.env.example` in this folder is a ready-made template. The backend copies it to
`.env`, fills in the password, and **`.env` is never committed**.

For a Flask + SQLAlchemy backend the connection string is:

```
mysql+pymysql://ags_app:PASSWORD@127.0.0.1:3306/ags_db?charset=utf8mb4
```

which needs `pip install flask-sqlalchemy pymysql cryptography`. (`cryptography`
is what lets PyMySQL speak MySQL 8's default `caching_sha2_password` auth — it
is easy to miss and the error it causes is confusing.)

`APP_MAPPING.md` documents which table backs which screen, so the backend work
does not have to re-derive it.

---

## 7. Backup and restore

Back up before every risky change, and before the defense. Use
`--result-file`, **not** `>` redirection:

```bash
mysqldump -u root -p --databases ags_db --routines --triggers --result-file=ags_backup_2026-08-03.sql
```

> **Why not `> file.sql`?** PowerShell's redirection writes **UTF-16**, which
> MySQL cannot read back — the restore fails with a syntax error on line 1 and
> the cause is not obvious. `--result-file` has mysqldump write the file itself,
> in the right encoding, on any shell.

Restore — again via the client's `source`, since `<` is unavailable in
PowerShell:

```bash
mysql -u root -p
```

```sql
source ags_backup_2026-08-03.sql
```

Keep at least one backup somewhere that is not this laptop. Note that a dump
contains the faculty password hashes and salts — treat it as private, and do not
commit it to the repository.

---

## 8. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `The '<' operator is reserved for future use.` | You used `mysql ... < file.sql` in PowerShell. PowerShell has no input redirection — use `source file.sql` inside the client instead (section 3). |
| A restored dump fails with a syntax error on line 1 | The dump was written with PowerShell `>`, so it is UTF-16. Re-create it with `mysqldump --result-file=...` (section 7). |
| `'mysql' is not recognized` | The MySQL `bin` folder is not on PATH. See section 1. |
| `ERROR 1045 (28000): Access denied for user 'root'@'localhost'` | Wrong root password. Re-run the MySQL Installer → Reconfigure to reset it. |
| `ERROR 2003: Can't connect to MySQL server on '127.0.0.1'` | The service is not running: `Start-Service MySQL80`. |
| `ERROR 1064 ... near 'CHECK'` | MySQL is older than 8.0.16. Upgrade — or delete the `CONSTRAINT chk_*` lines, and enforce those rules in the backend instead. |
| `ERROR 1215: Cannot add foreign key constraint` | A migration ran out of order, or a previous run half-completed. Run `bootstrap\99_reset.sql`, then `migrate.ps1` again. |
| `V002__... was edited after it was applied` | You changed a migration that already ran. Revert it and put the change in a new `V004__` file — see `migrations\README.md`. |
| `ERROR 1050: Table 'faculty' already exists` | The schema is already installed. That is fine — skip step 2, or reset first if you want it clean. |
| `ERROR 3819: Check constraint 'chk_item_enumgroup' is violated` | You gave an `enum_group` to a non-enumeration item. Only `ENUMERATION` rows may have a group. |
| `ERROR 1364: Field 'sheet_code' doesn't have a default value` | Every sheet needs a de-identified code; the backend must generate one on insert. See the note in `V002__sheets_recognition_and_grading.sql`. |
| PyMySQL: `cryptography package is required` | `pip install cryptography` (see section 6). |
| Non-English characters look like `?` | The client is not using utf8mb4. Add `--default-character-set=utf8mb4` to the `mysql` command. |

---

## 9. What is *not* done yet

Being straight about the boundary, since this affects what you can claim:

- **The Vue app still uses `localStorage`, not this database.** `vue-app` is a
  front end with no backend; it cannot reach MySQL directly — browsers cannot
  open database connections. Wiring it up needs the Flask API in between. That
  work is not part of this database task.
- **No data has been migrated** out of anyone's browser into these tables.
- **Password hashing is SHA-256 with a per-user salt**, carried over from the
  front end so the seeded demo account works today. The Flask backend should
  move to `werkzeug.security` or bcrypt; see the note in
  `migrations\V001__core_users_and_answer_keys.sql`.
- **The uploaded images and crops live on disk**, not in the database. The
  tables store paths (`image_path`, `crop_path`). Decide where that folder
  lives before collecting real data, and back it up alongside the SQL dump —
  a database backup alone does not include the images.

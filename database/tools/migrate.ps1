<#
.SYNOPSIS
    Applies pending database migrations for the Automated Grading System.

.DESCRIPTION
    Forward-only migration runner. Two kinds of script live in
    ..\migrations:

      V<nnn>__<description>.sql   Versioned. Runs exactly once, in
                                  numeric order. Once applied, the file
                                  is frozen -- editing it is detected and
                                  refused, because the change would never
                                  reach a database that already ran it.

      R__<name>.sql               Repeatable. Re-runs whenever its
                                  contents change. Every statement must
                                  be CREATE OR REPLACE / idempotent.
                                  Used for views. Always applied last.

    Every application is recorded in the schema_migration table with a
    SHA-256 checksum and a timestamp, so the database itself carries an
    auditable record of when each change landed.

.PARAMETER LoginPath
    Name of a stored mysql_config_editor login path. This is the
    preferred way to authenticate -- the password is stored encrypted by
    MySQL and never typed, echoed, or written to a file by this script:

        mysql_config_editor set --login-path=ags --host=127.0.0.1 --user=root --password

    Without it, the script prompts for a password and writes it to a
    temporary option file that is deleted when the run finishes.

.PARAMETER Status
    Show what is applied and what is pending, then exit. Changes nothing.

.PARAMETER DryRun
    List the scripts that would run, in order, without running them.

.PARAMETER Seed
    After migrating, load ..\seed\demo_data.sql. Sample data only --
    never use this on a database holding real collected exam sheets.

.EXAMPLE
    .\migrate.ps1 -LoginPath ags
    Apply everything pending.

.EXAMPLE
    .\migrate.ps1 -LoginPath ags -Status
    Show current migration state.

.EXAMPLE
    .\migrate.ps1 -LoginPath ags -Seed
    Apply pending migrations, then load the demo dataset.
#>

[CmdletBinding()]
param(
    [string]$Database = 'ags_db',
    [string]$LoginPath,
    [string]$User = 'root',
    [string]$DbHost = '127.0.0.1',
    [int]$Port = 3306,
    [switch]$Status,
    [switch]$DryRun,
    [switch]$Seed
)

$ErrorActionPreference = 'Stop'

# Piping SQL into mysql.exe goes through $OutputEncoding. Left at the
# default, anything outside ASCII is mangled -- which would silently
# corrupt recognised handwriting text on its way into the database.
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$root          = Split-Path -Parent $PSScriptRoot
$migrationsDir = Join-Path $root 'migrations'
$seedFile      = Join-Path $root 'seed\demo_data.sql'

# ---------------------------------------------------------------------
# Locate the client
# ---------------------------------------------------------------------
$mysqlCmd = Get-Command mysql -ErrorAction SilentlyContinue
if ($mysqlCmd) {
    $mysqlExe = $mysqlCmd.Source
} else {
    $fallback = 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe'
    if (Test-Path $fallback) {
        $mysqlExe = $fallback
    } else {
        throw "mysql.exe not found. Add MySQL's bin folder to PATH, or edit the fallback path in this script."
    }
}

# ---------------------------------------------------------------------
# Credentials
#
# A password must never appear in the command line -- on Windows any
# other user can read a process's arguments, so `mysql -pSecret` leaks
# it. Both branches below keep it out of argv.
# ---------------------------------------------------------------------
$tempCnf = $null

# Whichever credential source is used, it MUST be the first argument on
# the command line. mysql parses --login-path and --defaults-extra-file
# before anything else, and rejects them outright if another option comes
# first -- with the thoroughly unhelpful message
# "unknown variable 'login-path=ags'".
$credArgs = @()

if ($LoginPath) {
    $credArgs = @("--login-path=$LoginPath")
} else {
    Write-Host "No -LoginPath given. Enter the MySQL password for '$User'." -ForegroundColor Yellow
    Write-Host "  (Tip: run 'mysql_config_editor set --login-path=ags --host=$DbHost --user=$User --password' once," -ForegroundColor DarkGray
    Write-Host "   then use -LoginPath ags and you will never be asked again.)" -ForegroundColor DarkGray
    $secure = Read-Host -Prompt "Password" -AsSecureString
    $bstr   = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }

    $tempCnf = Join-Path $env:TEMP ("ags_migrate_{0}.cnf" -f ([guid]::NewGuid().ToString('N')))
    $cnfBody = "[client]`nuser=$User`nhost=$DbHost`nport=$Port`npassword=`"$plain`"`n"
    [System.IO.File]::WriteAllText($tempCnf, $cnfBody, (New-Object System.Text.UTF8Encoding($false)))
    $plain = $null

    $credArgs = @("--defaults-extra-file=$tempCnf")
}

$baseArgs = $credArgs + @("--default-character-set=utf8mb4")

# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------
function Invoke-Sql {
    <# Runs a SQL string. Returns raw tab-separated output. Throws on failure. #>
    param([string]$Sql, [string]$Db, [switch]$NoDatabase)

    $callArgs = @($baseArgs)
    if (-not $NoDatabase) {
        $target = $Db
        if (-not $target) { $target = $Database }
        $callArgs += "--database=$target"
    }
    $callArgs += @("--batch", "--silent")

    $output = $Sql | & $mysqlExe @callArgs
    if ($LASTEXITCODE -ne 0) {
        throw "mysql exited with code $LASTEXITCODE."
    }
    return $output
}

function Get-FileChecksum {
    param([string]$Path)
    # Hash the file's CONTENT with line endings normalised -- not its raw
    # bytes. Git can check the same migration out as LF on one machine and
    # CRLF on another; hashing bytes would make an untouched file look
    # edited, and the drift guard would stop a fresh clone dead for no
    # reason. Normalising means the checksum tracks what the SQL actually
    # says, which is the thing worth protecting.
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $text  = [System.IO.File]::ReadAllText($Path) -replace "`r`n", "`n"
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
        return ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').ToLower()
    } finally {
        $sha.Dispose()
    }
}

function ConvertTo-SqlLiteral {
    param([string]$Value)
    if ($null -eq $Value) { return 'NULL' }
    return "'" + ($Value -replace '\\', '\\\\' -replace "'", "''") + "'"
}

# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------
try {
    # --- database reachable? --------------------------------------------
    try {
        Invoke-Sql -Sql "SELECT 1;" -NoDatabase | Out-Null
    } catch {
        # Keep the client's own message. Swallowing it and printing a
        # generic "check the service" line hides the actual cause --
        # a bad option, a missing login path, a wrong port.
        throw "Cannot connect to MySQL at ${DbHost}:${Port}.`n  mysql said: $($_.Exception.Message)`n  Check that the MySQL80 service is running and the credentials are right."
    }

    $exists = Invoke-Sql -NoDatabase -Sql @"
SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '$Database';
"@
    if ("$exists".Trim() -eq '0') {
        throw "Database '$Database' does not exist. Run bootstrap\01_create_database.sql as root first (see SETUP.md section 3)."
    }

    # --- migration ledger ------------------------------------------------
    Invoke-Sql -Sql @"
CREATE TABLE IF NOT EXISTS schema_migration (
    id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    version       VARCHAR(20)   NOT NULL,        -- '001'..., or 'R' for repeatable
    script_name   VARCHAR(255)  NOT NULL,
    description   VARCHAR(255)  NULL,
    checksum      CHAR(64)      NOT NULL,        -- SHA-256 of the file
    applied_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    execution_ms  INT UNSIGNED  NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_migration_script (script_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"@ | Out-Null

    # --- read what is already applied ------------------------------------
    $appliedRows = Invoke-Sql -Sql "SELECT script_name, checksum, applied_at FROM schema_migration;"
    $applied = @{}
    foreach ($line in $appliedRows) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $parts = $line -split "`t"
        $applied[$parts[0]] = [pscustomobject]@{
            Checksum  = $parts[1]
            AppliedAt = $parts[2]
        }
    }

    # --- discover scripts -------------------------------------------------
    if (-not (Test-Path $migrationsDir)) { throw "Migrations folder not found: $migrationsDir" }

    $versioned = Get-ChildItem $migrationsDir -Filter 'V*__*.sql' |
                 Sort-Object { [int]($_.Name -replace '^V0*(\d+)__.*$', '$1') }
    $repeatable = Get-ChildItem $migrationsDir -Filter 'R__*.sql' | Sort-Object Name

    # --- status mode -------------------------------------------------------
    if ($Status) {
        Write-Host ""
        Write-Host "Migration status for '$Database'" -ForegroundColor Cyan
        Write-Host ("-" * 78)
        foreach ($f in @($versioned) + @($repeatable)) {
            $sum = Get-FileChecksum $f.FullName
            if ($applied.ContainsKey($f.Name)) {
                if ($applied[$f.Name].Checksum -eq $sum) {
                    $state = "APPLIED"; $colour = "Green"
                } elseif ($f.Name -like 'R__*') {
                    $state = "CHANGED (will re-apply)"; $colour = "Yellow"
                } else {
                    $state = "MODIFIED AFTER APPLYING"; $colour = "Red"
                }
                $when = $applied[$f.Name].AppliedAt
            } else {
                $state = "PENDING"; $colour = "Yellow"; $when = "-"
            }
            Write-Host ("{0,-46} {1,-24} {2}" -f $f.Name, $state, $when) -ForegroundColor $colour
        }
        Write-Host ""
        return
    }

    # --- integrity check before doing anything -----------------------------
    # A versioned migration that changed after being applied means this
    # database and the scripts have diverged. Applying the rest on top
    # would produce a schema nobody can reproduce, so stop here.
    foreach ($f in $versioned) {
        if ($applied.ContainsKey($f.Name)) {
            $sum = Get-FileChecksum $f.FullName
            if ($applied[$f.Name].Checksum -ne $sum) {
                throw @"
$($f.Name) was edited after it was applied on $($applied[$f.Name].AppliedAt).

Versioned migrations are frozen once they run -- a database that already
applied this file will never see the edit, so the two would silently drift.

Fix it one of these ways:
  * Revert the file to its applied state, and put the change in a NEW
    V-migration (this is almost always the right answer), or
  * if nothing real is stored yet, run bootstrap\99_reset.sql and start clean.
"@
            }
        }
    }

    # --- build the work list -----------------------------------------------
    $pending = @()
    foreach ($f in $versioned) {
        if (-not $applied.ContainsKey($f.Name)) { $pending += $f }
    }
    foreach ($f in $repeatable) {
        $sum = Get-FileChecksum $f.FullName
        if (-not $applied.ContainsKey($f.Name) -or $applied[$f.Name].Checksum -ne $sum) {
            $pending += $f
        }
    }

    if ($pending.Count -eq 0) {
        Write-Host "Database '$Database' is up to date. Nothing to apply." -ForegroundColor Green
    } elseif ($DryRun) {
        Write-Host ""
        Write-Host "Would apply $($pending.Count) script(s), in this order:" -ForegroundColor Cyan
        foreach ($f in $pending) { Write-Host "  $($f.Name)" }
        Write-Host ""
        Write-Host "(dry run -- nothing was changed)" -ForegroundColor DarkGray
        return
    } else {
        Write-Host ""
        Write-Host "Applying $($pending.Count) script(s) to '$Database'..." -ForegroundColor Cyan

        foreach ($f in $pending) {
            $sum  = Get-FileChecksum $f.FullName
            $sql  = [System.IO.File]::ReadAllText($f.FullName)

            if ($f.Name -match '^V0*(\d+)__(.+)\.sql$') {
                $version = $Matches[1].PadLeft(3, '0')
                $desc    = $Matches[2] -replace '_', ' '
            } elseif ($f.Name -match '^R__(.+)\.sql$') {
                $version = 'R'
                $desc    = $Matches[1] -replace '_', ' '
            } else {
                $version = '?'
                $desc    = $f.BaseName
            }

            Write-Host ("  -> {0} ... " -f $f.Name) -NoNewline
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            Invoke-Sql -Sql $sql | Out-Null
            $sw.Stop()
            $ms = [int]$sw.ElapsedMilliseconds

            # Recorded only after the script itself succeeded, so a failed
            # migration is never marked as applied.
            $recordSql = @"
INSERT INTO schema_migration (version, script_name, description, checksum, execution_ms)
VALUES ($(ConvertTo-SqlLiteral $version), $(ConvertTo-SqlLiteral $f.Name),
        $(ConvertTo-SqlLiteral $desc), $(ConvertTo-SqlLiteral $sum), $ms)
ON DUPLICATE KEY UPDATE
    checksum     = VALUES(checksum),
    description  = VALUES(description),
    execution_ms = VALUES(execution_ms),
    applied_at   = CURRENT_TIMESTAMP;
"@
            Invoke-Sql -Sql $recordSql | Out-Null
            Write-Host ("ok ({0} ms)" -f $ms) -ForegroundColor Green
        }
        Write-Host "Done." -ForegroundColor Green
    }

    # --- optional demo data -------------------------------------------------
    if ($Seed) {
        if (-not (Test-Path $seedFile)) { throw "Seed file not found: $seedFile" }

        $rows = Invoke-Sql -Sql "SELECT COUNT(*) FROM faculty;"
        if ("$rows".Trim() -ne '0') {
            Write-Host ""
            Write-Host "Skipping -Seed: '$Database' already contains faculty rows." -ForegroundColor Yellow
            Write-Host "Demo data is only for an empty database. Loading it over real" -ForegroundColor Yellow
            Write-Host "collected data would collide on the seeded primary keys." -ForegroundColor Yellow
        } else {
            Write-Host ""
            Write-Host "Loading demo data..." -ForegroundColor Cyan
            Invoke-Sql -Sql ([System.IO.File]::ReadAllText($seedFile)) | Out-Null
            Write-Host "Demo data loaded." -ForegroundColor Green
        }
    }

    # --- summary -------------------------------------------------------------
    Write-Host ""
    Write-Host "Current state:" -ForegroundColor Cyan
    $summary = Invoke-Sql -Sql @"
SELECT CONCAT(version, '  ', script_name, '  ', applied_at) FROM schema_migration ORDER BY applied_at, id;
"@
    foreach ($line in $summary) { if ($line) { Write-Host "  $line" } }
    Write-Host ""

} finally {
    if ($tempCnf -and (Test-Path $tempCnf)) {
        Remove-Item $tempCnf -Force -ErrorAction SilentlyContinue
    }
}

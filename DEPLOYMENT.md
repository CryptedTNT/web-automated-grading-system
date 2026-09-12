# Deployment — small-scale real use (system usability testing)

This is for actually putting the app on the internet for a handful of real
teachers to use on an ongoing basis (e.g. for SUT), on a budget VPS — not a
one-off demo. If you just need something reachable for a defense demo on
your own GPU machine, that's a different (simpler, free) setup — ask if you
need that version instead.

## Why a single budget VPS works here

The one real constraint is that `backend/models/` runs on whatever device
PyTorch finds — `recognizer.py` already picks `"cuda" if torch.cuda.is_available()
else "cpu"`, and Ultralytics' `YOLO(...)` does the same. **No code changes
are needed to run on CPU** — it's already handled. A cheap VPS has no GPU,
so each sheet will take noticeably longer to grade than on your dev
machine's RTX 3070 (seconds instead of a fraction of a second) — for a
small usability test with a handful of teachers uploading sheets
occasionally, not a real classroom's full live batch, that's very likely a
non-issue. If SUT feedback says grading feels slow, that's the signal to
reconsider (a cloud GPU instance, or optimizing batch size) — don't
pre-optimize for it now.

**Sizing**: this box runs MySQL + the FastAPI backend (PyTorch + Ultralytics
+ Transformers loaded in memory) + a reverse proxy, all on one machine.
Aim for **at least 8 GB RAM** — a 4 GB plan will likely be tight once
MySQL, the OS, and both ML models are resident at once. As of this writing,
Hostinger's KVM 2 plan (2 vCPU / 8 GB RAM, NVMe SSD) lands right in that
spot at roughly $9/month on a multi-year term — DigitalOcean, Linode
(Akamai), and Vultr all have a directly comparable ~8 GB VPS tier in a
similar price band if you want to compare. Any of them work the same way
below; nothing here is Hostinger-specific except the exact number.

## Architecture

```
Internet → HTTPS (Caddy, auto cert) → serves vue-app/dist (static files)
                                     → reverse-proxies /api/* → uvicorn (127.0.0.1:8000)
                                                                       → MySQL (127.0.0.1:3306)
```

One public entry point (Caddy on 80/443). The backend and MySQL are never
exposed to the internet directly — only reachable from the proxy on the
same machine. This also sidesteps CORS/cross-origin cookie issues entirely,
the same reason the Vite dev proxy works locally (see `vite.config.js`).

## Steps

1. **Provision the VPS** (Ubuntu 22.04/24.04 is the easy default), point a
   domain's A record at its IP. A subdomain off something you already own
   is fine and cheapest; a fresh domain is ~$10-15/year if you don't have
   one.

2. **Install system dependencies**:
   ```
   sudo apt update
   sudo apt install -y python3.13 python3.13-venv mysql-server nodejs npm git
   ```
   (Match the Python version to what you developed against.)

3. **Secure MySQL** (`sudo mysql_secure_installation`), then create the
   database and app user exactly as in `database/SETUP.md` section 3 — same
   `ags_db` / `ags_app` setup, just run on this machine instead of locally.

4. **Clone the repo** to e.g. `/opt/ags`, then **upload the model weights**
   separately (they're gitignored) — `scp` `backend/models/yolo/best.pt`
   and the `backend/models/htr/` directory from your dev machine.

5. **Run the migrations.** `database/tools/migrate.ps1` is PowerShell-only;
   on a Linux box just run the raw SQL files directly in order instead:
   ```
   cd database/migrations
   for f in V001*.sql V002*.sql V003*.sql V004*.sql V005*.sql V006*.sql; do
     mysql -u root -p ags_db < "$f"
   done
   mysql -u root -p ags_db < R__views.sql
   ```

6. **Set up the backend** — per `backend/SETUP.md`, but skip the CUDA index
   URL step from that guide. Instead, install the CPU-only torch build
   first (the plain PyPI torch wheel would still *work* on CPU, but it
   bundles unused CUDA libraries that just eat disk space you don't have
   much of on a budget VPS):
   ```
   cd backend
   python3.13 -m venv venv
   source venv/bin/activate
   pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
   pip install -r requirements.txt
   cp .env.example .env   # then edit it -- see below
   ```
   In `.env`: real `DATABASE_URL`/`DB_PASSWORD`, a freshly generated
   `SECRET_KEY`, your real SMTP creds, `FRONTEND_ORIGIN=https://your-domain`,
   and **`SESSION_COOKIE_SECURE=true`** (Caddy gives you real HTTPS, so this
   should be on from day one here — unlike the demo/localhost case).

7. **Build the frontend** on the server (or build locally and `scp` the
   `dist/` folder over):
   ```
   cd vue-app
   npm install
   npm run build
   ```

8. **Install the systemd service and Caddyfile** — templates are in
   `deploy/`. Copy `deploy/ags-backend.service` to
   `/etc/systemd/system/`, fix the paths inside it to match where you
   cloned the repo, then:
   ```
   sudo systemctl daemon-reload
   sudo systemctl enable --now ags-backend
   ```
   Copy `deploy/Caddyfile` to `/etc/caddy/Caddyfile` (fix the domain and
   paths inside it first), then `sudo systemctl reload caddy`. Caddy
   handles the Let's Encrypt certificate automatically the first time it
   sees real traffic on that domain.

9. **Lock down the firewall** — only the proxy and SSH should be reachable
   from outside:
   ```
   sudo ufw allow 22
   sudo ufw allow 80
   sudo ufw allow 443
   sudo ufw enable
   ```
   MySQL and uvicorn are already bound to `127.0.0.1` (default MySQL
   config, and the systemd unit below binds uvicorn the same way), so they
   were never reachable from outside regardless — this is belt-and-suspenders.

10. **Back it up.** Real teachers, real student data now — a cron job
    covers the two things that actually matter:
    ```
    # /etc/cron.d/ags-backup (daily at 2am, keeps 14 days)
    0 2 * * * root mysqldump ags_db | gzip > /var/backups/ags/db-$(date +\%F).sql.gz && \
      tar czf /var/backups/ags/storage-$(date +\%F).tar.gz -C /opt/ags/backend storage && \
      find /var/backups/ags -mtime +14 -delete
    ```

## Before real teachers touch it with real students

This is the point where the earlier privacy/ethics conversation stops being
theoretical — you'd be collecting and storing real names, handwriting, and
scores on a server you're paying for and responsible for. Confirm your
institution's research ethics clearance actually covers this specific
usability test (not just the thesis in general) before onboarding real
teachers with real classes, not after.

# Deploying to Azure (one VM, about $100 of credit)

Everything runs on **one Ubuntu VM**: MySQL, the FastAPI backend with both models, and Caddy (serves the built
Vue app, proxies `/api`, and gets a free HTTPS certificate). This is `DEPLOYMENT.md` made concrete for Azure.
Prices below are approximate and from memory -- check the Azure Pricing Calculator for your region.

Placeholders: `<HOST>` = your Azure hostname (step 2), `<KEY>` = the `.pem` key file Azure gives you.

## 0. Before you start

- [ ] Azure account with the credit. Portal -> Cost Management + Billing -> Credits: note the **expiry date** and the
      plan (Azure for Students blocks some sizes/regions). Do **not** click "upgrade to pay-as-you-go".
- [ ] Gmail **app password** for the verification / password-reset emails (Google Account -> Security -> 2-Step
      Verification on -> App passwords). The emails contain a 6-digit code, not a link, so no URL setting is needed.
- [ ] Ethics/consent paperwork done before real students' sheets go on this server (see `DEPLOYMENT.md`, last section).
- [ ] Windows 10/11 with `ssh`, `scp` and `tar` (built in) and Node.js (you already use it for `npm run dev`).

## 1. On your PC: build the frontend and pack the project (PowerShell)

```
cd C:\Users\ADMIN\Downloads\web-automated-grading-system-main\web-automated-grading-system-main\vue-app
npm install
npm run build
```

Pack everything except the big/private things (virtual envs, `node_modules`, `.git`, your local `.env`, and
`backend\storage` -- that folder holds sheets uploaded during local testing). The result is about 6 MB:

```
tar.exe -czf $env:TEMP\ags.tar.gz --exclude=venv --exclude=.venv --exclude=node_modules --exclude=.git --exclude=.claude --exclude=.vscode --exclude=.env --exclude=backend/storage --exclude=backend/models/htr -C "C:\Users\ADMIN\Downloads\web-automated-grading-system-main" web-automated-grading-system-main
```

(The 1.3 GB TrOCR folder `backend\models\htr` is uploaded separately in step 5. `backend\models\yolo\best.pt` is in the
archive.)

## 2. Create the VM (Azure Portal, portal.azure.com)

Create a resource -> **Virtual machine**:

| Setting | Value |
|---|---|
| Resource group | new: `ags-rg` |
| Name | `ags-vm` |
| Region | one close to you with the size below available (Southeast Asia / East Asia; if the size is missing, try another) |
| Image | **Ubuntu Server 24.04 LTS** (x64 Gen2) |
| Size | **Standard_B2ms** (2 vCPU, 8 GiB). If unavailable: `Standard_D2as_v5` or `D2s_v5` (8 GiB) |
| Authentication | SSH public key, username `azureuser`, "Generate new key pair" (download the `.pem` when asked) |
| Inbound ports | SSH (22), HTTP (80), HTTPS (443) |
| OS disk | Standard SSD, **64 GiB** |
| Management tab | turn **Auto-shutdown** on (e.g. 23:00) -- it is free |

After it is created: open the VM -> **Public IP address** -> Configuration -> set **DNS name label** to something
unique, e.g. `yourname-ags` -> Save. Your hostname is then
`yourname-ags.<region>.cloudapp.azure.com` -- that is `<HOST>`. It is free and Caddy can get an HTTPS certificate for it.
(New public IPs are static and cost about $3-4/month even while the VM is stopped.)

**Set a budget alert now:** Cost Management + Billing -> Budgets -> Add -> $100, alerts at 50% and 80%.

## 3. Connect (PowerShell)

Restrict the key file's permissions, otherwise `ssh` refuses it:

```
icacls "C:\Users\ADMIN\Downloads\ags-vm_key.pem" /inheritance:r /grant:r "$($env:USERNAME):R"
ssh -i "C:\Users\ADMIN\Downloads\ags-vm_key.pem" azureuser@<HOST>
```

Everything from here to step 8 is typed **on the VM** unless it says PC.

## 4. Install the software (VM)

```
sudo apt update && sudo apt -y upgrade
sudo apt install -y software-properties-common
sudo add-apt-repository -y ppa:deadsnakes/ppa
sudo apt update
sudo apt install -y python3.13 python3.13-venv python3.13-dev build-essential mysql-server caddy
```

Add 4 GB of swap as a safety net for the two models:

```
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 5. Upload the project and the models (PC, PowerShell)

```
scp -i "C:\Users\ADMIN\Downloads\ags-vm_key.pem" $env:TEMP\ags.tar.gz azureuser@<HOST>:/tmp/ags.tar.gz
scp -i "C:\Users\ADMIN\Downloads\ags-vm_key.pem" -r "C:\Users\ADMIN\Downloads\web-automated-grading-system-main\web-automated-grading-system-main\backend\models\htr" azureuser@<HOST>:/tmp/htr
```

The second one is 1.3 GB (10-30 minutes on a home connection). It must contain `model.safetensors`, `config.json`,
`generation_config.json`, `processor_config.json`, `tokenizer.json`, `tokenizer_config.json`.

Then on the VM:

```
sudo useradd -r -m -d /opt/ags -s /bin/bash ags
sudo chmod 755 /opt/ags
sudo tar xzf /tmp/ags.tar.gz -C /opt/ags --strip-components=1
sudo mkdir -p /opt/ags/backend/models/htr /opt/ags/backend/storage
sudo cp /tmp/htr/* /opt/ags/backend/models/htr/
sudo chown -R ags:ags /opt/ags
```

## 6. Database (VM)

```
cd /opt/ags/database
sudo mysql
```

At the `mysql>` prompt (pick a password from `openssl rand -hex 16`: letters and digits only, so it is safe inside
`DATABASE_URL`):

```
source bootstrap/01_create_database.sql
ALTER USER 'ags_app'@'localhost' IDENTIFIED BY 'PUT_YOUR_DB_PASSWORD_HERE';
EXIT;
```

Then the migrations, in order (do **not** load `seed/demo_data.sql` -- that is fake demo data):

```
cd /opt/ags/database/migrations
for f in V001*.sql V002*.sql V003*.sql V004*.sql V005*.sql V006*.sql; do sudo mysql ags_db < "$f"; done
sudo mysql ags_db < R__views.sql
```

## 7. Backend (VM)

CPU-only PyTorch first (the normal wheel drags in ~3 GB of unused CUDA libraries), then the rest:

```
cd /opt/ags/backend
sudo -u ags python3.13 -m venv venv
sudo -u ags venv/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
sudo -u ags venv/bin/pip install -r requirements.txt
sudo -u ags cp .env.example .env
sudo -u ags nano .env
```

Edit these lines in `.env` and save (Ctrl+O, Enter, Ctrl+X):

```
DB_PASSWORD=<the DB password from step 6>
DATABASE_URL=mysql+pymysql://ags_app:<the DB password>@127.0.0.1:3306/ags_db?charset=utf8mb4
SECRET_KEY=<output of: python3 -c "import secrets; print(secrets.token_hex(32))">
SESSION_COOKIE_SECURE=true
FRONTEND_ORIGIN=https://<HOST>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<your gmail address>
SMTP_APP_PASSWORD=<the 16-character app password>
FROM_EMAIL=<your gmail address>
```

Start it as a service (the unit in `deploy/` already matches `/opt/ags` and user `ags`):

```
sudo cp /opt/ags/deploy/ags-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ags-backend
curl http://127.0.0.1:8000/api/health
```

The health check should answer with JSON. If not: `sudo journalctl -u ags-backend -n 60`.

## 8. Website and HTTPS (VM)

```
sudo cp /opt/ags/deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/your-domain.com/<HOST>/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Open `https://<HOST>` in your browser (the first load may take a few seconds while the certificate is issued).
Register an account, enter the emailed code, and grade a test sheet.

## 9. Lock down and back up

- Portal -> VM -> Networking -> the SSH (22) rule: set **Source** to "IP addresses" and your own public IP.
- Nightly backup (VM). Create the folder, then the cron file from `DEPLOYMENT.md` step 10:

```
sudo mkdir -p /var/backups/ags
```

  The backups are on the same disk, so from time to time copy them to your PC (PC, PowerShell):

```
scp -i "C:\Users\ADMIN\Downloads\ags-vm_key.pem" -r azureuser@<HOST>:/var/backups/ags C:\Users\ADMIN\ags-backups
```

## 10. Save your credits

- Portal -> VM -> **Stop**. It must say **Stopped (deallocated)** -- only then does the compute charge stop. Shutting
  down from inside Linux is not enough. Start it again from the portal when you need it; the hostname stays the same.
- Rough monthly cost (approximate): B2ms running 24/7 about $70-85 in total with disk and IP, so $100 lasts about
  5-6 weeks. On about 8 hours a day about $30-35 (3 months). Stopped most of the time about $12-15.

## 11. Updating after code changes

PC: rebuild (`npm run build` in `vue-app`), repeat the `tar.exe` and first `scp` of steps 1 and 5. VM:

```
sudo tar xzf /tmp/ags.tar.gz -C /opt/ags --strip-components=1
sudo chown -R ags:ags /opt/ags
sudo systemctl restart ags-backend
```

(`.env`, `backend/storage` and `backend/models/htr` are not in the archive, so they are not overwritten.)

## Known limits

- **Speed:** no GPU. Measured on a desktop CPU: about 1.5 minutes for a 24-answer sheet (about 3.6 s per answer,
  against about 5 s per sheet on the RTX 3070). A small Azure VM will probably be slower, and B-series VMs are
  "burstable" -- sustained grading can be throttled. If that is a problem, resize the VM (Portal -> VM -> Size) to
  `D2as_v5` or `D4as_v5`. For the defense itself, running the app on your own GPU PC is free and much faster.
- **One sheet at a time:** the upload endpoint (`async def upload_sheets` in `backend/app/routers/sessions.py`) runs
  the model inside the request, so while one sheet is being graded other requests wait. Fine for a handful of
  teachers taking turns; tell them to upload one sheet at a time. Running the grading in a thread pool would fix it.
- **Long uploads:** I have not tested how Azure handles a request that stays open for several minutes. Keep to a few
  pages per upload while testing.

## Troubleshooting

| Symptom | Check |
|---|---|
| `502 Bad Gateway` | Backend is down: `sudo journalctl -u ags-backend -n 60` |
| Browser certificate error / site does not load | Ports 80 and 443 open in the VM's network rules? Hostname typed the same in the Caddyfile? `sudo journalctl -u caddy -n 40` |
| Logs in, then logged out immediately | `SESSION_COOKIE_SECURE=true` needs the `https://` address, not `http://` or the raw IP |
| No verification email | Wrong app password, or 2-Step Verification not on; see the backend log |
| Backend killed / very slow | `free -h`: is swap on? Is the VM at least 8 GiB? |
| `pip install` fails on a package | You must use Python 3.13 (what the project was built with) and the CPU torch first |

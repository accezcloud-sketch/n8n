# n8n Deployment

Self-hosted n8n on a VPS via Docker. Runs three blog auto-deploy workflows that generate posts with Gemini, fetch Unsplash images, push to GitHub, and announce on Facebook:

- **Accez Blog Auto Deploy** — bilingual EN+AR posts to `accezcloud-sketch/AccezWebsite`, posts to the Accez Facebook page (every 2 days at **09:00**)
- **CloudElite Blog Auto Deploy** — bilingual EN+AR posts to `accezcloud-sketch/CloudEliteSite`, posts to the CloudElite Facebook page (every 2 days at **12:00**)
- **Veganster Blog Auto Deploy** — English posts to `accezcloud-sketch/veganster`, posts to the Veganster Facebook page (every 2 days at **15:00**)

All three are timezone-anchored to `Asia/Riyadh` and read pending topics from per-brand Google Sheets.

## Prerequisites on the VPS

- Docker + Docker Compose plugin
- Nginx (already running for the existing site)
- Certbot (for HTTPS)
- A subdomain pointed at the VPS IP (A record), e.g. `n8n.accez.cloud`

Install Docker if missing:
```bash
curl -fsSL https://get.docker.com | sh
apt install docker-compose-plugin -y
```

## 1. Clone this repo on the VPS

```bash
cd /opt
git clone <this-repo-url> n8n
cd n8n
```

## 2. Create the `.env` file

```bash
cp .env.example .env
nano .env
```

Set:
- `N8N_HOST` — the subdomain (e.g. `n8n.accez.cloud`)
- `N8N_ENCRYPTION_KEY` — generate with `openssl rand -hex 32`. **Save this in 1Password / shared vault. If lost, all stored credentials become unrecoverable.**
- `GENERIC_TIMEZONE` — `Asia/Riyadh` (must match — schedule triggers fire in this timezone)

## 3. Start n8n

```bash
docker compose up -d
docker compose logs -f
```

Wait until you see `Editor is now accessible via: http://localhost:5678/`, then Ctrl+C.

## 4. Reverse proxy + HTTPS

Create `/etc/nginx/sites-available/n8n`:

```nginx
server {
    listen 80;
    server_name n8n.accez.cloud;

    location / {
        proxy_pass http://127.0.0.1:5678;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
```

Enable + get the cert:
```bash
ln -s /etc/nginx/sites-available/n8n /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d n8n.accez.cloud
```

## 5. First login

Visit `https://n8n.accez.cloud` and create the owner account.

## 6. Import the three workflows

In the n8n UI, for each file in `workflows/`:
- **Workflows → Import from File** → upload the JSON

Import order doesn't matter. All three import as **inactive** with credentials unmapped — that's expected.

| File | Workflow name | Trigger |
|---|---|---|
| `workflows/accez-blog-auto-deploy.json` | Accez Blog Auto Deploy | Every 2 days at 09:00 |
| `workflows/cloudelite-blog-auto-deploy.json` | CloudElite Blog Auto Deploy | Every 2 days at 12:00 |
| `workflows/veganster-blog-auto-deploy.json` | Veganster Blog Auto Deploy | Every 2 days at 15:00 |

## 7. Re-create credentials

Credentials are encrypted to the original instance and **never travel with the workflow JSON**. Recreate all seven in **Credentials → Create new** on the new instance, then open each workflow and re-link the credential on every node showing a "credential not found" badge.

| Name (must match exactly) | Type | Used by | Where to get it |
|---|---|---|---|
| `Google Sheets account` | Google Sheets OAuth2 API | All 3 (read topics, mark used) | Google Cloud Console → OAuth client |
| `Google Gemini(PaLM) Api account` | Google Gemini (PaLM) API | All 3 (blog generation) | https://aistudio.google.com/apikey |
| `GitHub account` | GitHub API | All 3 (push markdown + images) | GitHub → Settings → Developer settings → Personal access tokens (classic, with `repo` scope) |
| `Header Auth account 2` | HTTP Header Auth | All 3 (Unsplash API) | Unsplash app → access key. Header name: `Authorization`, header value: `Client-ID YOUR_KEY` |
| `Facebook Graph account` | Facebook Graph API | Accez Facebook post | Meta for Developers → Page access token for the Accez page (id `425256947348313`) |
| `Facebook Cloud Elite Page Token` | Facebook Graph API | CloudElite Facebook post | Page access token for the CloudElite page (id `854491451307629`) |
| `Facebook Veganster Page Token` | Facebook Graph API | Veganster Facebook post | Page access token for the Veganster page (id `1712271652133742`) |

Page access tokens should be the long-lived variant (60-day) or a System User token if you want them not to expire.

## 8. Test each workflow before activating

Even with schedule-only triggers, you can run each workflow on demand from the editor — open the workflow → click **Execute Workflow** in the top bar. Do this once per workflow:

1. Verify a real post lands on GitHub (and the cover image, for Accez/CloudElite)
2. Verify the Facebook post lands on the correct page
3. Verify the Sheet row gets marked `used` (col B) and dated (col C)
4. If anything went wrong, **delete the test commit + revert the Sheet row** before activating

Each workflow's Google Sheet must have at least one row in `pending` status, otherwise `Find First Pending Topic` errors out and the workflow stops.

## 9. Activate (staggered same-day cadence)

The schedule trigger uses `daysInterval: 2` anchored to **the moment of activation**, not the calendar. To get the 09:00 → 12:00 → 15:00 same-day cadence:

1. Pick a launch day
2. **Before 09:00 that day**, flip all three workflows to active in the same sitting
3. They'll all fire that day and then together every 2 days

If you can't activate before 09:00, the day-of-activation behaviour is:
- Activated before 12:00 → CloudElite + Veganster fire today, Accez fires in 2 days
- Activated before 15:00 → only Veganster fires today
- Activated after 15:00 → none fire today; first cycle is 2 days later

If guaranteed calendar alignment matters (e.g. always even-numbered days of the month regardless of activation time), switch the trigger rule from `daysInterval` to a cron expression — `0 9 */2 * *`, `0 12 */2 * *`, `0 15 */2 * *`. Edit the schedule node, change the rule type, save, re-activate.

## Backups

The n8n SQLite DB and credential keys live in the `n8n_data` Docker volume. Back up nightly:

```bash
docker run --rm -v n8n_n8n_data:/data -v /opt/n8n/backups:/backup alpine \
  tar czf /backup/n8n-$(date +%F).tar.gz /data
```

Add a cron job:
```bash
crontab -e
# 0 3 * * * cd /opt/n8n && docker run --rm -v n8n_n8n_data:/data -v /opt/n8n/backups:/backup alpine tar czf /backup/n8n-$(date +\%F).tar.gz /data
```

## Updating n8n

```bash
cd /opt/n8n
docker compose pull
docker compose up -d
```

## Files in this repo

- `docker-compose.yml` — n8n container definition
- `.env.example` — template for environment variables (real `.env` is gitignored)
- `workflows/accez-blog-auto-deploy.json` — Accez bilingual blog workflow
- `workflows/cloudelite-blog-auto-deploy.json` — CloudElite bilingual blog workflow
- `workflows/veganster-blog-auto-deploy.json` — Veganster English blog workflow

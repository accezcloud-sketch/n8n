# n8n Deployment

Self-hosted n8n on a VPS via Docker. Runs three blog auto-deploy workflows that generate posts with Gemini, fetch Unsplash images, push to GitHub, and announce on Facebook:

- **Accez Blog Auto Deploy** — bilingual EN+AR posts to `accezcloud-sketch/AccezWebsite`, posts to the Accez Facebook page (every 2 days at **09:00**)
- **CloudElite Blog Auto Deploy** — bilingual EN+AR posts to `accezcloud-sketch/CloudEliteSite`, posts to the CloudElite Facebook page (every 2 days at **12:00**)
- **Veganster Blog Auto Deploy** — English posts to `accezcloud-sketch/veganster`, posts to the Veganster Facebook page (every 2 days at **15:00**)

All three are timezone-anchored to `Asia/Riyadh` and read pending topics from per-brand Google Sheets.

## Two deploy methods

**Primary — restore the volume export.** A `n8n-export.zip` is shipped alongside this repo (sent separately, not in git — contains encrypted credentials). Restoring it gives the new instance an exact clone of the source: workflows, credentials, and execution history all decrypt against the encryption key. **No manual credential recreation needed.** Use this method if the source instance is healthy and you have both the zip and the encryption key.

**Fallback — import workflow JSONs and recreate credentials.** If the volume export is unavailable, corrupted, or the encryption key is lost, the three JSON files in `workflows/` can be imported one at a time and credentials recreated by hand. Documented at the bottom under [Fallback method](#fallback-method-import-jsons-recreate-credentials).

---

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
- `N8N_ENCRYPTION_KEY` — **must match the encryption key from the source instance.** This is sent to you separately (1Password / Slack DM / vault — never committed). If you generate a new one, the encrypted credentials in the volume zip won't decrypt and the workflows will be useless.
- `GENERIC_TIMEZONE` — `Asia/Riyadh` (must match — schedule triggers fire in this timezone)

## 3. Start n8n once to create the volume

```bash
docker compose up -d
docker compose logs -f
```

Wait for `Editor is now accessible via: http://localhost:5678/`, then Ctrl+C the logs and stop the container:

```bash
docker compose down
```

This step exists only to make Docker create the named volume `n8n_n8n_data`. If you skip it, the next step has nothing to extract into.

## 4. Restore the volume export

Upload `n8n-export.zip` to the VPS:
```bash
# Run from your laptop, not the VPS:
scp n8n-export.zip root@<vps-ip>:/tmp/
```

On the VPS, extract the zip into the n8n volume and fix ownership:
```bash
docker run --rm -v n8n_n8n_data:/data -v /tmp:/tmp alpine sh -c \
  "apk add --no-cache unzip && cd /data && unzip -o /tmp/n8n-export.zip && chown -R 1000:1000 ."
```

## 5. Reverse proxy + HTTPS

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

Enable + cert:
```bash
ln -s /etc/nginx/sites-available/n8n /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d n8n.accez.cloud
```

## 6. Bring n8n back up

```bash
docker compose up -d
docker compose logs -f
```

The first start replays the SQLite WAL and applies any uncommitted changes from the source instance. Watch the logs for any decryption errors — if you see them, the encryption key in `.env` doesn't match the one the volume was encrypted with.

## 7. First login

Visit `https://n8n.accez.cloud`. Sign in with **the same owner account credentials** that existed on the source instance (the zip preserves the user table). All three workflows should be visible in the workflow list, all `Inactive`, with their credentials already attached and unbroken (no yellow "credential not found" badges).

## 8. Test each workflow before activating

For each workflow:

1. Open it in the editor
2. Click **Execute Workflow** in the top-right toolbar — this runs end-to-end with a real pending topic from the Sheet
3. Verify a real post lands on GitHub (and the cover image, for Accez/CloudElite)
4. Verify the Facebook post lands on the correct page
5. Verify the Sheet row gets marked `used` (col B) and dated (col C)
6. If anything went wrong, **delete the test commit + revert the Sheet row** before activating

Each workflow's Google Sheet must have at least one row in `pending` status, otherwise `Find First Pending Topic` errors out and the workflow stops.

## 9. Activate

For each of the three workflows: open it in the editor, click the **Inactive** toggle in the top-right header to flip it to **Active**. n8n shows a confirmation toast and a "Next execution: <timestamp>" line appears.

The schedule rule (`daysInterval: 2`) is **calendar-anchored** — it fires on every odd-numbered day of the month at the configured hour, regardless of when activation happens. So all three workflows automatically align on the same calendar days. The only thing activation time controls is whether *today* is included as the first fire:

- Activated before 09:00 on an odd day → Accez fires today, CloudElite fires today, Veganster fires today
- Activated 09:00–12:00 on an odd day → CloudElite + Veganster fire today, Accez fires next odd day
- Activated 12:00–15:00 on an odd day → only Veganster fires today
- Activated after 15:00 on an odd day, or any time on an even day → none fire today; first fires happen on the next odd day

After that, all three fire together on every odd-numbered day. Caveat: month boundaries (e.g. Jan 31 → Feb 1) cause occasional 1-day gaps instead of 2.

## Backups

The `n8n_n8n_data` Docker volume holds the entire instance (DB + credentials + execution history). Back up nightly:

```bash
docker run --rm -v n8n_n8n_data:/data -v /opt/n8n/backups:/backup alpine \
  tar czf /backup/n8n-$(date +%F).tar.gz /data
```

Add to cron:
```bash
crontab -e
# 0 3 * * * cd /opt/n8n && docker run --rm -v n8n_n8n_data:/data -v /opt/n8n/backups:/backup alpine tar czf /backup/n8n-$(date +\%F).tar.gz /data
```

Off-VPS copy is recommended (rsync to S3, scp to a backup host, etc.).

## Updating n8n

```bash
cd /opt/n8n
docker compose pull
docker compose up -d
```

n8n migrations on version bumps run automatically against the existing volume.

## Files in this repo

- `docker-compose.yml` — n8n container definition
- `.env.example` — template for environment variables (real `.env` is gitignored)
- `workflows/accez-blog-auto-deploy.json` — Accez bilingual blog workflow (fallback import)
- `workflows/cloudelite-blog-auto-deploy.json` — CloudElite bilingual blog workflow (fallback import)
- `workflows/veganster-blog-auto-deploy.json` — Veganster English blog workflow (fallback import)
- `n8n-export.zip` — full volume export (sent separately, gitignored, contains encrypted credentials)

---

## Fallback method (import JSONs, recreate credentials)

Use only if the volume zip is unavailable or its encryption key is lost.

1. Run steps 1–3 above (clone, .env, first start) — but in step 2, generate a fresh encryption key with `openssl rand -hex 32` since there's no existing key to match.
2. Skip step 4 (no zip to extract).
3. Run steps 5–6 (nginx, cert, bring n8n up).
4. **Import each workflow JSON** via Workflows → Import from File:
   - `workflows/accez-blog-auto-deploy.json`
   - `workflows/cloudelite-blog-auto-deploy.json`
   - `workflows/veganster-blog-auto-deploy.json`
5. **Recreate all seven credentials** in Credentials → Create new. Names must match exactly:

| Name | Type | Used by | Where to get it |
|---|---|---|---|
| `Google Sheets account` | Google Sheets OAuth2 API | All 3 | Google Cloud Console → OAuth client |
| `Google Gemini(PaLM) Api account` | Google Gemini (PaLM) API | All 3 | https://aistudio.google.com/apikey |
| `GitHub account` | GitHub API | All 3 | GitHub → Settings → Developer settings → Personal access tokens (classic, `repo` scope) |
| `Header Auth account 2` | HTTP Header Auth | All 3 (Unsplash) | Unsplash app → access key. Header name: `Authorization`, value: `Client-ID YOUR_KEY` |
| `Facebook Graph account` | Facebook Graph API | Accez Facebook | Page access token for the Accez page (id `425256947348313`) |
| `Facebook Cloud Elite Page Token` | Facebook Graph API | CloudElite Facebook | Page access token for the CloudElite page (id `854491451307629`) |
| `Facebook Veganster Page Token` | Facebook Graph API | Veganster Facebook | Page access token for the Veganster page (id `1712271652133742`) |

6. Open each workflow and re-link credentials on every node showing a "credential not found" badge.
7. Continue with steps 8 and 9 (test each workflow, then activate).

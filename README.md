# n8n Deployment

Self-hosted n8n on a VPS via Docker. Used to run the **Test Blog Auto Deploy** workflow that generates blog posts with Gemini, fetches Unsplash images, and pushes to GitHub.

## Prerequisites on the VPS

- Docker + Docker Compose plugin
- Nginx (already running for the existing site)
- Certbot (for HTTPS)
- A subdomain pointed at the VPS IP (A record), e.g. `n8n.yourdomain.com`

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
- `N8N_HOST` — the subdomain (e.g. `n8n.yourdomain.com`)
- `N8N_ENCRYPTION_KEY` — generate with `openssl rand -hex 32`. **Save this in 1Password / shared vault. If lost, all stored credentials become unrecoverable.**
- `GENERIC_TIMEZONE` — defaults to `Asia/Riyadh`

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
    server_name n8n.yourdomain.com;

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
certbot --nginx -d n8n.yourdomain.com
```

## 5. First login

Visit `https://n8n.yourdomain.com` and create the owner account.

## 6. Import the workflow

In the n8n UI:
- **Workflows → Import from File**
- Upload `workflows/test-blog-auto-deploy.json`

## 7. Re-create credentials

The workflow needs four credentials. They were not exported (encrypted to the original instance), so they must be re-added in the new n8n UI:

| Name in workflow | Type | Where to get the key |
|---|---|---|
| Google Sheets account | Google Sheets OAuth2 API | Google Cloud Console |
| Google Gemini (PaLM) Api account | Google Gemini API | https://aistudio.google.com/apikey |
| GitHub account | GitHub API | GitHub → Settings → Developer settings → Personal access tokens |
| Header Auth account 2 (Unsplash) | HTTP Header Auth | Unsplash app → access key. Header: `Authorization`, value: `Client-ID YOUR_KEY` |

After adding each credential, open the workflow and re-link the credential to its node.

## 8. Activate and test

1. Open the imported workflow in n8n.
2. Click the manual trigger and **Execute Workflow** to test end-to-end.
3. Verify a blog post appears in the GitHub repo and the topic gets marked as used in the Google Sheet.
4. Toggle the workflow to **Active** (top right) so the Schedule trigger fires every 2 days.

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
- `workflows/test-blog-auto-deploy.json` — exported workflow, import via UI

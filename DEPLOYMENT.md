# Deployment

This project uses GitHub Actions for CI/CD.

## Workflow

- Pull requests: run `npm ci` and `npm run build`.
- Pushes to `main` or `master`: build `dist/`, then deploy it to your server with SSH and `rsync`.

## Required GitHub Secrets

Configure these in GitHub repository settings:

| Secret | Example | Description |
| --- | --- | --- |
| `SERVER_HOST` | `1.2.3.4` | Server IP or domain. |
| `SERVER_PORT` | `22` | SSH port. Optional; defaults to `22`. |
| `SERVER_USER` | `deploy` | SSH username. |
| `SERVER_SSH_KEY` | private key text | Private key that can SSH into the server. |
| `SERVER_PATH` | `/var/www/shroomlab` | Directory where `dist/` files should be published. |

## Server Setup

Create the deployment directory:

```bash
sudo mkdir -p /var/www/shroomlab
sudo chown -R deploy:deploy /var/www/shroomlab
```

Example Nginx config:

```nginx
server {
  listen 80;
  server_name your-domain.com;

  root /var/www/shroomlab;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

This app uses hash routes such as `#/pressure2`, so static hosting works without server-side route rewrites beyond serving `index.html`.

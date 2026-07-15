# Deployment

This project uses GitHub Actions for CI/CD.

## Workflow

- Pull requests: run `npm ci` and `npm run build`.
- Pushes to `main` or `master`: build `dist/`, then deploy it to your server with SSH and `rsync`.

## Required GitHub Secrets

Configure these in GitHub repository settings:

| Secret | Example | Description |
| --- | --- | --- |
| `SERVER_HOST` | `39.105.83.246` | Server IP or domain. |
| `SERVER_PORT` | `20202` | SSH port. Optional; defaults to `22`. |
| `SERVER_USER` | `root` | SSH username. |
| `SERVER_SSH_KEY` | private key text | Private key that can SSH into the server. |
| `SERVER_PATH` | `/root/shroomlab` | Directory where `dist/` files should be published. |

## Server Setup

Create the deployment directory:

```bash
mkdir -p /root/shroomlab
```

## Serve on Port 3333

Copy `deploy/nginx-shroomlab-3333.conf` to the server:

```bash
scp -P 20202 deploy/nginx-shroomlab-3333.conf root@39.105.83.246:/etc/nginx/conf.d/shroomlab.conf
```

Or create this Nginx config manually on the server:

```nginx
server {
  listen 3333;
  server_name _;

  root /root/shroomlab;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

Reload Nginx:

```bash
nginx -t
systemctl reload nginx
```

Open the server firewall/security group for TCP port `3333`.

Online URL:

```text
http://39.105.83.246:3333
```

This app uses hash routes such as `#/pressure2`, so static hosting works without server-side route rewrites beyond serving `index.html`.

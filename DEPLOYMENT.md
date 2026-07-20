# Deployment

This project uses GitHub Actions for CI/CD.

## Workflow

- Pull requests: run `npm ci` and `npm run build`.
- Pushes to `main` or `master`: build `dist/`, then deploy it to your server with SSH and `rsync`.

## Required GitHub Secrets

Configure these in GitHub repository settings:

| Secret | Default | Description |
| --- | --- | --- |
| `SERVER_SSH_KEY` | none | Required private key that can SSH into the server. |
| `SERVER_HOST` | `39.105.83.246` | Optional server IP or domain override. |
| `SERVER_PORT` | `20202` | Optional SSH port override. |
| `SERVER_USER` | `root` | Optional SSH username override. |
| `SERVER_PATH` | `/root/shroomlab` | Optional publish directory override. |

`SERVER_SSH_KEY` may be stored either as a repository Actions secret or in the
`production` environment used by the deploy job. Keep private key files out of
the repository.

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

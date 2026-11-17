# Security Policy

## Supported versions

The latest commit on `main` is supported. This is a self-hosted project; deployments are the responsibility of the person running them.

## Reporting a vulnerability

Please do **not** open a public issue containing exploit details, secrets, or personal data.

Use GitHub's **Private vulnerability reporting / Security advisory** feature on this repository, or contact the maintainer through the profile listed on the repository. Include:

- affected version / commit
- a minimal reproduction
- expected vs. actual behavior
- any deployment details needed to understand the issue

## Threat model

YunClip is a small, single-admin, link-based clipboard. It is **not** intended for:

- end-to-end encrypted secrets
- regulated data, credentials, or company-confidential material
- multi-tenant or anonymous public file hosting
- strong consistency / mission-critical storage

The link is the default capability for a public clipboard. A password adds an access check but does not encrypt the body at rest in KV. Anyone with access to the EdgeOne account or KV namespace can read the data.

## Security controls

- Admin credentials come only from deployment environment variables.
- HMAC-SHA256 signed, HttpOnly, SameSite=Lax session cookies.
- Session payload includes a password fingerprint, so changing the admin password invalidates existing sessions.
- Login rate limiting and generic failure messages.
- Origin / Sec-Fetch-Site checks on state-changing requests.
- PBKDF2-SHA256 with random salt for clipboard passwords.
- CSP and defensive response headers in `edgeone.json`.
- React escaping for user-controlled text; no HTML rendering.

## Deployment hygiene

- Use a long, unique `ADMIN_PASSWORD` (or `ADMIN_PASSWORD_SHA256`) and a random `SESSION_SECRET`.
- Never commit `.env`, `.dev-kv.json`, or deployment secrets.
- Enable HTTPS and bind a custom domain.
- Review the KV namespace and environment variables if the deployment is transferred.
- Back up data before destructive cleanup.

# Deployed AfterKey application

This folder contains the actual Contabo application served at `https://spidercrawler.site`.
The older Next.js application remains at the repository root; deploying that application
does not update the current live Python/static website.

## Runtime and data

- `/opt/afterkey/app/app.py`: FastAPI application, existing authentication and private attachment storage.
- `/opt/afterkey/app/restoration.py`: additive schema, account settings, recovery, Life Checks, reviewed legacy claims.
- `/var/www/afterkey`: static website. Existing `auth.css`, fonts, colors and brand are retained.
- `/opt/afterkey/data/afterkey.db` and `media/`: live records and private attachments.
- `/opt/afterkey/shared/afterkey.env`: existing mail and administrator configuration. Never commit this file.
- `afterkey-api.service`: existing API on loopback port 8001.
- `afterkey-reminders.timer`: hourly owner reminders and queued account notifications. This worker never activates a legacy.

Python packages are supplied by the existing `/opt/afterkey/venv`. No new runtime dependency is required.

## Access and review

The configured `ADMIN_EMAIL` account must sign in and verify its own email in Settings.
The Legacy reviews navigation item then becomes available. Administration cannot be
enabled by editing a profile or by possessing an invitation. A reviewer cannot approve
their own or a related inheritance request.

1. An owner or nominated person with a verified independent account submits a review request.
2. The administrator independently checks the death record and inheritance authority, records references and a decision, and re-enters their own password.
3. Only approved activation allows an invitation. Backups wait until primary nominations are withdrawn.
4. The recipient opens a 30-day invitation, verifies a six-digit email code (10 minutes, five attempts), and submits identity/inheritance references.
5. An unrelated administrator records an independent identity review.
6. The recipient creates or authenticates their own account, sets up recovery codes, and explicitly claims.
7. Every family page and attachment requires the approved claim and recipient account. Revocation or an owner check-in immediately prevents subsequent access.

Verification is a human review of external records, not automated identity assurance or a legal determination by software. The platform never treats a missed Life Check as proof of death. Old bearer-link legacy/release endpoints return 410; old private content links cannot bypass verification.

## Preservation and limits

Schema changes only add tables and columns. Existing accounts, entries, nominations and files remain in place.
Deleting a vault item hides it and blocks attachment access; account closure disables access but retains records privately. Replaced attachments are preserved in private storage. The UI discloses this retention behavior.

Attachments retain the existing 8 MB limit and validated image/PDF/text/video/audio types.
Vault content is stored privately on the server; this change does not claim end-to-end encryption.

## Validation

`/opt/afterkey/venv/bin/python -m unittest discover -s tests -v` uses disposable databases,
captured email, and tests authorization, OTPs, recovery, revocation, succession, reminders,
file ownership, and preservation. It never reads or modifies the production database.

`tests/browser_server.py` is a loopback-only disposable fixture with captured email. It must
never be deployed as the production service. `node contabo/tests/browser.cjs` tests desktop
and mobile flows through an SSH tunnel to that fixture at `https://127.0.0.1:18443`.

Before release, copy the production database using SQLite backup and test migrations on
the copy. Keep database copies on the server. Never run the browser fixture against live data.

## Deployment

Extract the release under `/opt/afterkey/releases/<release>`, excluding tests and secrets,
then run `python3 deploy.py` from that directory. The script takes another online backup,
copies application files atomically, restarts the API, checks health, updates static files,
validates/reloads nginx and enables the reminder timer. It preserves existing tables and files.

Keep the source and deployment manifest with the release. If a release fails, diagnose the
new service or put the API into maintenance; do not blindly restore the old bearer-access
implementation. The database backup and files are retained for deliberate recovery.

## Presentation rehearsal

Use separate owner, recipient and reviewer accounts. Test real email delivery to addresses
you control before presenting. Unit/browser tests capture mail and do not prove real inbox
delivery. Do not approve a real inheritance claim for demonstration purposes: use the isolated
fixture for the full approval journey. The live site can demonstrate vault uploads, navigation,
account settings, recovery and Life Checks with your own account.

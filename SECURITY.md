# Security Policy

Atlas Loop is a local development tool. It can launch apps, collect screenshots,
write logs, and send input to a local Simulator. Treat access to the local daemon
as trusted.

## Supported Versions

Only the current `main` branch is supported during the prototype phase.

## Reporting A Vulnerability

Please open a private advisory or contact the maintainer before publishing
details. Include reproduction steps, affected commands, and whether a local app
or local daemon exposure is required.

## Local Daemon Guidance

- The daemon binds to `127.0.0.1` by default.
- Do not run it on `0.0.0.0` unless you fully control the network.
- Evidence artifacts may contain screenshots and logs from your app. Avoid
  committing `artifacts/`.

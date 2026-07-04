# Contributing

Atlas Loop is early prototype infrastructure. Keep changes small, local-first,
and evidence-backed.

## Development

```bash
npm install
npm run typecheck
npm test
```

Use `npm run smoke:ios` only on macOS machines with Xcode and an available iOS
Simulator runtime.

## Pull Requests

- Include the behavior changed and the verification commands run.
- Keep runtime dependencies local; do not introduce a hosted service for v1
  flows.
- Preserve the product-owned protocol between CLI, daemon, MCP, artifacts, and
  the native helper.

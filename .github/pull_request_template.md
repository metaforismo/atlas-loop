## Summary

## Scope

- [ ] Keeps v1 scope local-only: macOS + iOS Simulator, no cloud/auth/team sharing/Android runtime dependency.
- [ ] Updates README/docs/API notes when user-visible behavior or artifact contracts change.

## Verification

- [ ] Non-Simulator checks: `bash scripts/verify-local.sh --no-smoke`
- [ ] Simulator smoke, if runtime behavior changed: `npm run smoke:ios`
- [ ] Native helper protocol check, if HID helper behavior changed.
- [ ] Artifact health/verification result noted when evidence format changed.

## Notes

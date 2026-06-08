# Legacy Artifacts

This folder contains old local tarballs, console outputs, audit logs, and ad hoc demo scripts that are not part of the current package, tests, or release process.

`FINAL-TEST` is an archived local install harness from an older package version. Use the root `npm run smoke` command for current example and package-entry smoke checks.

Do not publish these files. The npm package contents are controlled by `package.json` and should be inspected with:

```bash
npm pack --dry-run
```

# Scripts: Local Development Notes

This document captures practical tips for running and debugging the scripts locally.

## Prerequisites

```bash
# Node.js 18+
# Salesforce CLI (`sf`) available in your environment
# A Salesforce org authenticated locally
# Run from the repository root and install dependencies:

npm install

# The fetch script uses local Salesforce auth info through `@salesforce/core` and `SF_USERNAME`.

# Log in to your org (example):
sf org login web --alias my-org

# Log in to your org (example):
sf org list --all

export SF_USERNAME="your.username@example.com"
```

## Run Scripts Locally

```bash
# From the repository root:

# Default output directory is `docs/`.
# You can override it with:
export OUTPUT_DIR="./tmp/field-definitions"

# Run from the repository root:
npm run fetch-field-definitions:json
npm run fetch-field-definitions:csv
npm run fetch-field-definitions:json-per-object
npm run fetch-field-definitions:csv-per-object

# Optional: pass object scope with npm run
# all (default) | system | custom
npm run fetch-field-definitions:json -- system
npm run fetch-field-definitions:json -- custom
```

## Tests

```bash
npm test
npm run coverage
```

## Troubleshooting

- `SF_USERNAME environment variable is required`:
  - Set `SF_USERNAME` in your current shell.
- Auth-related errors from Salesforce:
  - Re-authenticate with `sf org login web` and verify with `sf org list --all`.
- Output not found where expected:
  - Check `OUTPUT_DIR`; if unset, files are written under `docs/`.
- No records or fewer records than expected:
  - Verify target org/username and confirm object/field visibility permissions.

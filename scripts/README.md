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

# Optional: comma-separated FieldDefinition fields to select.
# If omitted, all supported fields are selected.
export FIELD_DEFINITION_FIELDS="Id,DurableId,QualifiedApiName,EntityDefinitionId"
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

# Optional: filter objects by last modified date
# Supported units: weeks (week/weeks/w), days (day/days/d),
#                  hours (hour/hours/h), minutes (min/mins/minutes/m)
export UPDATED_WITHIN="2days"
npm run fetch-field-definitions:json

# Combine object scope and date filter:
UPDATED_WITHIN="12hours" npm run fetch-field-definitions:json -- custom

# Generate a package.xml manifest (custom objects/fields only)
npm run fetch-field-definitions:package-xml

# Optional: narrow to custom objects only and set a Metadata API version
OBJECT_SCOPE=custom METADATA_API_VERSION=62.0 npm run fetch-field-definitions:package-xml
```

After generating `package.xml`, retrieve the corresponding metadata with the Salesforce CLI:

```bash
sf project retrieve start --manifest docs/package.xml
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

# salesforce-field-inspector

[![Test](https://github.com/kotaoue/salesforce-field-inspector/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/kotaoue/salesforce-field-inspector/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/kotaoue/salesforce-field-inspector/branch/main/graph/badge.svg)](https://codecov.io/gh/kotaoue/salesforce-field-inspector)
[![License](https://img.shields.io/github/license/kotaoue/salesforce-field-inspector)](https://github.com/kotaoue/salesforce-field-inspector/blob/main/LICENSE)

A reusable GitHub Action that fetches [FieldDefinition](https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_fielddefinition.htm) records from the Salesforce Tooling API and saves them to JSON, CSV, or a [Metadata API package manifest](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/manifest_files.htm) (`package.xml`).

## Usage

Add the following to your workflow and supply `SFDX_AUTH_URL` and `SF_USERNAME` as repository secrets.

```yaml
- name: Fetch FieldDefinitions
  uses: kotaoue/salesforce-field-inspector@v1
  with:
    format: json           # json | csv | json-per-object | csv-per-object | package-xml
    output_dir: docs       # directory relative to the caller's workspace (default: docs)
    object_scope: all      # all | system | custom
    updated_within: "2days"  # optional: only objects modified in the last 2 days
    field_definition_fields: Id,DurableId,QualifiedApiName,EntityDefinitionId
    metadata_api_version: "62.0"  # optional: Metadata API version for package.xml (default: 62.0)
    sfdx_auth_url: ${{ secrets.SFDX_AUTH_URL }}
    sf_username: ${{ secrets.SF_USERNAME }}
```

### Inputs

| Name | Required | Default | Description |
| ---- | -------- | ------- | ----------- |
| `format` | Yes | `json` | Output format: `json`, `csv`, `json-per-object`, `csv-per-object`, or `package-xml`. |
| `output_dir` | No | `docs` | Directory (relative to the caller's workspace) where output files are written. |
| `object_scope` | No | `all` | Object filter: `all`, `system` (standard objects only), or `custom` (objects whose API name contains `__`). |
| `updated_within` | No | empty (all objects) | Fetch only objects modified within the given duration. Accepted formats: `2days`, `12hours`, `30min`, `1week` (singular/plural/short forms accepted, case-insensitive). Omit or leave empty to fetch all objects. |
| `field_definition_fields` | No | empty (all supported fields) | Comma-separated FieldDefinition fields to select. Supported fields: `Id`, `DurableId`, `QualifiedApiName`, `EntityDefinitionId`, `NamespacePrefix`, `DeveloperName`, `MasterLabel`, `Label`, `DataType`, `IsCalculated`, `IsNillable`, `IsIndexed`, `IsApiFilterable`, `IsApiGroupable`, `IsApiSortable`. |
| `metadata_api_version` | No | `62.0` | Salesforce Metadata API version to declare in the generated `package.xml`. Only used when `format` is `package-xml`. |
| `sfdx_auth_url` | Yes | — | SFDX Auth URL for authenticating to Salesforce. |
| `sf_username` | Yes | — | Salesforce username to query as. |

### Output formats

| Format | Description |
| ------ | ----------- |
| `json` | All records in a single `field-definitions.json` file. |
| `csv` | All records in a single `field-definitions.csv` file. |
| `json-per-object` | One `<EntityDefinitionId>.json` file per Salesforce object under `output_dir`. |
| `csv-per-object` | One `<EntityDefinitionId>.csv` file per Salesforce object under `output_dir`. |
| `package-xml` | A `package.xml` manifest listing all custom fields and custom objects found. Use this with `sf project retrieve start --manifest package.xml` to retrieve metadata for development environments. |

## Example workflow

Add the following workflow to `.github/workflows/` in the repository where you want to run the fetch.  
Configure `SFDX_AUTH_URL` and `SF_USERNAME` as repository secrets.

```yaml
name: Fetch FieldDefinition (JSON)

on:
  workflow_dispatch:
  schedule:
    - cron: '23 3 * * 0'

jobs:
  fetch:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - name: Fetch FieldDefinitions (JSON)
        uses: kotaoue/salesforce-field-inspector@v1
        with:
          format: json
          output_dir: docs
          object_scope: all
          # Optional: only fetch objects modified in the last 2 days
          # updated_within: "2days"
          # Optional: narrow selected FieldDefinition columns
          field_definition_fields: Id,DurableId,QualifiedApiName,EntityDefinitionId
          sfdx_auth_url: ${{ secrets.SFDX_AUTH_URL }}
          sf_username: ${{ secrets.SF_USERNAME }}

      - name: Commit and push results
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add docs/field-definitions.json
          git diff --cached --quiet || git commit -m "chore: update field-definitions.json [skip ci]"
          git push
```

### Generate a package.xml for development environment setup

The `package-xml` format produces a `package.xml` manifest that lists all custom fields and custom objects discovered via the Tooling API.  
You can then use the Salesforce CLI to retrieve the actual metadata files:

```yaml
- name: Generate package.xml
  uses: kotaoue/salesforce-field-inspector@v1
  with:
    format: package-xml
    output_dir: manifest
    object_scope: custom     # restrict to custom objects/fields
    metadata_api_version: "62.0"
    sfdx_auth_url: ${{ secrets.SFDX_AUTH_URL }}
    sf_username: ${{ secrets.SF_USERNAME }}

- name: Retrieve metadata using package.xml
  run: sf project retrieve start --manifest manifest/package.xml
```

## Local verification

You can run any fetch format locally by setting the required environment variables and using the npm scripts.

```bash
# Set required environment variables
export SF_USERNAME="your-username@example.com"
export OUTPUT_DIR="./docs"

# Fetch in JSON format
npm run fetch-field-definitions:json

# Fetch in CSV format
npm run fetch-field-definitions:csv

# Generate a package.xml manifest (custom objects/fields only)
npm run fetch-field-definitions:package-xml

# Optional: narrow to custom objects only and set a Metadata API version
OBJECT_SCOPE=custom METADATA_API_VERSION=62.0 npm run fetch-field-definitions:package-xml
```

After generating `package.xml`, retrieve the corresponding metadata with the Salesforce CLI:

```bash
sf project retrieve start --manifest docs/package.xml
```

## Secrets required

| Secret | Description |
| ------ | ----------- |
| `SFDX_AUTH_URL` | SFDX Auth URL obtained from `sf org display --verbose --json`. |
| `SF_USERNAME` | Salesforce username associated with the authenticated org. |

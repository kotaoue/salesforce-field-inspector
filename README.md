# salesforce-field-inspector

A reusable GitHub Action that fetches [FieldDefinition](https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_fielddefinition.htm) records from the Salesforce Tooling API and saves them to JSON or CSV files.

## Usage

Add the following to your workflow and supply `SFDX_AUTH_URL` and `SF_USERNAME` as repository secrets.

```yaml
- name: Fetch FieldDefinitions
  uses: kotaoue/salesforce-field-inspector@main
  with:
    format: json           # json | csv | json-per-object | csv-per-object
    output_dir: docs       # directory relative to the caller's workspace (default: docs)
    sfdx_auth_url: ${{ secrets.SFDX_AUTH_URL }}
    sf_username: ${{ secrets.SF_USERNAME }}
```

### Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `format` | Yes | `json` | Output format: `json`, `csv`, `json-per-object`, or `csv-per-object`. |
| `output_dir` | No | `docs` | Directory (relative to the caller's workspace) where output files are written. |
| `sfdx_auth_url` | Yes | — | SFDX Auth URL for authenticating to Salesforce. |
| `sf_username` | Yes | — | Salesforce username to query as. |

### Output formats

| Format | Description |
|--------|-------------|
| `json` | All records in a single `field-definitions.json` file. |
| `csv` | All records in a single `field-definitions.csv` file. |
| `json-per-object` | One `<EntityDefinitionId>.json` file per Salesforce object under `output_dir`. |
| `csv-per-object` | One `<EntityDefinitionId>.csv` file per Salesforce object under `output_dir`. |

## Example workflows

Ready-to-use example workflows are provided in [`.github/workflows/`](.github/workflows/).  
Copy them to the `.github/workflows/` directory of the repository where you want to run the fetch and configure the secrets.

## Secrets required

| Secret | Description |
|--------|-------------|
| `SFDX_AUTH_URL` | SFDX Auth URL obtained from `sf org display --verbose --json`. |
| `SF_USERNAME` | Salesforce username associated with the authenticated org. |


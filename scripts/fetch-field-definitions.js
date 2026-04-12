import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchFieldDefinitions } from './lib/fetch.js';
import { saveResults, saveResultsAsCsv, saveResultsPerObject, saveResultsAsCsvPerObject, saveAsPackageXml } from './lib/output.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const format = process.argv[2];
const objectScope = process.argv[3] ?? 'all';
const fieldDefinitionFields = process.env.FIELD_DEFINITION_FIELDS
  ? process.env.FIELD_DEFINITION_FIELDS.split(',').map((field) => field.trim()).filter(Boolean)
  : undefined;
const updatedWithin = process.env.UPDATED_WITHIN || undefined;
const metadataApiVersion = process.env.METADATA_API_VERSION || undefined;

const username = process.env.SF_USERNAME;
if (!username) {
  console.error('Error: SF_USERNAME environment variable is required.');
  process.exit(1);
}

const data = await fetchFieldDefinitions(username, objectScope, fieldDefinitionFields, updatedWithin).catch((err) => {
  console.error(err);
  process.exit(1);
});

const OUTPUT_DIR = process.env.OUTPUT_DIR
  ? resolve(process.env.OUTPUT_DIR)
  : resolve(__dirname, '..', 'docs');

const OUTPUT_PATH = format === 'package-xml'
  ? resolve(OUTPUT_DIR, 'package.xml')
  : resolve(OUTPUT_DIR, `field-definitions.${format}`);

switch (format) {
  case 'json':
    await saveResults(data, OUTPUT_PATH).catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;
  case 'csv':
    await saveResultsAsCsv(data, OUTPUT_PATH).catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;
  case 'json-per-object':
    await saveResultsPerObject(data, OUTPUT_DIR).catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;
  case 'csv-per-object':
    await saveResultsAsCsvPerObject(data, OUTPUT_DIR).catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;
  case 'package-xml':
    await saveAsPackageXml(data, OUTPUT_PATH, metadataApiVersion).catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;
  default:
    console.error('Error: format argument is missing or invalid. Use "json", "csv", "json-per-object", "csv-per-object", or "package-xml".');
    process.exit(1);
}

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchEntityDefinitions } from './lib/fetch.js';
import { saveEntityResults, saveEntityResultsAsCsv } from './lib/output.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const format = process.argv[2];
const objectScope = process.argv[3] ?? 'all';
const entityDefinitionFields = process.env.ENTITY_DEFINITION_FIELDS
  ? process.env.ENTITY_DEFINITION_FIELDS.split(',').map((field) => field.trim()).filter(Boolean)
  : undefined;
const updatedWithin = process.env.UPDATED_WITHIN || undefined;

const username = process.env.SF_USERNAME;
if (!username) {
  console.error('Error: SF_USERNAME environment variable is required.');
  process.exit(1);
}

const data = await fetchEntityDefinitions(username, objectScope, entityDefinitionFields, updatedWithin).catch((err) => {
  console.error(err);
  process.exit(1);
});

const OUTPUT_DIR = process.env.OUTPUT_DIR
  ? resolve(process.env.OUTPUT_DIR)
  : resolve(__dirname, '..', 'docs');

const OUTPUT_PATH = resolve(OUTPUT_DIR, `entity-definitions.${format}`);

switch (format) {
  case 'json':
    await saveEntityResults(data, OUTPUT_PATH).catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;
  case 'csv':
    await saveEntityResultsAsCsv(data, OUTPUT_PATH).catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;
  default:
    console.error('Error: format argument is missing or invalid. Use "json" or "csv".');
    process.exit(1);
}

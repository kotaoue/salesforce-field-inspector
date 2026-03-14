import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchFieldDefinitions } from './lib/fetch.js';
import { saveResults, saveResultsAsCsv, saveResultsPerObject, saveResultsAsCsvPerObject } from './lib/output.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const format = process.argv[2];

const username = process.env.SF_USERNAME;
if (!username) {
  console.error('Error: SF_USERNAME environment variable is required.');
  process.exit(1);
}

const data = await fetchFieldDefinitions(username).catch((err) => {
  console.error(err);
  process.exit(1);
});

const OUTPUT_DIR = process.env.OUTPUT_DIR
  ? resolve(process.env.OUTPUT_DIR)
  : resolve(__dirname, '..', 'docs');

const OUTPUT_PATH = resolve(OUTPUT_DIR, `field-definitions.${format}`);

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
  default:
    console.error('Error: format argument is missing or invalid. Use "json", "csv", "json-per-object", or "csv-per-object".');
    process.exit(1);
}

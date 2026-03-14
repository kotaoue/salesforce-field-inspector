import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const CSV_FIELDS = [
  'Id',
  'DurableId',
  'QualifiedApiName',
  'EntityDefinitionId',
  'NamespacePrefix',
  'DeveloperName',
  'MasterLabel',
  'Label',
  'DataType',
  'IsCalculated',
  'IsNillable',
  'IsIndexed',
  'IsApiFilterable',
  'IsApiGroupable',
  'IsApiSortable',
];

/**
 * Escape a value for CSV output.
 * @param {*} value
 * @returns {string}
 */
function escapeCsvValue(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialize FieldDefinition results to a JSON file.
 * @param {{ instanceUrl: string, records: object[] }} data
 * @param {string} outputFile - Absolute path to the destination file
 */
export async function saveResults(data, outputFile) {
  const output = {
    fetchedAt: new Date().toISOString(),
    instanceUrl: data.instanceUrl,
    totalSize: data.records.length,
    records: data.records,
  };

  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Results saved to ${outputFile}`);
}

/**
 * Serialize FieldDefinition results to a CSV file.
 * @param {{ instanceUrl: string, records: object[] }} data
 * @param {string} outputFile - Absolute path to the destination file
 */
export async function saveResultsAsCsv(data, outputFile) {
  const header = CSV_FIELDS.join(',');
  const rows = data.records.map((record) =>
    CSV_FIELDS.map((field) => escapeCsvValue(record[field])).join(',')
  );
  const csv = [header, ...rows].join('\r\n') + '\r\n';

  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, csv, 'utf-8');
  console.log(`Results saved to ${outputFile}`);
}

/**
 * Group FieldDefinition records by EntityDefinitionId.
 * @param {object[]} records
 * @returns {Map<string, object[]>}
 */
function groupRecordsByEntity(records) {
  const byEntity = new Map();
  for (const record of records) {
    const entityId = record.EntityDefinitionId;
    if (!byEntity.has(entityId)) {
      byEntity.set(entityId, []);
    }
    byEntity.get(entityId).push(record);
  }
  return byEntity;
}

/**
 * Serialize FieldDefinition results to separate JSON files, one per object.
 * Each file is named after the object's EntityDefinitionId (e.g. Account.json).
 * @param {{ instanceUrl: string, records: object[] }} data
 * @param {string} outputDir - Absolute path to the output directory
 */
export async function saveResultsPerObject(data, outputDir) {
  await mkdir(outputDir, { recursive: true });

  const fetchedAt = new Date().toISOString();
  const byEntity = groupRecordsByEntity(data.records);

  for (const [entityId, records] of byEntity) {
    const output = {
      fetchedAt,
      instanceUrl: data.instanceUrl,
      totalSize: records.length,
      records,
    };
    const outputFile = resolve(outputDir, `${entityId}.json`);
    await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf-8');
  }

  console.log(`Results saved to ${outputDir} (${byEntity.size} files)`);
}

/**
 * Serialize FieldDefinition results to separate CSV files, one per object.
 * Each file is named after the object's EntityDefinitionId (e.g. Account.csv).
 * @param {{ instanceUrl: string, records: object[] }} data
 * @param {string} outputDir - Absolute path to the output directory
 */
export async function saveResultsAsCsvPerObject(data, outputDir) {
  await mkdir(outputDir, { recursive: true });

  const byEntity = groupRecordsByEntity(data.records);

  const header = CSV_FIELDS.join(',');
  for (const [entityId, records] of byEntity) {
    const rows = records.map((record) =>
      CSV_FIELDS.map((field) => escapeCsvValue(record[field])).join(',')
    );
    const csv = [header, ...rows].join('\r\n') + '\r\n';
    const outputFile = resolve(outputDir, `${entityId}.csv`);
    await writeFile(outputFile, csv, 'utf-8');
  }

  console.log(`Results saved to ${outputDir} (${byEntity.size} files)`);
}

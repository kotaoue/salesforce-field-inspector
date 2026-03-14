import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { saveResults, saveResultsAsCsv, saveResultsPerObject, saveResultsAsCsvPerObject } from './output.js';

const SAMPLE_RECORDS = [
  {
    Id: 'aaa000',
    DurableId: 'Account.Name',
    QualifiedApiName: 'Name',
    EntityDefinitionId: 'Account',
    NamespacePrefix: null,
    DeveloperName: 'Name',
    MasterLabel: 'Account Name',
    Label: 'Account Name',
    DataType: 'Text',
    IsCalculated: false,
    IsNillable: false,
    IsIndexed: true,
    IsApiFilterable: true,
    IsApiGroupable: true,
    IsApiSortable: true,
  },
  {
    Id: 'bbb111',
    DurableId: 'Contact.Email',
    QualifiedApiName: 'Email',
    EntityDefinitionId: 'Contact',
    NamespacePrefix: null,
    DeveloperName: 'Email',
    MasterLabel: 'Email',
    Label: 'Email',
    DataType: 'Email',
    IsCalculated: false,
    IsNillable: true,
    IsIndexed: false,
    IsApiFilterable: true,
    IsApiGroupable: false,
    IsApiSortable: true,
  },
];

const SAMPLE_DATA = {
  instanceUrl: 'https://example.my.salesforce.com',
  records: SAMPLE_RECORDS,
};

const CSV_HEADER = 'Id,DurableId,QualifiedApiName,EntityDefinitionId,NamespacePrefix,DeveloperName,MasterLabel,Label,DataType,IsCalculated,IsNillable,IsIndexed,IsApiFilterable,IsApiGroupable,IsApiSortable';

describe('saveResults', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(resolve(tmpdir(), 'sfi-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes a JSON file with correct structure', async () => {
    const outputFile = resolve(tmpDir, 'output.json');
    await saveResults(SAMPLE_DATA, outputFile);

    const content = JSON.parse(await readFile(outputFile, 'utf-8'));
    expect(content.instanceUrl).toBe(SAMPLE_DATA.instanceUrl);
    expect(content.totalSize).toBe(SAMPLE_RECORDS.length);
    expect(content.records).toEqual(SAMPLE_RECORDS);
    expect(typeof content.fetchedAt).toBe('string');
    expect(() => new Date(content.fetchedAt)).not.toThrow();
  });

  it('creates intermediate directories as needed', async () => {
    const outputFile = resolve(tmpDir, 'nested', 'dir', 'output.json');
    await saveResults(SAMPLE_DATA, outputFile);

    const content = JSON.parse(await readFile(outputFile, 'utf-8'));
    expect(content.totalSize).toBe(SAMPLE_RECORDS.length);
  });

  it('writes pretty-printed JSON', async () => {
    const outputFile = resolve(tmpDir, 'output.json');
    await saveResults(SAMPLE_DATA, outputFile);

    const raw = await readFile(outputFile, 'utf-8');
    expect(raw).toContain('\n');
    expect(raw).toContain('  ');
  });
});

describe('saveResultsAsCsv', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(resolve(tmpdir(), 'sfi-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes a CSV file with header and data rows', async () => {
    const outputFile = resolve(tmpDir, 'output.csv');
    await saveResultsAsCsv(SAMPLE_DATA, outputFile);

    const content = await readFile(outputFile, 'utf-8');
    const lines = content.split('\r\n');
    expect(lines[0]).toBe(CSV_HEADER);
    // lines = [header, ...records, trailing empty string after final \r\n]
    const HEADER_LINES = 1;
    const TRAILING_EMPTY = 1;
    expect(lines.length).toBe(HEADER_LINES + SAMPLE_RECORDS.length + TRAILING_EMPTY);
  });

  it('uses CRLF line endings', async () => {
    const outputFile = resolve(tmpDir, 'output.csv');
    await saveResultsAsCsv(SAMPLE_DATA, outputFile);

    const content = await readFile(outputFile, 'utf-8');
    expect(content).toContain('\r\n');
  });

  it('ends with a trailing CRLF', async () => {
    const outputFile = resolve(tmpDir, 'output.csv');
    await saveResultsAsCsv(SAMPLE_DATA, outputFile);

    const content = await readFile(outputFile, 'utf-8');
    expect(content.endsWith('\r\n')).toBe(true);
  });

  it('handles null fields by outputting empty string', async () => {
    const outputFile = resolve(tmpDir, 'output.csv');
    await saveResultsAsCsv(SAMPLE_DATA, outputFile);

    const content = await readFile(outputFile, 'utf-8');
    const rows = content.split('\r\n');
    // NamespacePrefix is null in sample data; its column value should be empty
    const namespacePrefixIndex = CSV_HEADER.split(',').indexOf('NamespacePrefix');
    const firstDataRow = rows[1].split(',');
    expect(firstDataRow[namespacePrefixIndex]).toBe('');
  });

  it('escapes values containing commas with double quotes', async () => {
    const data = {
      instanceUrl: 'https://example.my.salesforce.com',
      records: [{ ...SAMPLE_RECORDS[0], MasterLabel: 'Name, With Comma' }],
    };
    const outputFile = resolve(tmpDir, 'output.csv');
    await saveResultsAsCsv(data, outputFile);

    const content = await readFile(outputFile, 'utf-8');
    expect(content).toContain('"Name, With Comma"');
  });

  it('escapes values containing double quotes', async () => {
    const data = {
      instanceUrl: 'https://example.my.salesforce.com',
      records: [{ ...SAMPLE_RECORDS[0], MasterLabel: 'Name "Quoted"' }],
    };
    const outputFile = resolve(tmpDir, 'output.csv');
    await saveResultsAsCsv(data, outputFile);

    const content = await readFile(outputFile, 'utf-8');
    expect(content).toContain('"Name ""Quoted"""');
  });

  it('creates intermediate directories as needed', async () => {
    const outputFile = resolve(tmpDir, 'nested', 'output.csv');
    await saveResultsAsCsv(SAMPLE_DATA, outputFile);

    const content = await readFile(outputFile, 'utf-8');
    expect(content).toContain(CSV_HEADER);
  });
});

describe('saveResultsPerObject', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(resolve(tmpdir(), 'sfi-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates one JSON file per entity', async () => {
    await saveResultsPerObject(SAMPLE_DATA, tmpDir);

    const accountContent = JSON.parse(await readFile(resolve(tmpDir, 'Account.json'), 'utf-8'));
    const contactContent = JSON.parse(await readFile(resolve(tmpDir, 'Contact.json'), 'utf-8'));

    expect(accountContent.totalSize).toBe(1);
    expect(accountContent.records[0].EntityDefinitionId).toBe('Account');

    expect(contactContent.totalSize).toBe(1);
    expect(contactContent.records[0].EntityDefinitionId).toBe('Contact');
  });

  it('includes instanceUrl and fetchedAt in each file', async () => {
    await saveResultsPerObject(SAMPLE_DATA, tmpDir);

    const content = JSON.parse(await readFile(resolve(tmpDir, 'Account.json'), 'utf-8'));
    expect(content.instanceUrl).toBe(SAMPLE_DATA.instanceUrl);
    expect(typeof content.fetchedAt).toBe('string');
  });

  it('all per-object files share the same fetchedAt timestamp', async () => {
    await saveResultsPerObject(SAMPLE_DATA, tmpDir);

    const account = JSON.parse(await readFile(resolve(tmpDir, 'Account.json'), 'utf-8'));
    const contact = JSON.parse(await readFile(resolve(tmpDir, 'Contact.json'), 'utf-8'));
    expect(account.fetchedAt).toBe(contact.fetchedAt);
  });

  it('groups multiple records for the same entity into one file', async () => {
    const data = {
      instanceUrl: 'https://example.my.salesforce.com',
      records: [
        { ...SAMPLE_RECORDS[0], EntityDefinitionId: 'Account' },
        { ...SAMPLE_RECORDS[1], EntityDefinitionId: 'Account', Id: 'ccc222' },
      ],
    };
    await saveResultsPerObject(data, tmpDir);

    const content = JSON.parse(await readFile(resolve(tmpDir, 'Account.json'), 'utf-8'));
    expect(content.totalSize).toBe(2);
    expect(content.records).toHaveLength(2);
  });
});

describe('saveResultsAsCsvPerObject', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(resolve(tmpdir(), 'sfi-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates one CSV file per entity', async () => {
    await saveResultsAsCsvPerObject(SAMPLE_DATA, tmpDir);

    const accountContent = await readFile(resolve(tmpDir, 'Account.csv'), 'utf-8');
    const contactContent = await readFile(resolve(tmpDir, 'Contact.csv'), 'utf-8');

    expect(accountContent).toContain(CSV_HEADER);
    expect(contactContent).toContain(CSV_HEADER);
  });

  it('each CSV file contains only records for its entity', async () => {
    await saveResultsAsCsvPerObject(SAMPLE_DATA, tmpDir);

    const accountContent = await readFile(resolve(tmpDir, 'Account.csv'), 'utf-8');
    expect(accountContent).toContain('Account.Name');
    expect(accountContent).not.toContain('Contact.Email');

    const contactContent = await readFile(resolve(tmpDir, 'Contact.csv'), 'utf-8');
    expect(contactContent).toContain('Contact.Email');
    expect(contactContent).not.toContain('Account.Name');
  });

  it('uses CRLF line endings', async () => {
    await saveResultsAsCsvPerObject(SAMPLE_DATA, tmpDir);

    const content = await readFile(resolve(tmpDir, 'Account.csv'), 'utf-8');
    expect(content).toContain('\r\n');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchFieldDefinitions, parseDuration } from './fetch.js';

// Mock @salesforce/core so no real Salesforce connection is made.
vi.mock('@salesforce/core', () => {
  const AuthInfo = {
    create: vi.fn(),
  };
  const Connection = {
    create: vi.fn(),
  };
  return { AuthInfo, Connection };
});

import { AuthInfo, Connection } from '@salesforce/core';

/**
 * Build a minimal mock Salesforce connection.
 * @param {object[]} entityRecords - Records returned for EntityDefinition query.
 * @param {object[]} fieldRecords  - Records returned for FieldDefinition query.
 */
function buildMockConnection(entityRecords, fieldRecords) {
  const tooling = {
    query: vi.fn(),
    queryMore: vi.fn(),
  };

  // First call → EntityDefinition, second call onward → FieldDefinition
  tooling.query
    .mockResolvedValueOnce({ records: entityRecords, done: true, nextRecordsUrl: null })
    .mockResolvedValue({ records: fieldRecords, done: true });

  return {
    instanceUrl: 'https://example.my.salesforce.com',
    tooling,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchFieldDefinitions', () => {
  it('returns instanceUrl and records from the connection', async () => {
    const entityRecords = [{ DurableId: 'Account' }];
    const fieldRecords = [
      {
        Id: 'aaa000',
        DurableId: 'Account.Name',
        QualifiedApiName: 'Name',
        EntityDefinitionId: 'Account',
      },
    ];

    const mockConn = buildMockConnection(entityRecords, fieldRecords);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    const result = await fetchFieldDefinitions('user@example.com');

    expect(result.instanceUrl).toBe('https://example.my.salesforce.com');
    expect(result.records).toEqual(fieldRecords);

    const fieldQuery = mockConn.tooling.query.mock.calls[1][0];
    expect(fieldQuery).toContain(
      'SELECT Id, DurableId, QualifiedApiName, EntityDefinitionId, NamespacePrefix, DeveloperName, MasterLabel, Label, DataType, IsCalculated, IsNillable, IsIndexed, IsApiFilterable, IsApiGroupable, IsApiSortable'
    );
  });

  it('calls AuthInfo.create and Connection.create with the given username', async () => {
    const mockAuthInfo = {};
    const mockConn = buildMockConnection([], []);
    AuthInfo.create.mockResolvedValue(mockAuthInfo);
    Connection.create.mockResolvedValue(mockConn);

    await fetchFieldDefinitions('user@example.com');

    expect(AuthInfo.create).toHaveBeenCalledWith({ username: 'user@example.com' });
    expect(Connection.create).toHaveBeenCalledWith({ authInfo: mockAuthInfo });
  });

  it('returns an empty records array when there are no EntityDefinitions', async () => {
    const mockConn = buildMockConnection([], []);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    const result = await fetchFieldDefinitions('user@example.com');

    expect(result.records).toEqual([]);
  });

  it('filters out EntityDefinition DurableIds that fail validation', async () => {
    // mixedEntityRecords contains one valid and one invalid (space in name) DurableId.
    const mixedEntityRecords = [{ DurableId: 'Account' }, { DurableId: 'Invalid Id' }];
    const fieldRecords = [{ Id: 'aaa000', EntityDefinitionId: 'Account' }];

    const mockConn = buildMockConnection(mixedEntityRecords, fieldRecords);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    const result = await fetchFieldDefinitions('user@example.com');

    // Only valid 'Account' entity is queried; its field records are returned.
    expect(result.records).toEqual(fieldRecords);
    // FieldDefinition query should only be called for valid entity IDs.
    const fieldQuery = mockConn.tooling.query.mock.calls[1][0];
    expect(fieldQuery).toContain("'Account'");
    expect(fieldQuery).not.toContain('Invalid Id');
  });

  it('accumulates records from multiple entity batches', async () => {
    const entityRecords = [{ DurableId: 'Account' }, { DurableId: 'Contact' }];
    const accountField = { Id: 'aaa000', EntityDefinitionId: 'Account' };
    const contactField = { Id: 'bbb111', EntityDefinitionId: 'Contact' };

    const mockConn = {
      instanceUrl: 'https://example.my.salesforce.com',
      tooling: {
        query: vi.fn()
          .mockResolvedValueOnce({ records: entityRecords, done: true, nextRecordsUrl: null })
          .mockResolvedValueOnce({ records: [accountField], done: true })
          .mockResolvedValueOnce({ records: [contactField], done: true }),
        queryMore: vi.fn(),
      },
    };

    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    const result = await fetchFieldDefinitions('user@example.com');

    expect(result.records).toHaveLength(2);
    expect(result.records).toContainEqual(accountField);
    expect(result.records).toContainEqual(contactField);
  });

  it('uses only requested select fields when field list is provided', async () => {
    const entityRecords = [{ DurableId: 'Account' }];
    const fieldRecords = [{ Id: 'aaa000', EntityDefinitionId: 'Account' }];

    const mockConn = buildMockConnection(entityRecords, fieldRecords);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    await fetchFieldDefinitions('user@example.com', 'all', ['Id', 'EntityDefinitionId']);

    const fieldQuery = mockConn.tooling.query.mock.calls[1][0];
    expect(fieldQuery).toContain('SELECT Id, EntityDefinitionId FROM FieldDefinition');
    expect(fieldQuery).not.toContain('QualifiedApiName');
  });

  it('throws when requested fields include unsupported names', async () => {
    await expect(fetchFieldDefinitions('user@example.com', 'all', ['Id', 'UnknownField']))
      .rejects
      .toThrow('Unsupported field name: UnknownField.');
  });

  it('throws when requested fields include invalid characters', async () => {
    await expect(fetchFieldDefinitions('user@example.com', 'all', ['Id', 'Name, DurableId']))
      .rejects
      .toThrow('Invalid field name: Name, DurableId.');
  });

  it('deduplicates requested fields while preserving order', async () => {
    const entityRecords = [{ DurableId: 'Account' }];
    const fieldRecords = [{ Id: 'aaa000', EntityDefinitionId: 'Account' }];

    const mockConn = buildMockConnection(entityRecords, fieldRecords);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    await fetchFieldDefinitions('user@example.com', 'all', ['Id', 'Id', 'EntityDefinitionId']);

    const fieldQuery = mockConn.tooling.query.mock.calls[1][0];
    expect(fieldQuery).toContain('SELECT Id, EntityDefinitionId FROM FieldDefinition');
  });

  it('follows queryMore for EntityDefinition pagination', async () => {
    const firstPage = [{ DurableId: 'Account' }];
    const secondPage = [{ DurableId: 'Contact' }];
    const fieldRecord = { Id: 'aaa000', EntityDefinitionId: 'Account' };

    const mockConn = {
      instanceUrl: 'https://example.my.salesforce.com',
      tooling: {
        query: vi.fn()
          .mockResolvedValueOnce({
            records: firstPage,
            done: false,
            nextRecordsUrl: '/services/data/v60.0/query/next',
          })
          .mockResolvedValue({ records: [fieldRecord], done: true }),
        queryMore: vi.fn().mockResolvedValueOnce({
          records: secondPage,
          done: true,
          nextRecordsUrl: null,
        }),
      },
    };

    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    const result = await fetchFieldDefinitions('user@example.com');

    expect(mockConn.tooling.queryMore).toHaveBeenCalledTimes(1);
    // Both Account and Contact fields should be returned.
    expect(result.records).toHaveLength(2);
  });
});

describe('isValidDurableId (via fetchFieldDefinitions)', () => {
  it('accepts alphanumeric and underscore IDs', async () => {
    const entityRecords = [{ DurableId: 'My_Custom_Object__c' }];
    const fieldRecords = [{ Id: 'x', EntityDefinitionId: 'My_Custom_Object__c' }];

    const mockConn = buildMockConnection(entityRecords, fieldRecords);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    const result = await fetchFieldDefinitions('user@example.com');
    expect(result.records).toEqual(fieldRecords);
  });

  it('rejects IDs with special characters', async () => {
    const entityRecords = [{ DurableId: 'Bad;Id' }];

    const mockConn = buildMockConnection(entityRecords, []);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    const result = await fetchFieldDefinitions('user@example.com');
    // No valid entity IDs, so no FieldDefinition query should be made.
    expect(mockConn.tooling.query).toHaveBeenCalledTimes(1);
    expect(result.records).toEqual([]);
  });
});

describe('object scope filtering', () => {
  it('keeps only system objects when scope is system', async () => {
    const entityRecords = [{ DurableId: 'Account' }, { DurableId: 'MyObject__c' }];
    const systemField = { Id: 'aaa000', EntityDefinitionId: 'Account' };

    const mockConn = buildMockConnection(entityRecords, [systemField]);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    await fetchFieldDefinitions('user@example.com', 'system');

    const fieldQuery = mockConn.tooling.query.mock.calls[1][0];
    expect(fieldQuery).toContain("'Account'");
    expect(fieldQuery).not.toContain('MyObject__c');
  });

  it('keeps only custom objects when scope is custom', async () => {
    const entityRecords = [{ DurableId: 'Account' }, { DurableId: 'MyObject__c' }];
    const customField = { Id: 'bbb111', EntityDefinitionId: 'MyObject__c' };

    const mockConn = buildMockConnection(entityRecords, [customField]);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    await fetchFieldDefinitions('user@example.com', 'custom');

    const fieldQuery = mockConn.tooling.query.mock.calls[1][0];
    expect(fieldQuery).toContain('MyObject__c');
    expect(fieldQuery).not.toContain("'Account'");
  });

  it('throws an error for unsupported object scope', async () => {
    await expect(fetchFieldDefinitions('user@example.com', 'unsupported'))
      .rejects
      .toThrow('Invalid object scope: unsupported. Use one of: all, system, custom.');
  });
});

describe('parseDuration', () => {
  it('parses "2days" as 2 × 24 hours in ms', () => {
    expect(parseDuration('2days')).toBe(2 * 24 * 60 * 60 * 1000);
  });

  it('parses "1day" (singular)', () => {
    expect(parseDuration('1day')).toBe(24 * 60 * 60 * 1000);
  });

  it('parses "d" shorthand', () => {
    expect(parseDuration('3d')).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it('parses "12hours"', () => {
    expect(parseDuration('12hours')).toBe(12 * 60 * 60 * 1000);
  });

  it('parses "1hour" (singular)', () => {
    expect(parseDuration('1hour')).toBe(60 * 60 * 1000);
  });

  it('parses "h" shorthand', () => {
    expect(parseDuration('6h')).toBe(6 * 60 * 60 * 1000);
  });

  it('parses "30min"', () => {
    expect(parseDuration('30min')).toBe(30 * 60 * 1000);
  });

  it('parses "30mins"', () => {
    expect(parseDuration('30mins')).toBe(30 * 60 * 1000);
  });

  it('parses "1minute" (singular)', () => {
    expect(parseDuration('1minute')).toBe(60 * 1000);
  });

  it('parses "60minutes"', () => {
    expect(parseDuration('60minutes')).toBe(60 * 60 * 1000);
  });

  it('parses "1week"', () => {
    expect(parseDuration('1week')).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('parses "2weeks" (plural)', () => {
    expect(parseDuration('2weeks')).toBe(2 * 7 * 24 * 60 * 60 * 1000);
  });

  it('parses "w" shorthand', () => {
    expect(parseDuration('1w')).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('is case-insensitive', () => {
    expect(parseDuration('2DAYS')).toBe(2 * 24 * 60 * 60 * 1000);
    expect(parseDuration('6H')).toBe(6 * 60 * 60 * 1000);
  });

  it('trims surrounding whitespace', () => {
    expect(parseDuration('  2days  ')).toBe(2 * 24 * 60 * 60 * 1000);
  });

  it('throws for an empty string', () => {
    expect(() => parseDuration('')).toThrow('Invalid duration');
  });

  it('throws for an invalid format', () => {
    expect(() => parseDuration('abc')).toThrow('Invalid duration');
  });

  it('throws for missing unit', () => {
    expect(() => parseDuration('42')).toThrow('Invalid duration');
  });

  it('throws for unknown unit', () => {
    expect(() => parseDuration('2years')).toThrow('Invalid duration');
  });
});

describe('updatedWithin filtering', () => {
  it('adds a LastModifiedDate WHERE clause when updatedWithin is provided', async () => {
    const entityRecords = [{ DurableId: 'Account' }];
    const fieldRecords = [{ Id: 'aaa000', EntityDefinitionId: 'Account' }];

    const mockConn = buildMockConnection(entityRecords, fieldRecords);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    await fetchFieldDefinitions('user@example.com', 'all', undefined, '2days');

    const entityQuery = mockConn.tooling.query.mock.calls[0][0];
    expect(entityQuery).toContain('WHERE LastModifiedDate >=');
  });

  it('does not add a WHERE clause when updatedWithin is undefined', async () => {
    const entityRecords = [{ DurableId: 'Account' }];
    const fieldRecords = [{ Id: 'aaa000', EntityDefinitionId: 'Account' }];

    const mockConn = buildMockConnection(entityRecords, fieldRecords);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    await fetchFieldDefinitions('user@example.com');

    const entityQuery = mockConn.tooling.query.mock.calls[0][0];
    expect(entityQuery).not.toContain('WHERE');
  });

  it('does not add a WHERE clause when updatedWithin is an empty string', async () => {
    const entityRecords = [{ DurableId: 'Account' }];
    const fieldRecords = [{ Id: 'aaa000', EntityDefinitionId: 'Account' }];

    const mockConn = buildMockConnection(entityRecords, fieldRecords);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    await fetchFieldDefinitions('user@example.com', 'all', undefined, '');

    const entityQuery = mockConn.tooling.query.mock.calls[0][0];
    expect(entityQuery).not.toContain('WHERE');
  });

  it('uses a datetime no more than the specified duration in the past', async () => {
    const entityRecords = [{ DurableId: 'Account' }];
    const fieldRecords = [{ Id: 'aaa000', EntityDefinitionId: 'Account' }];

    const mockConn = buildMockConnection(entityRecords, fieldRecords);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    const TIMING_TOLERANCE_MS = 1000;
    const before = Date.now();
    await fetchFieldDefinitions('user@example.com', 'all', undefined, '24hours');
    const after = Date.now();

    const entityQuery = mockConn.tooling.query.mock.calls[0][0];
    // Extract the datetime literal from the query
    const match = entityQuery.match(/LastModifiedDate >= (\S+)/);
    expect(match).not.toBeNull();
    const queryDate = new Date(match[1]);
    const expectedMs = 24 * 60 * 60 * 1000;
    // The cutoff should be between (before - expectedMs) and (after - expectedMs)
    expect(queryDate.getTime()).toBeGreaterThanOrEqual(before - expectedMs - TIMING_TOLERANCE_MS);
    expect(queryDate.getTime()).toBeLessThanOrEqual(after - expectedMs + TIMING_TOLERANCE_MS);
  });

  it('throws when updatedWithin is an invalid duration', async () => {
    await expect(fetchFieldDefinitions('user@example.com', 'all', undefined, 'invalid'))
      .rejects
      .toThrow('Invalid duration');
  });
});

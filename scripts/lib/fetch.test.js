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
    // The WHERE clause filters at the SOQL level; mock returns only system objects.
    const entityRecords = [{ DurableId: 'Account' }];
    const systemField = { Id: 'aaa000', EntityDefinitionId: 'Account' };

    const mockConn = buildMockConnection(entityRecords, [systemField]);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    await fetchFieldDefinitions('user@example.com', 'system');

    // EntityDefinition query must use NOT (...LIKE...) to exclude custom objects.
    const entityQuery = mockConn.tooling.query.mock.calls[0][0];
    expect(entityQuery).toContain("NOT (DurableId LIKE '%\\_\\_%')");

    const fieldQuery = mockConn.tooling.query.mock.calls[1][0];
    expect(fieldQuery).toContain("'Account'");
    expect(fieldQuery).not.toContain('MyObject__c');
  });

  it('keeps only custom objects when scope is custom', async () => {
    // The WHERE clause filters at the SOQL level; mock returns only custom objects.
    const entityRecords = [{ DurableId: 'MyObject__c' }];
    const customField = { Id: 'bbb111', EntityDefinitionId: 'MyObject__c' };

    const mockConn = buildMockConnection(entityRecords, [customField]);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    await fetchFieldDefinitions('user@example.com', 'custom');

    // EntityDefinition query must use LIKE to include only custom objects.
    const entityQuery = mockConn.tooling.query.mock.calls[0][0];
    expect(entityQuery).toContain("LIKE '%\\_\\_%'");
    expect(entityQuery).not.toContain('NOT (');

    const fieldQuery = mockConn.tooling.query.mock.calls[1][0];
    expect(fieldQuery).toContain('MyObject__c');
  });

  it('does not add a WHERE clause to the EntityDefinition query when scope is all', async () => {
    const entityRecords = [{ DurableId: 'Account' }];
    const mockConn = buildMockConnection(entityRecords, []);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    await fetchFieldDefinitions('user@example.com', 'all');

    const entityQuery = mockConn.tooling.query.mock.calls[0][0];
    expect(entityQuery).not.toContain('LIKE');
    expect(entityQuery).not.toContain('WHERE');
  });

  it('throws an error for unsupported object scope', async () => {
    await expect(fetchFieldDefinitions('user@example.com', 'unsupported'))
      .rejects
      .toThrow('Invalid object scope: unsupported. Use one of: all, system, custom.');
  });
});

describe('parseDuration', () => {
  it.each([
    ['1week', 7 * 24 * 60 * 60 * 1000],
    ['2weeks', 14 * 24 * 60 * 60 * 1000],
    ['1w', 7 * 24 * 60 * 60 * 1000],
    ['3days', 3 * 24 * 60 * 60 * 1000],
    ['1day', 24 * 60 * 60 * 1000],
    ['1d', 24 * 60 * 60 * 1000],
    ['12hours', 12 * 60 * 60 * 1000],
    ['1hour', 60 * 60 * 1000],
    ['1h', 60 * 60 * 1000],
    ['30min', 30 * 60 * 1000],
    ['5mins', 5 * 60 * 1000],
    ['1minute', 60 * 1000],
    ['10minutes', 10 * 60 * 1000],
    ['2DAYS', 2 * 24 * 60 * 60 * 1000],
    ['6Hours', 6 * 60 * 60 * 1000],
    ['2 days', 2 * 24 * 60 * 60 * 1000],
  ])('parses "%s" into %d ms', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each([
    [''],
    ['2'],
    ['days'],
    ['1sec'],
    ['-1days'],
    ['1.5days'],
  ])('throws for invalid input "%s"', (input) => {
    expect(() => parseDuration(input)).toThrow('Invalid duration');
  });
});

describe('updatedWithin filtering', () => {
  it('adds a LastModifiedDate condition to the EntityDefinition query', async () => {
    const entityRecords = [{ DurableId: 'Account' }];
    const fieldRecords = [{ Id: 'aaa000', EntityDefinitionId: 'Account' }];

    const mockConn = buildMockConnection(entityRecords, fieldRecords);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    await fetchFieldDefinitions('user@example.com', 'all', undefined, '24hours');

    const entityQuery = mockConn.tooling.query.mock.calls[0][0];
    expect(entityQuery).toContain('LastModifiedDate >=');
    expect(entityQuery).toContain('WHERE');
  });

  it('uses a datetime no more than the specified duration in the past', async () => {
    const entityRecords = [{ DurableId: 'Account' }];
    const fieldRecords = [{ Id: 'aaa000', EntityDefinitionId: 'Account' }];

    const mockConn = buildMockConnection(entityRecords, fieldRecords);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    const before = Date.now();
    await fetchFieldDefinitions('user@example.com', 'all', undefined, '24hours');
    const after = Date.now();

    const entityQuery = mockConn.tooling.query.mock.calls[0][0];
    const match = entityQuery.match(/LastModifiedDate >= (\S+)/);
    expect(match).not.toBeNull();

    const cutoff = new Date(match[1]).getTime();
    const expectedMin = before - 24 * 60 * 60 * 1000 - 1000; // allow up to 1 s because toSoqlDateTimeLiteral truncates ms to second precision
    const expectedMax = after - 24 * 60 * 60 * 1000;
    expect(cutoff).toBeGreaterThanOrEqual(expectedMin);
    expect(cutoff).toBeLessThanOrEqual(expectedMax);
  });

  it('combines scope and date filters with AND', async () => {
    const entityRecords = [{ DurableId: 'MyObject__c' }];
    const fieldRecords = [{ Id: 'bbb111', EntityDefinitionId: 'MyObject__c' }];

    const mockConn = buildMockConnection(entityRecords, fieldRecords);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    await fetchFieldDefinitions('user@example.com', 'custom', undefined, '2days');

    const entityQuery = mockConn.tooling.query.mock.calls[0][0];
    expect(entityQuery).toContain("DurableId LIKE '%\\_\\_%'");
    expect(entityQuery).toContain('LastModifiedDate >=');
    expect(entityQuery).toContain(' AND ');
  });

  it('omits LastModifiedDate filter when updatedWithin is not provided', async () => {
    const entityRecords = [{ DurableId: 'Account' }];
    const mockConn = buildMockConnection(entityRecords, []);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    await fetchFieldDefinitions('user@example.com', 'all');

    const entityQuery = mockConn.tooling.query.mock.calls[0][0];
    expect(entityQuery).not.toContain('LastModifiedDate');
  });

  it('omits LastModifiedDate filter when updatedWithin is an empty string', async () => {
    const entityRecords = [{ DurableId: 'Account' }];
    const mockConn = buildMockConnection(entityRecords, []);
    AuthInfo.create.mockResolvedValue({});
    Connection.create.mockResolvedValue(mockConn);

    await fetchFieldDefinitions('user@example.com', 'all', undefined, '');

    const entityQuery = mockConn.tooling.query.mock.calls[0][0];
    expect(entityQuery).not.toContain('LastModifiedDate');
  });
});

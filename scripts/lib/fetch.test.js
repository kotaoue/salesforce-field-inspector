import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchFieldDefinitions } from './fetch.js';

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

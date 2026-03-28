import { AuthInfo, Connection } from '@salesforce/core';

const ENTITY_ID_PATTERN = /^[A-Za-z0-9_]+$/;
const OBJECT_SCOPE_VALUES = new Set(['all', 'system', 'custom']);
const DURATION_PATTERN = /^(\d+)\s*(weeks?|w|days?|d|hours?|h|mins?|minutes?)$/i;
const FIELD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const ALLOWED_FIELD_DEFINITION_FIELDS = [
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
const ALLOWED_FIELD_DEFINITION_FIELD_SET = new Set(ALLOWED_FIELD_DEFINITION_FIELDS);
// Query one entity at a time so each batch stays well within the 2000-record
// SOQL OFFSET ceiling.  Salesforce limits a single object to ~800 custom fields,
// meaning one entity's fields always fit in a single LIMIT 2000 page.
const BATCH_SIZE = 1;
const PAGE_SIZE = 2000;
// Salesforce SOQL OFFSET is capped at 2000 for FieldDefinition.
const MAX_OFFSET = 2000;

/**
 * Parse a human-readable duration string into milliseconds.
 * Accepted units: weeks (w), days (d), hours (h), minutes (min/mins/minute/minutes).
 * Examples: "2days", "12hours", "30min", "1week".
 * @param {string} durationStr
 * @returns {number} Duration in milliseconds
 */
export function parseDuration(durationStr) {
  const trimmed = String(durationStr).trim();
  const match = trimmed.match(DURATION_PATTERN);
  if (!match) {
    throw new Error(
      `Invalid duration: "${durationStr}". Use a format like "2days", "12hours", "30min", or "1week".`
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const msPerMinute = 60 * 1000;
  const msPerHour = 60 * msPerMinute;
  const msPerDay = 24 * msPerHour;
  const msPerWeek = 7 * msPerDay;

  if (unit === 'w' || unit.startsWith('week')) return value * msPerWeek;
  if (unit === 'd' || unit.startsWith('day')) return value * msPerDay;
  if (unit === 'h' || unit.startsWith('hour')) return value * msPerHour;
  return value * msPerMinute;
}

/**
 * Convert a Date object to a Salesforce SOQL datetime literal (UTC).
 * @param {Date} date
 * @returns {string}
 */
function toSoqlDateTimeLiteral(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Validate a DurableId to prevent SOQL injection.
 * @param {string} id
 * @returns {boolean}
 */
function isValidDurableId(id) {
  return typeof id === 'string' && ENTITY_ID_PATTERN.test(id);
}

/**
 * Build a SOQL WHERE clause that filters EntityDefinition by object scope.
 * Custom Salesforce objects use double underscore naming (e.g., __c, __mdt, __e),
 * so DurableId LIKE '%\_\_%' matches custom objects and NOT (...LIKE...) excludes them.
 * SOQL does not support NOT LIKE as a compound operator; use NOT (...) instead.
 * Returns an empty string for the 'all' scope (no filtering needed).
 * @param {'all' | 'system' | 'custom'} objectScope
 * @returns {string} - WHERE clause string (empty string for 'all')
 */
function buildObjectScopeWhereClause(objectScope) {
  if (objectScope === 'custom') {
    return "WHERE DurableId LIKE '%\\_\\_%'";
  }
  if (objectScope === 'system') {
    return "WHERE NOT (DurableId LIKE '%\\_\\_%')";
  }
  return '';
}

/**
 * Validate and normalize requested FieldDefinition select fields.
 * @param {string[] | undefined} fields
 * @returns {string[]}
 */
function normalizeFieldDefinitionFields(fields) {
  if (fields == null) {
    return ALLOWED_FIELD_DEFINITION_FIELDS;
  }

  if (!Array.isArray(fields)) {
    throw new Error('fieldDefinitionFields must be an array of field names.');
  }

  const normalized = fields
    .map((field) => (typeof field === 'string' ? field.trim() : field))
    .filter((field) => field !== '');

  if (normalized.length === 0) {
    throw new Error('fieldDefinitionFields must include at least one field.');
  }

  for (const field of normalized) {
    if (typeof field !== 'string' || !FIELD_NAME_PATTERN.test(field)) {
      throw new Error(`Invalid field name: ${String(field)}.`);
    }
    if (!ALLOWED_FIELD_DEFINITION_FIELD_SET.has(field)) {
      throw new Error(
        `Unsupported field name: ${field}. Allowed fields: ${ALLOWED_FIELD_DEFINITION_FIELDS.join(', ')}.`
      );
    }
  }

  // Deduplicate while preserving order.
  return [...new Set(normalized)];
}

/**
 * Query EntityDefinition DurableIds from the Tooling API.
 * @param {Connection} connection - Salesforce connection
 * @param {'all' | 'system' | 'custom'} objectScope - Object filter scope
 * @param {Date | null} [sinceDateTime] - When set, only entities modified at or after this date are returned
 * @returns {string[]} - Array of DurableId values
 */
async function fetchEntityDefinitionIds(connection, objectScope, sinceDateTime = null) {
  const scopeWhere = buildObjectScopeWhereClause(objectScope);
  let whereClause;
  if (sinceDateTime instanceof Date) {
    const dateCondition = `LastModifiedDate >= ${toSoqlDateTimeLiteral(sinceDateTime)}`;
    if (scopeWhere) {
      whereClause = ` ${scopeWhere} AND ${dateCondition}`;
    } else {
      whereClause = ` WHERE ${dateCondition}`;
    }
  } else {
    whereClause = scopeWhere ? ` ${scopeWhere}` : '';
  }
  let ids = [];
  let result = await connection.tooling.query(
    `SELECT DurableId FROM EntityDefinition${whereClause} ORDER BY DurableId LIMIT 2000`
  );
  for (const record of result.records) {
    ids.push(record.DurableId);
  }

  while (!result.done && result.nextRecordsUrl) {
    result = await connection.tooling.queryMore(result.nextRecordsUrl);
    for (const record of result.records) {
      ids.push(record.DurableId);
    }
  }

  return ids;
}

/**
 * Query FieldDefinition records for a batch of EntityDefinition IDs.
 * FieldDefinition does not support queryMore(), so we paginate manually using
 * LIMIT + OFFSET.  With BATCH_SIZE=1 each batch covers a single entity, whose
 * field count is well under the 2000-record SOQL OFFSET cap, so all records are
 * retrieved reliably in a single page.  The OFFSET loop and MAX_OFFSET guard
 * remain in place as a safety net for any unexpected edge case.
 * @param {Connection} connection - Salesforce connection
 * @param {string[]} entityIds - Array of validated EntityDefinition DurableId values
 * @param {string[]} fieldDefinitionFields - Validated FieldDefinition select fields
 * @returns {object[]} - Array of FieldDefinition records
 */
async function fetchFieldDefinitionBatch(connection, entityIds, fieldDefinitionFields) {
  const inList = entityIds.map((id) => `'${id}'`).join(', ');
  const selectClause = fieldDefinitionFields.join(', ');
  let records = [];
  let offset = 0;

  while (true) {
    const soql =
      `SELECT ${selectClause}` +
      ` FROM FieldDefinition WHERE EntityDefinitionId IN (${inList})` +
      ` ORDER BY EntityDefinitionId, DurableId LIMIT ${PAGE_SIZE} OFFSET ${offset}`;
    const result = await connection.tooling.query(soql);
    records = records.concat(result.records);

    if (result.records.length < PAGE_SIZE) {
      // Fewer records than the page size means there are no more pages.
      break;
    }

    if (offset >= MAX_OFFSET) {
      // SOQL OFFSET cannot exceed 2000.  Warn that results may be incomplete
      // and advise reducing BATCH_SIZE.
      console.warn(
        `Warning: reached the SOQL OFFSET limit (${MAX_OFFSET}) while fetching` +
        ` FieldDefinition records for a batch of ${entityIds.length} entity IDs` +
        ` (current BATCH_SIZE: ${entityIds.length}).` +
        ` Some records may have been omitted.  Reduce BATCH_SIZE to retrieve all records.`
      );
      break;
    }

    offset += PAGE_SIZE;
  }

  return records;
}

/**
 * Query all FieldDefinition records from the Tooling API.
 * @param {string} username - Salesforce username to authenticate as
 * @param {'all' | 'system' | 'custom'} [objectScope='all'] - Object filter scope
 * @param {string[]} [fieldDefinitionFields] - FieldDefinition select fields
 * @param {string | null | undefined} [updatedWithin] - Optional duration string (e.g. "2days", "12hours", "30min") to
 *   restrict results to entities whose LastModifiedDate falls within the specified window.
 * @returns {{ instanceUrl: string, records: object[] }}
 */
export async function fetchFieldDefinitions(username, objectScope = 'all', fieldDefinitionFields, updatedWithin) {
  if (!OBJECT_SCOPE_VALUES.has(objectScope)) {
    throw new Error(
      `Invalid object scope: ${objectScope}. Use one of: all, system, custom.`
    );
  }
  const selectFields = normalizeFieldDefinitionFields(fieldDefinitionFields);

  let sinceDateTime = null;
  if (updatedWithin != null && updatedWithin !== '') {
    const ms = parseDuration(updatedWithin);
    sinceDateTime = new Date(Date.now() - ms);
  }

  const authInfo = await AuthInfo.create({ username });
  const connection = await Connection.create({ authInfo });

  console.log(`Connected to: ${connection.instanceUrl}`);
  console.log(`Object scope: ${objectScope}`);
  if (sinceDateTime) {
    console.log(`Filtering objects modified since: ${sinceDateTime.toISOString()} (updatedWithin: ${updatedWithin})`);
  }

  const allEntityIds = await fetchEntityDefinitionIds(connection, objectScope, sinceDateTime);
  const invalidEntityIds = allEntityIds.filter((id) => !isValidDurableId(id));
  if (invalidEntityIds.length > 0) {
    console.warn(`Skipping ${invalidEntityIds.length} EntityDefinition record(s) with invalid DurableId.`);
  }
  const validEntityIds = allEntityIds.filter(isValidDurableId);
  console.log(`Found ${validEntityIds.length} EntityDefinition records.`);

  let records = [];
  for (let i = 0; i < validEntityIds.length; i += BATCH_SIZE) {
    const batch = validEntityIds.slice(i, i + BATCH_SIZE);
    const batchRecords = await fetchFieldDefinitionBatch(connection, batch, selectFields);
    records = records.concat(batchRecords);
    const processed = Math.min(i + BATCH_SIZE, validEntityIds.length);
    console.log(`Fetching FieldDefinitions: ${processed}/${validEntityIds.length} entities processed (${records.length} records so far)`);
  }

  console.log(`Fetched ${records.length} FieldDefinition records.`);

  return { instanceUrl: connection.instanceUrl, records };
}

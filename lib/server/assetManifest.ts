import { parseCsvRows } from '../csvParser';

export interface AssetManifest {
  [key: string]: unknown;
  format: string;
  recordCount: number;
  columnCount: number;
  columns: string[];
  schema: Array<{ name: string; type: string }>;
  nullRates: Record<string, number>;
  duplicateRate: number;
  sample: unknown[];
}

export function analyzeAsset(assetType: string, fileName: string, buffer: Buffer): AssetManifest {
  let format = 'UNKNOWN';
  if (fileName.toLowerCase().endsWith('.csv')) format = 'CSV';
  else if (fileName.toLowerCase().endsWith('.json')) format = 'JSON';
  else if (fileName.toLowerCase().endsWith('.parquet')) format = 'PARQUET';

  let recordCount = 0;
  let columnCount = 0;
  let columns: string[] = [];
  let schema: Array<{ name: string; type: string }> = [];
  let nullRates: Record<string, number> = {};
  let duplicateRate = 0;
  let sample: unknown[] = [];

  const processRows = (parsedRows: Record<string, unknown>[], cols: string[]) => {
    recordCount = parsedRows.length;
    columnCount = cols.length;
    columns = cols;
    const nullCounts: Record<string, number> = Object.fromEntries(cols.map((column) => [column, 0]));
    const rowStrings = new Set<string>();
    let duplicates = 0;

    for (const row of parsedRows) {
      const serialized = JSON.stringify(row);
      if (rowStrings.has(serialized)) duplicates++;
      rowStrings.add(serialized);
      for (const column of cols) {
        const value = row[column];
        if (value === null || value === undefined || value === '' || String(value).toLowerCase() === 'null' || String(value).toLowerCase() === 'na') nullCounts[column]++;
      }
    }

    schema = cols.map((column) => {
      const hasNumber = parsedRows.some((row) => {
        const value = row[column];
        return value !== null && value !== undefined && value !== '' && String(value).toLowerCase() !== 'null' && String(value).toLowerCase() !== 'na' && (typeof value === 'number' || !Number.isNaN(Number(value)));
      });
      nullRates[column] = recordCount > 0 ? nullCounts[column] / recordCount : 0;
      return { name: column, type: hasNumber ? 'number' : 'string' };
    });

    duplicateRate = recordCount > 0 ? duplicates / recordCount : 0;
    sample = parsedRows.slice(0, 100);
  };

  if (format === 'CSV' && assetType === 'dataset') {
    let rows: string[][];
    try { rows = parseCsvRows(buffer.toString('utf8')); }
    catch { throw new Error('CSV file contains invalid quoting or formatting.'); }
    if (rows.length < 2) throw new Error('CSV file must contain at least a header and one record row.');
    const cols = rows[0].map((column) => column.trim());
    if (cols.some((column) => !column) || new Set(cols).size !== cols.length) throw new Error('CSV column names must be non-empty and unique.');
    const dataRows = rows.slice(1);
    if (dataRows.some((values) => values.length !== cols.length)) throw new Error('Every CSV record must have the same number of values as the header.');
    processRows(dataRows.map((values) => Object.fromEntries(cols.map((column, index) => [column, values[index]]))), cols);
  } else if (format === 'JSON' && assetType === 'dataset') {
    let parsed: unknown;
    try { parsed = JSON.parse(buffer.toString('utf8')); }
    catch { throw new Error('Invalid JSON file format.'); }
    let parsedRows: unknown[];
    if (Array.isArray(parsed)) {
      if (!parsed.length) throw new Error('JSON array is empty.');
      parsedRows = parsed;
    } else if (typeof parsed === 'object' && parsed !== null) parsedRows = [parsed];
    else throw new Error('JSON file must contain an object or array.');

    const first = parsedRows[0];
    if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
      processRows(parsedRows as Record<string, unknown>[], Object.keys(first));
    } else {
      recordCount = parsedRows.length;
    }
  }

  return { format, recordCount, columnCount, columns, schema, nullRates, duplicateRate, sample: assetType === 'dataset' ? sample : [] };
}

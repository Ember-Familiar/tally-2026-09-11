import type { Member, Expense } from './routes/groups';

export const FORMULA_INJECTION_PREFIXES = ['=', '+', '-', '@', '\t', '\r'] as const;

/**
 * Neutralizes spreadsheet formula injection (CWE-1236).
 * Prepends a single quote `'` if the string begins with `=`, `+`, `-`, `@`, tab, or carriage return.
 */
export function sanitizeCsvValue(val: string): string {
  if (val.length === 0) {
    return val;
  }
  const firstChar = val[0];
  if ((FORMULA_INJECTION_PREFIXES as readonly string[]).includes(firstChar)) {
    return "'" + val;
  }
  const trimmed = val.trimStart();
  if (trimmed.length > 0 && (FORMULA_INJECTION_PREFIXES as readonly string[]).includes(trimmed[0])) {
    return "'" + val;
  }
  return val;
}

/**
 * Escapes a field according to RFC 4180.
 * If the field contains comma, quote, CR, or LF, wrap in quotes and double internal quotes.
 */
export function escapeCsvField(val: string | number | null | undefined): string {
  if (val === null || val === undefined) {
    return '';
  }
  let str = typeof val === 'number' ? String(val) : val;
  if (typeof val === 'string') {
    str = sanitizeCsvValue(str);
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Formats an array of fields as an RFC 4180 CSV row with \r\n line ending.
 */
export function formatCsvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(escapeCsvField).join(',') + '\r\n';
}

export interface GroupForExport {
  id: number;
  name: string;
  members: Member[];
}

/**
 * Formats a group's expenses into an RFC 4180 CSV export.
 * Row shape: One row per expense, with per-member split columns.
 * Ordering: Matches Task 5 (newest expense date first, broken by id DESC).
 */
export function formatGroupExpensesCsv(group: GroupForExport, expenses: Expense[]): string {
  const memberMap = new Map<number, string>();
  for (const m of group.members) {
    memberMap.set(m.id, m.name);
  }

  // Header row
  const headers: string[] = [
    'id',
    'date',
    'description',
    'paid_by',
    'payer_name',
    'amount_cents',
  ];

  for (const m of group.members) {
    headers.push(`split_${m.name}_cents`);
  }

  let csv = formatCsvRow(headers);

  // Data rows
  for (const exp of expenses) {
    const payerName = memberMap.get(exp.paid_by) ?? '';
    const splitMap = new Map<number, number>();
    for (const s of exp.splits) {
      splitMap.set(s.user_id, s.amount);
    }

    const row: (string | number)[] = [
      exp.id,
      exp.date,
      exp.description,
      exp.paid_by,
      payerName,
      exp.amount,
    ];

    for (const m of group.members) {
      const splitAmount = splitMap.get(m.id) ?? 0;
      row.push(splitAmount);
    }

    csv += formatCsvRow(row);
  }

  return csv;
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createApp } from '../src/app';
import { createDatabase } from '../src/db';
import { Member } from '../src/routes/groups';
import { sanitizeCsvValue, escapeCsvField, formatCsvRow } from '../src/csv';

/**
 * Deterministic RFC 4180 CSV parser for test verification.
 * Accurately parses fields with escaped double quotes, commas, CRLF and LF newlines.
 */
export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < csv.length) {
    const char = csv[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < csv.length && csv[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
        i++;
        continue;
      } else if (char === '\r') {
        if (i + 1 < csv.length && csv[i + 1] === '\n') {
          i++;
        }
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

describe('CSV Export - GET /groups/:id/export.csv', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createDatabase(':memory:');
    app = createApp(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('Pure helper unit tests (RFC 4180 & Formula Injection)', () => {
    it('neutralizes all formula injection prefixes (=, +, -, @, tab, CR)', () => {
      expect(sanitizeCsvValue("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
      expect(sanitizeCsvValue('+12345')).toBe("'+12345");
      expect(sanitizeCsvValue('-50')).toBe("'-50");
      expect(sanitizeCsvValue('@SUM(A1:B2)')).toBe("'@SUM(A1:B2)");
      expect(sanitizeCsvValue('\tmalicious')).toBe("'\tmalicious");
      expect(sanitizeCsvValue('\rmalicious')).toBe("'\rmalicious");
      expect(sanitizeCsvValue('   =trimmedFormula')).toBe("'   =trimmedFormula");
    });

    it('leaves safe values untouched', () => {
      expect(sanitizeCsvValue('Groceries')).toBe('Groceries');
      expect(sanitizeCsvValue('Lunch with Alice')).toBe('Lunch with Alice');
      expect(sanitizeCsvValue('')).toBe('');
    });

    it('escapes and quotes fields according to RFC 4180', () => {
      // Commas
      expect(escapeCsvField('hello, world')).toBe('"hello, world"');
      // Quotes doubled
      expect(escapeCsvField('say "hello"')).toBe('"say ""hello"""');
      // Literal newlines and carriage returns
      expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
      expect(escapeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"');
      expect(escapeCsvField('bare\rcarriage_return')).toBe('"bare\rcarriage_return"');
      // Combined quote + comma + newline
      expect(escapeCsvField('He said "hi", then left\nsecond line')).toBe(
        '"He said ""hi"", then left\nsecond line"'
      );
      // Formula prefix + special chars
      expect(escapeCsvField('=SUM(1, 2)')).toBe('"\'=SUM(1, 2)"');
      // Numbers remain unquoted strings
      expect(escapeCsvField(1234)).toBe('1234');
      expect(escapeCsvField(0)).toBe('0');
      // Null / undefined return empty string
      expect(escapeCsvField(null)).toBe('');
      expect(escapeCsvField(undefined)).toBe('');
    });

    it('formats full CSV rows with CRLF delimiter', () => {
      const row = formatCsvRow(['1', '2026-09-05', 'Dinner', 6000]);
      expect(row).toBe('1,2026-09-05,Dinner,6000\r\n');
    });
  });

  describe('RFC 4180 Quoting and Escaping via HTTP', () => {
    it('correctly quotes and escapes hostile description containing double quotes, commas, and literal newlines', async () => {
      const groupRes = await request(app)
        .post('/groups')
        .send({ name: 'Trip', members: ['Alice', 'Bob'] });
      const groupId = groupRes.body.id;
      const aliceId = (groupRes.body.members as Member[]).find((m) => m.name === 'Alice')!.id;

      const hostileDescription = 'He said "hi", then left\nsecond line';
      await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 5000,
          description: hostileDescription,
          paid_by: aliceId,
          date: '2026-09-05 12:00:00',
        });

      const res = await request(app).get(`/groups/${groupId}/export.csv`);
      expect(res.status).toBe(200);

      // Raw CSV verification: field must be quoted and internal double quotes doubled
      expect(res.text).toContain('"He said ""hi"", then left\nsecond line"');

      // Round-trip verification through RFC 4180 parser back to exact original string
      const parsed = parseCsv(res.text);
      expect(parsed.length).toBe(2);
      const descIndex = parsed[0].indexOf('description');
      expect(descIndex).toBeGreaterThanOrEqual(0);
      expect(parsed[1][descIndex]).toBe(hostileDescription);
    });

    it('correctly quotes description containing bare carriage return (CR without LF, comma, or quote) preventing row splitting', async () => {
      const groupRes = await request(app)
        .post('/groups')
        .send({ name: 'Trip', members: ['Alice', 'Bob'] });
      const groupId = groupRes.body.id;
      const aliceId = (groupRes.body.members as Member[]).find((m) => m.name === 'Alice')!.id;

      const bareCrDescription = 'mid\rCR';
      const postRes = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 500,
          description: bareCrDescription,
          paid_by: aliceId,
          date: '2026-09-06 09:58:57',
        });
      expect(postRes.status).toBe(201);

      const res = await request(app).get(`/groups/${groupId}/export.csv`);
      expect(res.status).toBe(200);

      // Raw CSV verification: field with bare \r must be quoted so it does not corrupt rows
      expect(res.text).toContain('"mid\rCR"');

      // Strict parse verification: exactly 2 rows (header + 1 expense), matching column widths
      const parsed = parseCsv(res.text);
      expect(parsed.length).toBe(2);
      expect(parsed[0].length).toBe(8); // id, date, description, paid_by, payer_name, amount_cents, split_Alice_cents, split_Bob_cents
      expect(parsed[1].length).toBe(parsed[0].length);
      const descIndex = parsed[0].indexOf('description');
      expect(descIndex).toBe(2);
      expect(parsed[1][descIndex]).toBe(bareCrDescription);
    });

    it('handles description containing commas and quotes without newlines', async () => {
      const groupRes = await request(app)
        .post('/groups')
        .send({ name: 'Trip', members: ['Alice', 'Bob'] });
      const groupId = groupRes.body.id;
      const aliceId = (groupRes.body.members as Member[]).find((m) => m.name === 'Alice')!.id;

      const description = 'Dinner, drinks, and "dessert"';
      await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 4000,
          description,
          paid_by: aliceId,
          date: '2026-09-05 12:00:00',
        });

      const res = await request(app).get(`/groups/${groupId}/export.csv`);
      expect(res.status).toBe(200);

      const parsed = parseCsv(res.text);
      const descIndex = parsed[0].indexOf('description');
      expect(parsed[1][descIndex]).toBe(description);
    });
  });

  describe('CSV Formula Injection Defense via HTTP', () => {
    it('defends against formula injection starting with "=" (=cmd|\'/c calc\'!A1)', async () => {
      const groupRes = await request(app)
        .post('/groups')
        .send({ name: 'Trip', members: ['Alice', 'Bob'] });
      const groupId = groupRes.body.id;
      const aliceId = (groupRes.body.members as Member[]).find((m) => m.name === 'Alice')!.id;

      const formulaDesc = "=cmd|'/c calc'!A1";
      await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 3000,
          description: formulaDesc,
          paid_by: aliceId,
          date: '2026-09-05 12:00:00',
        });

      const res = await request(app).get(`/groups/${groupId}/export.csv`);
      expect(res.status).toBe(200);

      // Must not come back as an active formula (must start with leading single quote)
      const parsed = parseCsv(res.text);
      const descIndex = parsed[0].indexOf('description');
      const cellValue = parsed[1][descIndex];

      expect(cellValue).toBe("'" + formulaDesc);
      expect(cellValue.startsWith('=')).toBe(false);
    });

    it('defends against formula injection prefixes (+, -, @, =)', async () => {
      const groupRes = await request(app)
        .post('/groups')
        .send({ name: 'Trip', members: ['Alice', 'Bob'] });
      const groupId = groupRes.body.id;
      const aliceId = (groupRes.body.members as Member[]).find((m) => m.name === 'Alice')!.id;

      const maliciousDescriptions = [
        '+1234567',
        '-5+5',
        '@SUM(A1:A10)',
        '=2+3',
      ];

      for (let i = 0; i < maliciousDescriptions.length; i++) {
        await request(app)
          .post(`/groups/${groupId}/expenses`)
          .send({
            amount: 1000 * (i + 1),
            description: maliciousDescriptions[i],
            paid_by: aliceId,
            date: `2026-09-05 12:00:0${i}`,
          });
      }

      const res = await request(app).get(`/groups/${groupId}/export.csv`);
      expect(res.status).toBe(200);

      const parsed = parseCsv(res.text);
      const descIndex = parsed[0].indexOf('description');

      // Check each data row
      const parsedDescriptions = parsed.slice(1).map((r) => r[descIndex]);
      for (const raw of maliciousDescriptions) {
        expect(parsedDescriptions).toContain("'" + raw);
      }
    });

    it('defends against tab or CR formula injection directly inserted into database', async () => {
      const groupRes = await request(app)
        .post('/groups')
        .send({ name: 'Trip', members: ['Alice', 'Bob'] });
      const groupId = groupRes.body.id;
      const aliceId = (groupRes.body.members as Member[]).find((m) => m.name === 'Alice')!.id;

      // Direct SQL insert bypassing endpoint trim() to test backend export defense on tab/CR
      const info = db.prepare(
        'INSERT INTO expenses (group_id, paid_by, amount, description, date) VALUES (?, ?, ?, ?, ?)'
      ).run(groupId, aliceId, 2500, '\t=cmd', '2026-09-05 12:00:00');
      const expId = Number(info.lastInsertRowid);
      db.prepare('INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (?, ?, ?)').run(
        expId,
        aliceId,
        2500
      );

      const res = await request(app).get(`/groups/${groupId}/export.csv`);
      expect(res.status).toBe(200);

      const parsed = parseCsv(res.text);
      const descIndex = parsed[0].indexOf('description');
      const cellValue = parsed[1][descIndex];

      expect(cellValue).toBe("'\t=cmd");
      expect(cellValue.startsWith('=')).toBe(false);
      expect(cellValue.startsWith('\t')).toBe(false);
    });
  });

  describe('HTTP Headers and Content Contract', () => {
    it('sets Content-Type to text/csv; charset=utf-8 and Content-Disposition attachment', async () => {
      const groupRes = await request(app)
        .post('/groups')
        .send({ name: 'Trip', members: ['Alice'] });
      const groupId = groupRes.body.id;

      const res = await request(app).get(`/groups/${groupId}/export.csv`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="group-${groupId}-expenses.csv"`);
    });
  });

  describe('Empty group export', () => {
    it('exports a header row and no data rows for an empty group', async () => {
      const groupRes = await request(app)
        .post('/groups')
        .send({ name: 'Empty Group', members: ['Alice', 'Bob'] });
      const groupId = groupRes.body.id;

      const res = await request(app).get(`/groups/${groupId}/export.csv`);
      expect(res.status).toBe(200);

      const parsed = parseCsv(res.text);
      expect(parsed.length).toBe(1); // Only the header row
      expect(parsed[0]).toEqual([
        'id',
        'date',
        'description',
        'paid_by',
        'payer_name',
        'amount_cents',
        'split_Alice_cents',
        'split_Bob_cents',
      ]);
    });
  });

  describe('Error Handling (Task 10 Contract)', () => {
    it('returns 404 for non-existent group ID', async () => {
      const res = await request(app).get('/groups/99999/export.csv');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Group not found' });
    });

    it('returns 400 for malformed group IDs', async () => {
      for (const badId of ['abc', '-1', '0', '01', '1.5', 'true', 'null']) {
        const res = await request(app).get(`/groups/${badId}/export.csv`);
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Invalid group ID: must be a positive integer' });
      }
    });
  });

  describe('Ordering and Split Calculations', () => {
    it('orders expenses newest expense date first (Task 5 ordering: date DESC, id DESC)', async () => {
      const groupRes = await request(app)
        .post('/groups')
        .send({ name: 'Trip', members: ['Alice', 'Bob'] });
      const groupId = groupRes.body.id;
      const aliceId = (groupRes.body.members as Member[]).find((m) => m.name === 'Alice')!.id;

      await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 1000,
          description: 'Older expense',
          paid_by: aliceId,
          date: '2026-09-01 10:00:00',
        });

      await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 2000,
          description: 'Newer expense',
          paid_by: aliceId,
          date: '2026-09-03 10:00:00',
        });

      await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 3000,
          description: 'Same date newer id',
          paid_by: aliceId,
          date: '2026-09-03 10:00:00',
        });

      const res = await request(app).get(`/groups/${groupId}/export.csv`);
      expect(res.status).toBe(200);

      const parsed = parseCsv(res.text);
      expect(parsed.length).toBe(4); // Header + 3 rows
      const descIndex = parsed[0].indexOf('description');
      expect(parsed[1][descIndex]).toBe('Same date newer id');
      expect(parsed[2][descIndex]).toBe('Newer expense');
      expect(parsed[3][descIndex]).toBe('Older expense');
    });

    it('preserves integer cents in amounts and splits with correct per-member columns', async () => {
      const groupRes = await request(app)
        .post('/groups')
        .send({ name: 'Trip', members: ['Alice', 'Bob', 'Charlie'] });
      const groupId = groupRes.body.id;
      const aliceId = (groupRes.body.members as Member[]).find((m) => m.name === 'Alice')!.id;

      // Add expense of 1000 cents split across 3 members: Alice 334, Bob 333, Charlie 333
      await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 1000,
          description: 'Lunch',
          paid_by: aliceId,
          date: '2026-09-05 12:00:00',
        });

      const res = await request(app).get(`/groups/${groupId}/export.csv`);
      expect(res.status).toBe(200);

      const parsed = parseCsv(res.text);
      expect(parsed.length).toBe(2);
      expect(parsed[0]).toEqual([
        'id',
        'date',
        'description',
        'paid_by',
        'payer_name',
        'amount_cents',
        'split_Alice_cents',
        'split_Bob_cents',
        'split_Charlie_cents',
      ]);

      const dataRow = parsed[1];
      expect(dataRow[0]).toMatch(/^\d+$/);
      expect(dataRow[1]).toBe('2026-09-05 12:00:00');
      expect(dataRow[2]).toBe('Lunch');
      expect(dataRow[3]).toBe(String(aliceId));
      expect(dataRow[4]).toBe('Alice');
      expect(dataRow[5]).toBe('1000');
      expect(dataRow[6]).toBe('334');
      expect(dataRow[7]).toBe('333');
      expect(dataRow[8]).toBe('333');
    });

    it('correctly handles unequal / custom splits where a member owes 0', async () => {
      const groupRes = await request(app)
        .post('/groups')
        .send({ name: 'Trip', members: ['Alice', 'Bob', 'Charlie'] });
      const groupId = groupRes.body.id;
      const aliceId = (groupRes.body.members as Member[]).find((m) => m.name === 'Alice')!.id;
      const bobId = (groupRes.body.members as Member[]).find((m) => m.name === 'Bob')!.id;

      // Subset split: only Alice and Bob
      await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 5000,
          description: 'Concert tickets',
          paid_by: aliceId,
          date: '2026-09-05 14:00:00',
          splits: [
            { user_id: aliceId, amount: 2500 },
            { user_id: bobId, amount: 2500 },
          ],
        });

      const res = await request(app).get(`/groups/${groupId}/export.csv`);
      expect(res.status).toBe(200);

      const parsed = parseCsv(res.text);
      expect(parsed.length).toBe(2);
      const row = parsed[1];
      expect(row[2]).toBe('Concert tickets');
      expect(row[5]).toBe('5000'); // amount_cents
      expect(row[6]).toBe('2500'); // split_Alice_cents
      expect(row[7]).toBe('2500'); // split_Bob_cents
      expect(row[8]).toBe('0'); // split_Charlie_cents (0 cents because not participating)
    });
  });
});

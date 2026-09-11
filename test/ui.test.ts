import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import { createApp } from '../src/app';
import { createDatabase } from '../src/db';
import Database from 'better-sqlite3';

interface MockResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

type FetchMock = (url: string, options?: RequestInit) => Promise<MockResponse>;

interface TallyAppExports {
  formatDate: (dateString: string) => string;
  formatCents: (cents: number) => string;
  showFeedback: (message: string, type: string, elementId?: string) => void;
  clearFeedback: (elementId?: string) => void;
  showExpenseFeedback: (message: string, type: string) => void;
  clearExpenseFeedback: () => void;
  renderGroups: (groups: unknown[]) => void;
  loadGroups: () => Promise<void>;
  handleCreateGroup: (e?: Event) => Promise<void>;
  renderExpenses: (expenses: unknown[]) => void;
  loadExpenses: (groupId: number | null) => Promise<void>;
  handleCreateExpense: (e?: Event | number, explicitGroupId?: number) => Promise<void>;
  selectGroup: (groupId: number) => void;
  initApp: () => void;
}

interface CustomWindow {
  fetch: FetchMock;
  TallyApp: TallyAppExports;
}

describe('Task 11: Group list/create Web UI', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
  });

  describe('Server-side HTTP serving & content negotiation', () => {
    it('GET / serves HTML index page when text/html is in Accept header', async () => {
      db = createDatabase(':memory:');
      const app = createApp(db);

      const res = await request(app)
        .get('/')
        .set('Accept', 'text/html,application/xhtml+xml');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('<title>Tally - Expense Splitter</title>');
      expect(res.text).toContain('id="create-group-form"');
      expect(res.text).toContain('id="group-name"');
      expect(res.text).toContain('id="group-members"');
      expect(res.text).toContain('id="create-group-btn"');
      expect(res.text).toContain('id="form-feedback"');
      expect(res.text).toContain('id="groups-section"');
      expect(res.text).toContain('id="groups-list"');
      expect(res.text).toContain('id="refresh-groups-btn"');

      // Task 12 elements
      expect(res.text).toContain('id="expenses-section"');
      expect(res.text).toContain('id="add-expense-form"');
      expect(res.text).toContain('id="expense-group"');
      expect(res.text).toContain('id="expense-description"');
      expect(res.text).toContain('id="expense-amount"');
      expect(res.text).toContain('id="expense-payer"');
      expect(res.text).toContain('id="expense-date"');
      expect(res.text).toContain('id="expense-feedback"');
      expect(res.text).toContain('id="add-expense-btn"');
      expect(res.text).toContain('id="refresh-expenses-btn"');
      expect(res.text).toContain('id="expenses-status-container"');
      expect(res.text).toContain('id="expenses-list"');
    });

    it('GET / serves JSON info when Accept header does not request HTML', async () => {
      db = createDatabase(':memory:');
      const app = createApp(db);

      const res = await request(app)
        .get('/')
        .set('Accept', 'application/json');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body).toEqual({
        name: 'tally',
        description: 'Expense-splitting web app',
        version: '0.1.0',
        status: 'ok',
      });
    });

    it('GET /style.css serves static CSS stylesheet', async () => {
      db = createDatabase(':memory:');
      const app = createApp(db);

      const res = await request(app).get('/style.css');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/css');
      expect(res.text).toContain('.app-container');
      expect(res.text).toContain('.group-card');
      expect(res.text).toContain('.member-badge');
      expect(res.text).toContain('.expense-card');
      expect(res.text).toContain('.expense-amount');
      expect(res.text).toContain('.expense-splits-container');
    });

    it('GET /app.js serves static client JavaScript', async () => {
      db = createDatabase(':memory:');
      const app = createApp(db);

      const res = await request(app).get('/app.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/javascript/);
      expect(res.text).toContain('handleCreateGroup');
      expect(res.text).toContain('loadGroups');
      expect(res.text).toContain('renderGroups');
      expect(res.text).toContain('handleCreateExpense');
      expect(res.text).toContain('loadExpenses');
      expect(res.text).toContain('renderExpenses');
      expect(res.text).toContain('formatCents');
    });

    it('preserves 404 JSON for unmatched non-static routes', async () => {
      db = createDatabase(':memory:');
      const app = createApp(db);

      const res = await request(app).get('/unknown-nonexistent-route');
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body).toEqual({ error: 'Not found' });
    });
  });

  describe('DOM security & code hygiene audit', () => {
    it('public/app.js strictly avoids innerHTML, outerHTML, and insertAdjacentHTML', () => {
      const appJsPath = path.resolve(__dirname, '../public/app.js');
      const content = fs.readFileSync(appJsPath, 'utf8');

      expect(content).not.toMatch(/\.(inner|outer)HTML\s*=/);
      expect(content).not.toContain('insertAdjacentHTML');
      expect(content).not.toContain('document.write');
      expect(content).toContain('document.createElement');
      expect(content).toContain('.textContent');
    });
  });

  describe('DOM behaviors & interactive client flows', () => {
    function setupDom(fetchMock: FetchMock) {
      const htmlPath = path.resolve(__dirname, '../public/index.html');
      const appJsPath = path.resolve(__dirname, '../public/app.js');
      const html = fs.readFileSync(htmlPath, 'utf8');
      const js = fs.readFileSync(appJsPath, 'utf8');

      const dom = new JSDOM(html, {
        runScripts: 'outside-only',
        url: 'http://localhost:3000/',
      });

      const { window } = dom;
      const customWindow = window as unknown as CustomWindow;
      customWindow.fetch = fetchMock;

      // Evaluate client script in DOM window context
      window.eval(js);

      return {
        dom,
        window,
        document: window.document,
        tallyApp: customWindow.TallyApp,
      };
    }

    it('renders list of groups with name, date, member count, and member badges', async () => {
      const groupsData = [
        {
          id: 1,
          name: 'Mountain Hike',
          created_at: '2026-09-05 10:00:00',
          members: [
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
          ],
        },
      ];

      const fetchMock: FetchMock = async (url: string) => {
        if (url === '/groups') {
          return {
            ok: true,
            status: 200,
            json: async () => groupsData,
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);
      await tallyApp.loadGroups();

      const groupsList = document.getElementById('groups-list')!;
      expect(groupsList.children.length).toBe(1);

      const card = groupsList.firstElementChild!;
      expect(card.getAttribute('data-group-id')).toBe('1');
      expect(card.querySelector('.group-name')!.textContent).toBe('Mountain Hike');
      expect(card.querySelector('.group-date')!.textContent).toContain('2026');
      expect(card.querySelector('.group-members-label')!.textContent).toBe('Members (2)');

      const badges = card.querySelectorAll('.member-badge');
      expect(badges.length).toBe(2);
      expect(badges[0].textContent).toBe('Alice');
      expect(badges[1].textContent).toBe('Bob');

      // Status container should be cleared of empty/loading messages
      const statusContainer = document.getElementById('groups-status-container')!;
      expect(statusContainer.children.length).toBe(0);
    });

    it('renders empty-groups state when no groups exist', async () => {
      const fetchMock: FetchMock = async (url: string) => {
        if (url === '/groups') {
          return {
            ok: true,
            status: 200,
            json: async () => [],
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);
      await tallyApp.loadGroups();

      const groupsList = document.getElementById('groups-list')!;
      expect(groupsList.children.length).toBe(0);

      const statusContainer = document.getElementById('groups-status-container')!;
      expect(statusContainer.children.length).toBe(1);

      const title = statusContainer.querySelector('.state-title')!;
      expect(title.textContent).toBe('No groups yet');

      const text = statusContainer.querySelector('.state-text')!;
      expect(text.textContent).toContain('Create your first expense group');
    });

    it('handles successful group creation: submits payload, displays feedback, resets form, and refreshes list', async () => {
      let created = false;
      let postPayload: { name?: string; members?: string[] } | null = null;

      const fetchMock: FetchMock = async (url: string, options?: RequestInit) => {
        if (url === '/groups' && options?.method === 'POST') {
          postPayload = JSON.parse(options.body as string);
          created = true;
          return {
            ok: true,
            status: 201,
            json: async () => ({
              id: 42,
              name: postPayload?.name,
              created_at: '2026-09-06 12:00:00',
              members: [
                { id: 1, name: 'Alice' },
                { id: 2, name: 'Charlie' },
              ],
            }),
          };
        }
        if (url === '/groups') {
          return {
            ok: true,
            status: 200,
            json: async () =>
              created
                ? [
                    {
                      id: 42,
                      name: 'Cabin Trip',
                      created_at: '2026-09-06 12:00:00',
                      members: [
                        { id: 1, name: 'Alice' },
                        { id: 2, name: 'Charlie' },
                      ],
                    },
                  ]
                : [],
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);

      const nameInput = document.getElementById('group-name') as HTMLInputElement;
      const membersInput = document.getElementById('group-members') as HTMLInputElement;
      const feedback = document.getElementById('form-feedback')!;

      nameInput.value = 'Cabin Trip';
      membersInput.value = 'Alice, Charlie';

      await tallyApp.handleCreateGroup();

      expect(postPayload).toEqual({
        name: 'Cabin Trip',
        members: ['Alice', 'Charlie'],
      });

      expect(feedback.textContent).toBe('Group "Cabin Trip" created successfully!');
      expect(feedback.className).toContain('feedback-message success');
      expect(feedback.className).not.toContain('hidden');

      // Form inputs should be cleared on reset
      expect(nameInput.value).toBe('');
      expect(membersInput.value).toBe('');

      // Groups list should have refreshed with the created group
      const groupsList = document.getElementById('groups-list')!;
      expect(groupsList.children.length).toBe(1);
      expect(groupsList.querySelector('.group-name')!.textContent).toBe('Cabin Trip');
    });

    it('surfaces server-rejected creation errors to the user (validation error: empty name)', async () => {
      const fetchMock: FetchMock = async (url: string, options?: RequestInit) => {
        if (url === '/groups' && options?.method === 'POST') {
          return {
            ok: false,
            status: 400,
            json: async () => ({ error: 'Group name cannot be empty' }),
          };
        }
        if (url === '/groups') {
          return { ok: true, status: 200, json: async () => [] };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);

      const nameInput = document.getElementById('group-name') as HTMLInputElement;
      const membersInput = document.getElementById('group-members') as HTMLInputElement;
      const feedback = document.getElementById('form-feedback')!;

      nameInput.value = '   ';
      membersInput.value = 'Alice';

      await tallyApp.handleCreateGroup();

      expect(feedback.textContent).toBe('Group name cannot be empty');
      expect(feedback.className).toContain('feedback-message error');
      expect(feedback.className).not.toContain('hidden');
    });

    it('surfaces server-rejected creation errors to the user (validation error: duplicate member)', async () => {
      const fetchMock: FetchMock = async (url: string, options?: RequestInit) => {
        if (url === '/groups' && options?.method === 'POST') {
          return {
            ok: false,
            status: 400,
            json: async () => ({ error: 'Duplicate member in request: Alice' }),
          };
        }
        if (url === '/groups') {
          return { ok: true, status: 200, json: async () => [] };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);

      const nameInput = document.getElementById('group-name') as HTMLInputElement;
      const membersInput = document.getElementById('group-members') as HTMLInputElement;
      const feedback = document.getElementById('form-feedback')!;

      nameInput.value = 'Dinner Party';
      membersInput.value = 'Alice, Bob, Alice';

      await tallyApp.handleCreateGroup();

      expect(feedback.textContent).toBe('Duplicate member in request: Alice');
      expect(feedback.className).toContain('feedback-message error');
      expect(feedback.className).not.toContain('hidden');
    });

    it('surfaces server-rejected creation errors to the user (500 internal server error sanitization)', async () => {
      const fetchMock: FetchMock = async (url: string, options?: RequestInit) => {
        if (url === '/groups' && options?.method === 'POST') {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 'Internal server error' }),
          };
        }
        if (url === '/groups') {
          return { ok: true, status: 200, json: async () => [] };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);

      const nameInput = document.getElementById('group-name') as HTMLInputElement;
      const membersInput = document.getElementById('group-members') as HTMLInputElement;
      const feedback = document.getElementById('form-feedback')!;

      nameInput.value = 'Error Group';
      membersInput.value = 'Alice';

      await tallyApp.handleCreateGroup();

      expect(feedback.textContent).toBe('Server error occurred. Please try again later.');
      expect(feedback.className).toContain('feedback-message error');
      expect(feedback.className).not.toContain('hidden');
    });

    it('surfaces server load error when GET /groups fails', async () => {
      const fetchMock: FetchMock = async (url: string) => {
        if (url === '/groups') {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 'Internal server error' }),
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);
      await tallyApp.loadGroups();

      const statusContainer = document.getElementById('groups-status-container')!;
      expect(statusContainer.querySelector('.state-title')!.textContent).toBe('Unable to load groups');
      expect(statusContainer.querySelector('.state-text')!.textContent).toContain('Server error occurred');
    });

    it('XSS-escaping: renders group and member names with hostile markup as literal text, never HTML elements', async () => {
      const hostileGroupName = '<img src=x onerror=alert(1)>';
      const hostileMemberName = '<script>alert("xss")</script>';

      const groupsData = [
        {
          id: 99,
          name: hostileGroupName,
          created_at: '2026-09-05 18:00:00',
          members: [
            { id: 1, name: hostileMemberName },
          ],
        },
      ];

      const fetchMock: FetchMock = async (url: string) => {
        if (url === '/groups') {
          return {
            ok: true,
            status: 200,
            json: async () => groupsData,
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);
      await tallyApp.loadGroups();

      const groupsList = document.getElementById('groups-list')!;
      const nameEl = groupsList.querySelector('.group-name')!;
      const badgeEl = groupsList.querySelector('.member-badge')!;

      // 1. Must render as literal text
      expect(nameEl.textContent).toBe(hostileGroupName);
      expect(badgeEl.textContent).toBe(hostileMemberName);

      // 2. Must not create <img> or <script> element nodes in the DOM
      expect(nameEl.querySelector('img')).toBeNull();
      expect(nameEl.querySelector('script')).toBeNull();
      expect(groupsList.querySelector('img')).toBeNull();
      expect(groupsList.querySelector('script')).toBeNull();
      expect(document.querySelector('img')).toBeNull();

      // 3. Child nodes must be text nodes only
      expect(nameEl.children.length).toBe(0);
      expect(nameEl.childNodes.length).toBe(1);
      expect(nameEl.childNodes[0].nodeType).toBe(3); // Node.TEXT_NODE

      expect(badgeEl.children.length).toBe(0);
      expect(badgeEl.childNodes.length).toBe(1);
      expect(badgeEl.childNodes[0].nodeType).toBe(3); // Node.TEXT_NODE

      // 4. In innerHTML serialization, special characters are entity-escaped
      expect(nameEl.innerHTML).toBe('&lt;img src=x onerror=alert(1)&gt;');
      expect(badgeEl.innerHTML).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
    });
  });

  describe('Task 12: Expense list and add-expense form UI', () => {
    function setupDom(fetchMock: FetchMock) {
      const htmlPath = path.resolve(__dirname, '../public/index.html');
      const appJsPath = path.resolve(__dirname, '../public/app.js');
      const html = fs.readFileSync(htmlPath, 'utf8');
      const js = fs.readFileSync(appJsPath, 'utf8');

      const dom = new JSDOM(html, {
        runScripts: 'outside-only',
        url: 'http://localhost:3000/',
      });

      const { window } = dom;
      const customWindow = window as unknown as CustomWindow;
      customWindow.fetch = fetchMock;

      window.eval(js);

      return {
        dom,
        window,
        document: window.document,
        tallyApp: customWindow.TallyApp,
      };
    }

    it('renders list of expenses with description, formatted amount, payer, date, and split breakdown', async () => {
      const expensesData = [
        {
          id: 1,
          group_id: 10,
          paid_by: 1,
          amount: 4500,
          description: 'Dinner at Bistro',
          date: '2026-09-06 19:30:00',
          created_at: '2026-09-06 19:30:00',
          splits: [
            {
              id: 1,
              expense_id: 1,
              user_id: 1,
              user_name: 'Alice',
              amount: 2250,
              created_at: '2026-09-06 19:30:00',
            },
            {
              id: 2,
              expense_id: 1,
              user_id: 2,
              user_name: 'Bob',
              amount: 2250,
              created_at: '2026-09-06 19:30:00',
            },
          ],
        },
      ];

      const fetchMock: FetchMock = async (url: string) => {
        if (url === '/groups/10/expenses') {
          return {
            ok: true,
            status: 200,
            json: async () => expensesData,
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);
      await tallyApp.loadExpenses(10);

      const expensesList = document.getElementById('expenses-list')!;
      expect(expensesList.children.length).toBe(1);

      const card = expensesList.firstElementChild!;
      expect(card.getAttribute('data-expense-id')).toBe('1');
      expect(card.getAttribute('data-amount')).toBe('4500');
      expect(card.querySelector('.expense-description')!.textContent).toBe('Dinner at Bistro');
      expect(card.querySelector('.expense-amount')!.textContent).toBe('$45.00');
      expect(card.querySelector('.expense-payer')!.textContent).toBe('Paid by Alice');
      expect(card.querySelector('.expense-date')!.textContent).toContain('2026');

      const splitLabel = card.querySelector('.expense-splits-label')!;
      expect(splitLabel.textContent).toBe('Splits (2)');

      const splitBadges = card.querySelectorAll('.member-badge');
      expect(splitBadges.length).toBe(2);
      expect(splitBadges[0].textContent).toBe('Alice: $22.50');
      expect(splitBadges[1].textContent).toBe('Bob: $22.50');

      const statusContainer = document.getElementById('expenses-status-container')!;
      expect(statusContainer.children.length).toBe(0);
    });

    it('renders empty-expenses state when no expenses exist for a group', async () => {
      const fetchMock: FetchMock = async (url: string) => {
        if (url === '/groups/10/expenses') {
          return {
            ok: true,
            status: 200,
            json: async () => [],
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);
      await tallyApp.loadExpenses(10);

      const expensesList = document.getElementById('expenses-list')!;
      expect(expensesList.children.length).toBe(0);

      const statusContainer = document.getElementById('expenses-status-container')!;
      expect(statusContainer.children.length).toBe(1);
      expect(statusContainer.querySelector('.state-title')!.textContent).toBe('No expenses yet');
      expect(statusContainer.querySelector('.state-text')!.textContent).toContain('Add your first expense');
    });

    it('renders "No group selected" state when groupId is null', async () => {
      const fetchMock: FetchMock = async (url: string) => {
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);
      await tallyApp.loadExpenses(null);

      const expensesList = document.getElementById('expenses-list')!;
      expect(expensesList.children.length).toBe(0);

      const statusContainer = document.getElementById('expenses-status-container')!;
      expect(statusContainer.querySelector('.state-title')!.textContent).toBe('No group selected');
    });

    it('handles successful expense creation: submits payload, displays feedback, resets inputs, and refreshes list', async () => {
      let created = false;
      let postPayload: { description?: string; amount?: number; paid_by?: unknown; date?: string } | null = null;

      const fetchMock: FetchMock = async (url: string, options?: RequestInit) => {
        if (url === '/groups/10/expenses' && options?.method === 'POST') {
          postPayload = JSON.parse(options.body as string);
          created = true;
          return {
            ok: true,
            status: 201,
            json: async () => ({
              id: 101,
              group_id: 10,
              amount: postPayload?.amount,
              description: postPayload?.description,
              paid_by: 1,
              date: '2026-09-06 14:00:00',
              created_at: '2026-09-06 14:00:00',
              splits: [
                { id: 1, expense_id: 101, user_id: 1, user_name: 'Alice', amount: 1500, created_at: '...' },
                { id: 2, expense_id: 101, user_id: 2, user_name: 'Bob', amount: 1500, created_at: '...' },
              ],
            }),
          };
        }
        if (url === '/groups/10/expenses') {
          return {
            ok: true,
            status: 200,
            json: async () =>
              created
                ? [
                    {
                      id: 101,
                      group_id: 10,
                      amount: 3000,
                      description: 'Groceries',
                      paid_by: 1,
                      date: '2026-09-06 14:00:00',
                      created_at: '2026-09-06 14:00:00',
                      splits: [
                        { id: 1, expense_id: 101, user_id: 1, user_name: 'Alice', amount: 1500, created_at: '...' },
                        { id: 2, expense_id: 101, user_id: 2, user_name: 'Bob', amount: 1500, created_at: '...' },
                      ],
                    },
                  ]
                : [],
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);

      const groupSelect = document.getElementById('expense-group') as HTMLSelectElement;
      const descInput = document.getElementById('expense-description') as HTMLInputElement;
      const amountInput = document.getElementById('expense-amount') as HTMLInputElement;
      const payerInput = document.getElementById('expense-payer') as HTMLInputElement;
      const dateInput = document.getElementById('expense-date') as HTMLInputElement;
      const feedback = document.getElementById('expense-feedback')!;

      // Add group option and select it
      const opt = document.createElement('option');
      opt.value = '10';
      opt.textContent = 'Ski Trip';
      opt.selected = true;
      groupSelect.appendChild(opt);

      descInput.value = 'Groceries';
      amountInput.value = '3000';
      payerInput.value = 'Alice';
      dateInput.value = '2026-09-06 14:00:00';

      await tallyApp.handleCreateExpense();

      expect(postPayload).toEqual({
        description: 'Groceries',
        amount: 3000,
        paid_by: 'Alice',
        date: '2026-09-06 14:00:00',
      });

      expect(feedback.textContent).toBe('Expense "Groceries" added successfully!');
      expect(feedback.className).toContain('feedback-message success');
      expect(feedback.className).not.toContain('hidden');

      // Inputs reset, but selected group preserved
      expect(descInput.value).toBe('');
      expect(amountInput.value).toBe('');
      expect(payerInput.value).toBe('');
      expect(dateInput.value).toBe('');
      expect(groupSelect.value).toBe('10');

      // Expenses list refreshed
      const expensesList = document.getElementById('expenses-list')!;
      expect(expensesList.children.length).toBe(1);
      expect(expensesList.querySelector('.expense-description')!.textContent).toBe('Groceries');
      expect(expensesList.querySelector('.expense-amount')!.textContent).toBe('$30.00');
    });

    it('submits numeric payer ID when user supplies a positive integer', async () => {
      let postPayload: { paid_by?: unknown } | null = null;

      const fetchMock: FetchMock = async (url: string, options?: RequestInit) => {
        if (url === '/groups/10/expenses' && options?.method === 'POST') {
          postPayload = JSON.parse(options.body as string);
          return {
            ok: true,
            status: 201,
            json: async () => ({
              id: 1,
              group_id: 10,
              amount: 1000,
              description: 'Snack',
              paid_by: 2,
              date: '2026-09-06 12:00:00',
              created_at: '2026-09-06 12:00:00',
              splits: [],
            }),
          };
        }
        if (url === '/groups/10/expenses') {
          return { ok: true, status: 200, json: async () => [] };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);

      const groupSelect = document.getElementById('expense-group') as HTMLSelectElement;
      const amountInput = document.getElementById('expense-amount') as HTMLInputElement;
      const payerInput = document.getElementById('expense-payer') as HTMLInputElement;

      const opt = document.createElement('option');
      opt.value = '10';
      opt.selected = true;
      groupSelect.appendChild(opt);

      amountInput.value = '1000';
      payerInput.value = '2';

      await tallyApp.handleCreateExpense();

      expect(postPayload).not.toBeNull();
      expect((postPayload as { paid_by?: unknown } | null)?.paid_by).toBe(2);
    });

    it('submits payer as string when the typed value matches a member name that is all digits (e.g. "42")', async () => {
      let postPayload: { paid_by?: unknown } | null = null;

      const fetchMock: FetchMock = async (url: string, options?: RequestInit) => {
        if (url === '/groups/2/expenses' && options?.method === 'POST') {
          postPayload = JSON.parse(options.body as string);
          return {
            ok: true,
            status: 201,
            json: async () => ({
              id: 1,
              group_id: 2,
              amount: 1500,
              description: 'Coffee',
              paid_by: 3,
              date: '2026-09-06 12:00:00',
              created_at: '2026-09-06 12:00:00',
              splits: [
                {
                  id: 1,
                  expense_id: 1,
                  user_id: 3,
                  user_name: '42',
                  amount: 750,
                  created_at: '2026-09-06 12:00:00',
                },
                {
                  id: 2,
                  expense_id: 1,
                  user_id: 4,
                  user_name: 'Zoe',
                  amount: 750,
                  created_at: '2026-09-06 12:00:00',
                },
              ],
            }),
          };
        }
        if (url === '/groups/2/expenses') {
          return { ok: true, status: 200, json: async () => [] };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);

      tallyApp.renderGroups([
        {
          id: 2,
          name: 'Numeric names',
          created_at: '2026-09-06 10:00:00',
          members: [
            { id: 3, name: '42' },
            { id: 4, name: 'Zoe' },
          ],
        },
      ]);

      tallyApp.selectGroup(2);

      const amountInput = document.getElementById('expense-amount') as HTMLInputElement;
      const payerInput = document.getElementById('expense-payer') as HTMLInputElement;

      amountInput.value = '1500';
      payerInput.value = '42';

      await tallyApp.handleCreateExpense();

      expect(postPayload).not.toBeNull();
      expect((postPayload as { paid_by?: unknown } | null)?.paid_by).toBe('42');
    });

    it('formatCents formats positive, zero, and negative amounts with proper sign placement', () => {
      const { tallyApp } = setupDom(async () => ({ ok: true, status: 200, json: async () => [] }));
      expect(tallyApp.formatCents(2500)).toBe('$25.00');
      expect(tallyApp.formatCents(999)).toBe('$9.99');
      expect(tallyApp.formatCents(0)).toBe('$0.00');
      expect(tallyApp.formatCents(-250)).toBe('-$2.50');
      expect(tallyApp.formatCents(-5)).toBe('-$0.05');
    });

    it('submits non-numeric amount as-is so server returns validation error rather than missing amount', async () => {
      let postPayload: { amount?: unknown } | null = null;

      const fetchMock: FetchMock = async (url: string, options?: RequestInit) => {
        if (url === '/groups/10/expenses' && options?.method === 'POST') {
          postPayload = JSON.parse(options.body as string);
          return {
            ok: false,
            status: 400,
            json: async () => ({ error: 'Amount must be a positive integer in cents' }),
          };
        }
        if (url === '/groups/10/expenses') {
          return { ok: true, status: 200, json: async () => [] };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);

      const groupSelect = document.getElementById('expense-group') as HTMLSelectElement;
      const amountInput = document.getElementById('expense-amount') as HTMLInputElement;
      const feedback = document.getElementById('expense-feedback')!;

      const opt = document.createElement('option');
      opt.value = '10';
      opt.selected = true;
      groupSelect.appendChild(opt);

      amountInput.type = 'text';
      amountInput.value = 'abc';

      await tallyApp.handleCreateExpense();

      expect(postPayload).toEqual({ amount: 'abc' });
      expect(feedback.textContent).toBe('Amount must be a positive integer in cents');
      expect(feedback.className).toContain('feedback-message error');
    });

    it('surfaces server-rejected expense creation errors (validation: amount required)', async () => {
      const fetchMock: FetchMock = async (url: string, options?: RequestInit) => {
        if (url === '/groups/10/expenses' && options?.method === 'POST') {
          return {
            ok: false,
            status: 400,
            json: async () => ({ error: 'Amount is required' }),
          };
        }
        if (url === '/groups/10/expenses') {
          return { ok: true, status: 200, json: async () => [] };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);

      const groupSelect = document.getElementById('expense-group') as HTMLSelectElement;
      const payerInput = document.getElementById('expense-payer') as HTMLInputElement;
      const feedback = document.getElementById('expense-feedback')!;

      const opt = document.createElement('option');
      opt.value = '10';
      opt.selected = true;
      groupSelect.appendChild(opt);

      payerInput.value = 'Alice';

      await tallyApp.handleCreateExpense();

      expect(feedback.textContent).toBe('Amount is required');
      expect(feedback.className).toContain('feedback-message error');
      expect(feedback.className).not.toContain('hidden');
    });

    it('surfaces server-rejected expense creation errors (validation: payer must be a member)', async () => {
      const fetchMock: FetchMock = async (url: string, options?: RequestInit) => {
        if (url === '/groups/10/expenses' && options?.method === 'POST') {
          return {
            ok: false,
            status: 400,
            json: async () => ({ error: 'Payer must be a member of the group' }),
          };
        }
        if (url === '/groups/10/expenses') {
          return { ok: true, status: 200, json: async () => [] };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);

      const groupSelect = document.getElementById('expense-group') as HTMLSelectElement;
      const amountInput = document.getElementById('expense-amount') as HTMLInputElement;
      const payerInput = document.getElementById('expense-payer') as HTMLInputElement;
      const feedback = document.getElementById('expense-feedback')!;

      const opt = document.createElement('option');
      opt.value = '10';
      opt.selected = true;
      groupSelect.appendChild(opt);

      amountInput.value = '2500';
      payerInput.value = 'NonMember';

      await tallyApp.handleCreateExpense();

      expect(feedback.textContent).toBe('Payer must be a member of the group');
      expect(feedback.className).toContain('feedback-message error');
    });

    it('surfaces server-rejected expense creation errors (500 internal server error sanitization)', async () => {
      const fetchMock: FetchMock = async (url: string, options?: RequestInit) => {
        if (url === '/groups/10/expenses' && options?.method === 'POST') {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 'Internal server error' }),
          };
        }
        if (url === '/groups/10/expenses') {
          return { ok: true, status: 200, json: async () => [] };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);

      const groupSelect = document.getElementById('expense-group') as HTMLSelectElement;
      const amountInput = document.getElementById('expense-amount') as HTMLInputElement;
      const payerInput = document.getElementById('expense-payer') as HTMLInputElement;
      const feedback = document.getElementById('expense-feedback')!;

      const opt = document.createElement('option');
      opt.value = '10';
      opt.selected = true;
      groupSelect.appendChild(opt);

      amountInput.value = '1000';
      payerInput.value = 'Alice';

      await tallyApp.handleCreateExpense();

      expect(feedback.textContent).toBe('Server error occurred. Please try again later.');
      expect(feedback.className).toContain('feedback-message error');
    });

    it('surfaces error when loading expenses fails', async () => {
      const fetchMock: FetchMock = async (url: string) => {
        if (url === '/groups/10/expenses') {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 'Internal server error' }),
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);
      await tallyApp.loadExpenses(10);

      const statusContainer = document.getElementById('expenses-status-container')!;
      expect(statusContainer.querySelector('.state-title')!.textContent).toBe('Unable to load expenses');
      expect(statusContainer.querySelector('.state-text')!.textContent).toContain('Server error occurred');
    });

    it('XSS-escaping: renders hostile expense descriptions and participant names as literal text with zero injected elements', async () => {
      const hostileDescription = '<img src=x onerror=alert(1)>';
      const hostilePayerName = '<script>alert("xss")</script>';
      const hostileSplitName = '<svg onload=alert(2)>';

      const expensesData = [
        {
          id: 99,
          group_id: 10,
          paid_by: 1,
          amount: 5000,
          description: hostileDescription,
          date: '2026-09-06 18:00:00',
          created_at: '2026-09-06 18:00:00',
          splits: [
            {
              id: 1,
              expense_id: 99,
              user_id: 1,
              user_name: hostilePayerName,
              amount: 2500,
              created_at: '2026-09-06 18:00:00',
            },
            {
              id: 2,
              expense_id: 99,
              user_id: 2,
              user_name: hostileSplitName,
              amount: 2500,
              created_at: '2026-09-06 18:00:00',
            },
          ],
        },
      ];

      const fetchMock: FetchMock = async (url: string) => {
        if (url === '/groups/10/expenses') {
          return {
            ok: true,
            status: 200,
            json: async () => expensesData,
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);
      await tallyApp.loadExpenses(10);

      const expensesList = document.getElementById('expenses-list')!;
      const descEl = expensesList.querySelector('.expense-description')!;
      const payerEl = expensesList.querySelector('.expense-payer')!;
      const splitBadges = expensesList.querySelectorAll('.member-badge');

      // 1. TextContent must match raw hostile strings byte-for-byte
      expect(descEl.textContent).toBe(hostileDescription);
      expect(payerEl.textContent).toBe('Paid by ' + hostilePayerName);
      expect(splitBadges[0].textContent).toContain(hostilePayerName);
      expect(splitBadges[1].textContent).toContain(hostileSplitName);

      // 2. Zero injected elements anywhere in DOM
      expect(descEl.querySelector('img')).toBeNull();
      expect(descEl.querySelector('script')).toBeNull();
      expect(descEl.querySelector('svg')).toBeNull();
      expect(payerEl.querySelector('img')).toBeNull();
      expect(payerEl.querySelector('script')).toBeNull();
      expect(payerEl.querySelector('svg')).toBeNull();
      expect(splitBadges[0].querySelector('script')).toBeNull();
      expect(splitBadges[1].querySelector('svg')).toBeNull();
      expect(expensesList.querySelector('img')).toBeNull();
      expect(expensesList.querySelector('script')).toBeNull();
      expect(expensesList.querySelector('svg')).toBeNull();
      expect(document.querySelector('img')).toBeNull();
      expect(document.querySelector('svg')).toBeNull();
      const scripts = document.querySelectorAll('script');
      expect(scripts.length).toBe(1);
      expect(scripts[0].getAttribute('src')).toBe('/app.js');

      // 3. Child nodes must be text nodes only
      expect(descEl.children.length).toBe(0);
      expect(descEl.childNodes.length).toBe(1);
      expect(descEl.childNodes[0].nodeType).toBe(3); // Node.TEXT_NODE

      // 4. In innerHTML serialization, special characters are entity-escaped
      expect(descEl.innerHTML).toBe('&lt;img src=x onerror=alert(1)&gt;');
      expect(payerEl.innerHTML).toContain('&lt;script&gt;alert("xss")&lt;/script&gt;');
    });

    it('renders expenses in newest expense date first order (date DESC)', async () => {
      const expensesData = [
        {
          id: 2,
          group_id: 10,
          paid_by: 1,
          amount: 2000,
          description: 'Newer expense',
          date: '2026-09-06 20:00:00',
          created_at: '2026-09-06 20:00:00',
          splits: [],
        },
        {
          id: 1,
          group_id: 10,
          paid_by: 1,
          amount: 1000,
          description: 'Older expense',
          date: '2026-09-06 10:00:00',
          created_at: '2026-09-06 10:00:00',
          splits: [],
        },
      ];

      const fetchMock: FetchMock = async (url: string) => {
        if (url === '/groups/10/expenses') {
          return {
            ok: true,
            status: 200,
            json: async () => expensesData,
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);
      await tallyApp.loadExpenses(10);

      const expensesList = document.getElementById('expenses-list')!;
      expect(expensesList.children.length).toBe(2);

      const firstCard = expensesList.children[0];
      const secondCard = expensesList.children[1];

      expect(firstCard.querySelector('.expense-description')!.textContent).toBe('Newer expense');
      expect(secondCard.querySelector('.expense-description')!.textContent).toBe('Older expense');
    });

    it('selecting a group updates dropdown, highlights card, and loads expenses', async () => {
      const groupsData = [
        {
          id: 10,
          name: 'Beach Trip',
          created_at: '2026-09-05 10:00:00',
          members: [{ id: 1, name: 'Alice' }],
        },
      ];

      let loadedExpensesGroupId: number | null = null;

      const fetchMock: FetchMock = async (url: string) => {
        if (url === '/groups') {
          return { ok: true, status: 200, json: async () => groupsData };
        }
        if (url === '/groups/10/expenses') {
          loadedExpensesGroupId = 10;
          return { ok: true, status: 200, json: async () => [] };
        }
        throw new Error(`Unexpected url: ${url}`);
      };

      const { document, tallyApp } = setupDom(fetchMock);
      await tallyApp.loadGroups();

      const groupCard = document.querySelector('.group-card')!;
      const viewBtn = groupCard.querySelector('.select-group-btn') as HTMLButtonElement;
      const groupSelect = document.getElementById('expense-group') as HTMLSelectElement;

      expect(groupSelect.options.length).toBe(2); // placeholder + group 10
      expect(groupSelect.value).toBe('');

      viewBtn.click();

      expect(groupCard.classList.contains('active')).toBe(true);
      expect(groupSelect.value).toBe('10');
      expect(loadedExpensesGroupId).toBe(10);
    });
  });

  describe('End-to-end integration with Express backend', () => {
    it('supports full group creation and listing flow across backend and client contract', async () => {
      db = createDatabase(':memory:');
      const app = createApp(db);

      // 1. Initially empty groups list
      const initialGetRes = await request(app).get('/groups');
      expect(initialGetRes.status).toBe(200);
      expect(initialGetRes.body).toEqual([]);

      // 2. Create group with payload matching client form
      const postRes = await request(app)
        .post('/groups')
        .send({
          name: 'Ski Weekend',
          members: ['Alice', 'Bob'],
        });
      expect(postRes.status).toBe(201);
      expect(postRes.body.name).toBe('Ski Weekend');
      expect(postRes.body.members).toHaveLength(2);
      expect(postRes.body.members[0].name).toBe('Alice');
      expect(postRes.body.members[1].name).toBe('Bob');

      // 3. List groups after creation
      const afterGetRes = await request(app).get('/groups');
      expect(afterGetRes.status).toBe(200);
      expect(afterGetRes.body).toHaveLength(1);
      expect(afterGetRes.body[0].name).toBe('Ski Weekend');
      expect(afterGetRes.body[0].members).toHaveLength(2);

      // 4. Validate that creating with empty name is rejected with 400
      const invalidRes = await request(app)
        .post('/groups')
        .send({
          name: '',
          members: ['Charlie'],
        });
      expect(invalidRes.status).toBe(400);
      expect(invalidRes.body).toEqual({ error: 'Group name cannot be empty' });
    });

    it('supports full group creation, expense addition, and expense listing flow', async () => {
      db = createDatabase(':memory:');
      const app = createApp(db);

      // 1. Create a group with 2 members
      const groupRes = await request(app)
        .post('/groups')
        .send({
          name: 'Weekend Getaway',
          members: ['Alice', 'Bob'],
        });
      expect(groupRes.status).toBe(201);
      const groupId = groupRes.body.id;
      const aliceId = groupRes.body.members[0].id;

      // 2. Initially empty expenses for the group
      const initialExpensesRes = await request(app).get(`/groups/${groupId}/expenses`);
      expect(initialExpensesRes.status).toBe(200);
      expect(initialExpensesRes.body).toEqual([]);

      // 3. Add expense with equal split (Task 4)
      const expense1Res = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 5000,
          description: 'Cabin Rental',
          paid_by: 'Alice',
          date: '2026-09-06 10:00:00',
        });
      expect(expense1Res.status).toBe(201);
      expect(expense1Res.body.amount).toBe(5000);
      expect(expense1Res.body.description).toBe('Cabin Rental');
      expect(expense1Res.body.splits).toHaveLength(2);
      expect(expense1Res.body.splits[0].amount).toBe(2500);
      expect(expense1Res.body.splits[1].amount).toBe(2500);

      // 4. Add second expense with newer timestamp
      const expense2Res = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 2000,
          description: 'Groceries',
          paid_by: aliceId,
          date: '2026-09-06 14:00:00',
        });
      expect(expense2Res.status).toBe(201);

      // 5. List expenses (Task 5, newest first)
      const listRes = await request(app).get(`/groups/${groupId}/expenses`);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(2);
      expect(listRes.body[0].description).toBe('Groceries');
      expect(listRes.body[1].description).toBe('Cabin Rental');

      // 6. Validation error check on POST /groups/:id/expenses
      const invalidAmountRes = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          description: 'Invalid',
          paid_by: 'Alice',
        });
      expect(invalidAmountRes.status).toBe(400);
      expect(invalidAmountRes.body).toEqual({ error: 'Amount is required' });

      const invalidPayerRes = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 1000,
          paid_by: 'NonMember',
        });
      expect(invalidPayerRes.status).toBe(400);
      expect(invalidPayerRes.body).toEqual({ error: 'Payer must be a member of the group' });
    });

    it('allows paying an expense by a member whose name is all digits ("42")', async () => {
      db = createDatabase(':memory:');
      const app = createApp(db);

      // 1. Create a group with a member named '42'
      const groupRes = await request(app)
        .post('/groups')
        .send({
          name: 'Numeric names',
          members: ['42', 'Zoe'],
        });
      expect(groupRes.status).toBe(201);
      const groupId = groupRes.body.id;
      const member42 = groupRes.body.members.find((m: { name: string }) => m.name === '42');
      expect(member42).toBeDefined();

      // 2. Fetch groups as client loadGroups would
      const groupsRes = await request(app).get('/groups');
      expect(groupsRes.status).toBe(200);

      // 3. Post expense with paid_by: '42' (as resolved name-first by handleCreateExpense)
      const expenseRes = await request(app)
        .post(`/groups/${groupId}/expenses`)
        .send({
          amount: 2500,
          description: 'Lunch',
          paid_by: '42',
        });
      expect(expenseRes.status).toBe(201);
      expect(expenseRes.body.paid_by).toBe(member42.id);
      expect(expenseRes.body.splits[0].user_name).toBe('42');

      // 4. Retrieve expenses list
      const listRes = await request(app).get(`/groups/${groupId}/expenses`);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].description).toBe('Lunch');
      expect(listRes.body[0].paid_by).toBe(member42.id);
    });
  });
});

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
  showFeedback: (message: string, type: string) => void;
  clearFeedback: () => void;
  renderGroups: (groups: unknown[]) => void;
  loadGroups: () => Promise<void>;
  handleCreateGroup: (e?: Event) => Promise<void>;
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
  });
});

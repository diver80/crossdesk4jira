# Cross-Site Work Items Dashboard Gadget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Atlassian Forge Jira Cloud Dashboard Gadget (Custom UI) that aggregates and displays Jira issues across multiple Atlassian Cloud sites and accounts using OAuth 2.0 (3LO) External Authentication with isolated per-gadget configuration.

**Architecture:** A unified TypeScript project with an Atlassian Forge NodeJS backend resolver (`src/`) communicating with `api.atlassian.com` and `auth.atlassian.com` via `providers.auth`, and a React 18 Custom UI frontend (`static/gadget/`) built with Vite and Atlassian Design System (`@atlaskit/*`), routed conditionally between view and edit modes.

**Tech Stack:** Atlassian Forge CLI, NodeJS 22.x, React 18, Vite, TypeScript, `@forge/api`, `@forge/resolver`, `@forge/bridge`, `@atlaskit/lozenge`, `@atlaskit/spinner`, `@atlaskit/tooltip`, `@atlaskit/dynamic-table`, `@atlaskit/section-message`, Jest / ts-jest.

## Global Constraints
- Runtime: Atlassian Forge NodeJS 22.x runtime.
- External Auth Provider: `atlassian-oauth` using `auth.atlassian.com` and `api.atlassian.com` (`offline_access`, `read:jira-work`, `read:jira-user`, `read:me`).
- Manifest Module: `jira:dashboardGadget` with `resource: main-gadget` and `edit.resource: main-gadget`.
- Timeout: Maximum 25 seconds execution timeout. All site querying must be executed via `Promise.allSettled` to prevent one failing site from breaking the entire gadget.
- ADF Extractor: Character cap of 120 characters with trailing ellipsis (`…`).

---

### Task 1: Root Project Scaffolding & Configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `jest.config.js`
- Create: `.env.example`
- Create: `.gitignore`

**Interfaces:**
- Consumes: None
- Produces: Root npm scripts (`build`, `test`, `type-check`, `forge:lint`), TypeScript compile options, and Jest runner configuration.

- [ ] **Step 1: Write root configuration files**

Create `package.json`:
```json
{
  "name": "crossdesk4jira",
  "version": "1.0.0",
  "description": "Cross-Site Work Items Dashboard Gadget for Jira Cloud",
  "private": true,
  "scripts": {
    "build": "npm run build:frontend && npm run build:backend",
    "build:backend": "tsc --project tsconfig.json",
    "build:frontend": "cd static/gadget && npm run build",
    "type-check": "tsc --noEmit && cd static/gadget && npm run type-check",
    "test": "jest",
    "test:watch": "jest --watch"
  },
  "dependencies": {
    "@forge/api": "^5.0.0",
    "@forge/resolver": "^1.6.0"
  },
  "devDependencies": {
    "@types/jest": "^29.5.14",
    "@types/node": "^22.10.1",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "typescript": "^5.7.2"
  }
}
```

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "static"]
}
```

Create `jest.config.js`:
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js'],
  clearMocks: true
};
```

Create `.env.example`:
```bash
# Atlassian 3LO OAuth Credentials (from developer.atlassian.com/console)
ATLASSIAN_CLIENT_ID=your_oauth_client_id
ATLASSIAN_CLIENT_SECRET=your_oauth_client_secret
```

Create `.gitignore`:
```
node_modules/
dist/
.env
static/gadget/node_modules/
static/gadget/dist/
.forge/
```

- [ ] **Step 2: Install root dependencies**

Run: `npm install`
Expected: `node_modules` created and `package-lock.json` generated.

- [ ] **Step 3: Verify TypeScript compilation passes**

Run: `npx tsc --noEmit`
Expected: Exit code 0 (no errors).

- [ ] **Step 4: Commit**

```bash
git add package.json tsconfig.json jest.config.js .env.example .gitignore
git commit -m "chore: scaffold root project configuration and dependencies"
```

---

### Task 2: Forge Manifest Definition

**Files:**
- Create: `manifest.yml`
- Create: `README.md`

**Interfaces:**
- Consumes: Environment variables `ATLASSIAN_CLIENT_ID` and `ATLASSIAN_CLIENT_SECRET`.
- Produces: Forge module declarations (`jira:dashboardGadget`, `function`), remotes (`atlassian-auth`, `atlassian-apis`), external auth provider `atlassian-oauth`, and network fetch permissions.

- [ ] **Step 1: Create `manifest.yml`**

```yaml
app:
  id: ari:cloud:ecosystem::app/crossdesk4jira-gadget-app
  runtime:
    name: nodejs22.x

modules:
  jira:dashboardGadget:
    - key: crossdesk4jira-gadget
      title: Cross-Site Work Items
      description: Aggregates Jira issues across multiple Atlassian Cloud sites and accounts.
      resource: main-gadget
      edit:
        resource: main-gadget
      resolver:
        function: gadget-resolver

  function:
    - key: gadget-resolver
      handler: index.handler

resources:
  - key: main-gadget
    path: static/gadget/dist

remotes:
  - key: atlassian-auth
    baseUrl: https://auth.atlassian.com
  - key: atlassian-apis
    baseUrl: https://api.atlassian.com

providers:
  auth:
    - key: atlassian-oauth
      name: Atlassian OAuth
      type: oauth2
      clientId: ${ATLASSIAN_CLIENT_ID}
      clientSecret: ${ATLASSIAN_CLIENT_SECRET}
      remotes:
        - atlassian-auth
        - atlassian-apis
      bearerMethod: authorization-header
      actions:
        authorization:
          remote: atlassian-auth
          path: /authorize
          queryParameters:
            audience: api.atlassian.com
            prompt: consent
        exchangeToken:
          remote: atlassian-auth
          path: /oauth/token
        revokeToken:
          remote: atlassian-auth
          path: /oauth/token/revoke
        retrieveProfile:
          remote: atlassian-apis
          path: /me
          resolvers:
            id: account_id
            displayName: email
      scopes:
        - read:jira-work
        - read:jira-user
        - read:me
        - offline_access

permissions:
  external:
    fetch:
      backend:
        - address: https://auth.atlassian.com
        - address: https://api.atlassian.com
```

- [ ] **Step 2: Create `README.md` with setup and deployment instructions**

Create `README.md` documenting:
- 3LO App setup steps in developer.atlassian.com.
- Setting Forge environment variables (`forge variables set ATLASSIAN_CLIENT_ID ...`).
- Build, test, and deployment commands (`forge deploy`, `forge install`).

- [ ] **Step 3: Commit**

```bash
git add manifest.yml README.md
git commit -m "feat: define forge manifest with external oauth provider and dashboard gadget module"
```

---

### Task 3: Shared Types & Data Models

**Files:**
- Create: `src/types.ts`
- Create: `static/gadget/src/types.ts` (symbolic link or copy of shared contracts)

**Interfaces:**
- Consumes: None
- Produces: Type definitions: `SelectedSite`, `GadgetConfiguration`, `AccessibleSite`, `CommentPreview`, `NormalizedIssue`, `SiteResult`, `GadgetIssuesResponse`.

- [ ] **Step 1: Create `src/types.ts`**

```typescript
export interface SelectedSite {
  accountId: string;
  accountEmail: string;
  siteId: string;
  siteName: string;
  siteUrl: string;
}

export interface GadgetConfiguration {
  clusterTitle: string;
  jql: string;
  selectedSites: SelectedSite[];
  visibleColumns: string[];
  refreshIntervalMinutes?: number;
}

export interface AccessibleSite {
  accountId: string;
  accountEmail: string;
  siteId: string;
  siteName: string;
  siteUrl: string;
  avatarUrl?: string;
  hasJiraAccess: boolean;
}

export type SiteFetchStatus = 'OK' | 'AUTH_ERROR' | 'FORBIDDEN' | 'JQL_ERROR' | 'NETWORK_ERROR';

export interface CommentPreview {
  author: string;
  created: string;
  plainText: string;
}

export interface NormalizedIssue {
  id: string;
  key: string;
  summary: string;
  browseUrl: string;
  status: {
    name: string;
    category: 'new' | 'indeterminate' | 'done' | 'undefined';
  };
  priority?: {
    name: string;
    iconUrl?: string;
  };
  issueType: {
    name: string;
    iconUrl?: string;
  };
  project: {
    key: string;
    name: string;
  };
  updated: string;
  dueDate?: string;
  lastComment?: CommentPreview;
}

export interface SiteResult {
  siteId: string;
  siteName: string;
  siteUrl: string;
  status: SiteFetchStatus;
  errorMessage?: string;
  issues: NormalizedIssue[];
}

export interface GadgetIssuesResponse {
  status: 'OK' | 'NEEDS_CONFIG' | 'ERROR';
  message?: string;
  clusterTitle?: string;
  visibleColumns?: string[];
  results: SiteResult[];
}
```

- [ ] **Step 2: Verify type compilation**

Run: `npx tsc --noEmit`
Expected: Exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: define shared backend and frontend data contracts"
```

---

### Task 4: ADF Text Extractor Helper

**Files:**
- Create: `src/utils/adf.ts`
- Test: `tests/adf.test.ts`

**Interfaces:**
- Consumes: Raw Atlassian Document Format JSON nodes.
- Produces: `extractAdfText(doc: unknown, maxChars?: number): string`.

- [ ] **Step 1: Write unit tests for ADF text extraction**

Create `tests/adf.test.ts`:
```typescript
import { extractAdfText } from '../src/utils/adf';

describe('extractAdfText', () => {
  it('should return empty string for null, undefined, or empty doc', () => {
    expect(extractAdfText(null)).toBe('');
    expect(extractAdfText(undefined)).toBe('');
    expect(extractAdfText({})).toBe('');
  });

  it('should extract text from simple paragraph', () => {
    const doc = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello World' }
          ]
        }
      ]
    };
    expect(extractAdfText(doc)).toBe('Hello World');
  });

  it('should extract text from multiple paragraphs with spacing', () => {
    const doc = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First line.' }]
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Second line.' }]
        }
      ]
    };
    expect(extractAdfText(doc)).toBe('First line. Second line.');
  });

  it('should handle mentions and links', () => {
    const doc = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Assigned to ' },
            { type: 'mention', attrs: { text: '@john.doe' } },
            { type: 'text', text: ' please check.' }
          ]
        }
      ]
    };
    expect(extractAdfText(doc)).toBe('Assigned to @john.doe please check.');
  });

  it('should truncate text longer than maxChars with an ellipsis', () => {
    const longText = 'A'.repeat(150);
    const doc = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: longText }]
        }
      ]
    };
    const result = extractAdfText(doc, 120);
    expect(result.length).toBe(121); // 120 chars + '…'
    expect(result.endsWith('…')).toBe(true);
    expect(result.startsWith('A'.repeat(120))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/adf.test.ts`
Expected: FAIL ("Cannot find module '../src/utils/adf'")

- [ ] **Step 3: Implement `src/utils/adf.ts`**

Create `src/utils/adf.ts`:
```typescript
interface AdfNode {
  type?: string;
  text?: string;
  attrs?: {
    text?: string;
    [key: string]: unknown;
  };
  content?: AdfNode[];
}

export function extractAdfText(doc: unknown, maxChars: number = 120): string {
  if (!doc || typeof doc !== 'object') {
    return '';
  }

  const textParts: string[] = [];

  function traverse(node: AdfNode): void {
    if (!node) return;

    if (node.type === 'text' && typeof node.text === 'string') {
      textParts.push(node.text);
    } else if (node.type === 'mention' && node.attrs?.text) {
      textParts.push(node.attrs.text);
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        traverse(child);
      }
    }
  }

  traverse(doc as AdfNode);

  const fullText = textParts.join(' ').replace(/\s+/g, ' ').trim();
  if (fullText.length <= maxChars) {
    return fullText;
  }

  return fullText.slice(0, maxChars) + '…';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/adf.test.ts`
Expected: PASS (5/5 tests passing).

- [ ] **Step 5: Commit**

```bash
git add src/utils/adf.ts tests/adf.test.ts
git commit -m "feat: implement ADF plain text extraction helper with character limit"
```

---

### Task 5: Site Discovery Resolver (`getAllAccessibleSites`)

**Files:**
- Create: `src/resolvers/sites.ts`
- Test: `tests/sites.test.ts`

**Interfaces:**
- Consumes: Forge API external fetch provider via `api.asUser().withProvider('atlassian-oauth', 'atlassian-apis')`.
- Produces: `getAllAccessibleSites(): Promise<AccessibleSite[]>`.

- [ ] **Step 1: Write unit tests for site discovery**

Create `tests/sites.test.ts`:
```typescript
import { fetchSitesForAccounts } from '../src/resolvers/sites';

describe('fetchSitesForAccounts', () => {
  it('should return empty list when no accounts are connected', async () => {
    const mockProvider = {
      listAccounts: jest.fn().mockResolvedValue([]),
      asAccount: jest.fn()
    };

    const sites = await fetchSitesForAccounts(mockProvider as any);
    expect(sites).toEqual([]);
    expect(mockProvider.listAccounts).toHaveBeenCalledTimes(1);
  });

  it('should discover accessible resources and test Jira access for each site', async () => {
    const mockProvider = {
      listAccounts: jest.fn().mockResolvedValue([
        { id: 'acc-1', displayName: 'dev@company.com' }
      ]),
      asAccount: jest.fn().mockReturnValue({
        fetch: jest.fn().mockImplementation((path: string) => {
          if (path === '/oauth/token/accessible-resources') {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve([
                {
                  id: 'site-1',
                  name: 'Company Production',
                  url: 'https://company.atlassian.net',
                  avatarUrl: 'https://avatar.url/1.png'
                }
              ])
            });
          }
          if (path.includes('/rest/api/3/myself')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve({ accountId: 'acc-1', active: true })
            });
          }
          return Promise.resolve({ ok: false, status: 404 });
        })
      })
    };

    const sites = await fetchSitesForAccounts(mockProvider as any);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toEqual({
      accountId: 'acc-1',
      accountEmail: 'dev@company.com',
      siteId: 'site-1',
      siteName: 'Company Production',
      siteUrl: 'https://company.atlassian.net',
      avatarUrl: 'https://avatar.url/1.png',
      hasJiraAccess: true
    });
  });

  it('should mark hasJiraAccess as false if myself probe fails', async () => {
    const mockProvider = {
      listAccounts: jest.fn().mockResolvedValue([
        { id: 'acc-2', displayName: 'external@partner.com' }
      ]),
      asAccount: jest.fn().mockReturnValue({
        fetch: jest.fn().mockImplementation((path: string) => {
          if (path === '/oauth/token/accessible-resources') {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve([
                { id: 'site-2', name: 'Partner Site', url: 'https://partner.atlassian.net' }
              ])
            });
          }
          // Jira probe fails (e.g. Confluence only)
          return Promise.resolve({ ok: false, status: 403 });
        })
      })
    };

    const sites = await fetchSitesForAccounts(mockProvider as any);
    expect(sites).toHaveLength(1);
    expect(sites[0].hasJiraAccess).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/sites.test.ts`
Expected: FAIL ("Cannot find module '../src/resolvers/sites'")

- [ ] **Step 3: Implement `src/resolvers/sites.ts`**

Create `src/resolvers/sites.ts`:
```typescript
import api from '@forge/api';
import { AccessibleSite } from '../types.js';

interface ProviderAccount {
  id: string;
  displayName?: string;
}

interface RawAccessibleResource {
  id: string;
  name: string;
  url: string;
  avatarUrl?: string;
  scopes?: string[];
}

export interface ForgeAuthProvider {
  listAccounts(): Promise<ProviderAccount[]>;
  asAccount(accountId: string): {
    fetch(path: string, init?: RequestInit): Promise<Response>;
  };
}

export async function fetchSitesForAccounts(provider: ForgeAuthProvider): Promise<AccessibleSite[]> {
  const accounts = await provider.listAccounts();
  if (!accounts || accounts.length === 0) {
    return [];
  }

  const results: AccessibleSite[] = [];

  for (const account of accounts) {
    try {
      const client = provider.asAccount(account.id);
      const res = await client.fetch('/oauth/token/accessible-resources');

      if (!res.ok) {
        continue;
      }

      const sites: RawAccessibleResource[] = await res.json();
      for (const site of sites) {
        let hasJiraAccess = false;
        try {
          const probe = await client.fetch(`/ex/jira/${site.id}/rest/api/3/myself`);
          if (probe.ok) {
            hasJiraAccess = true;
          }
        } catch {
          hasJiraAccess = false;
        }

        results.push({
          accountId: account.id,
          accountEmail: account.displayName || account.id,
          siteId: site.id,
          siteName: site.name,
          siteUrl: site.url,
          avatarUrl: site.avatarUrl,
          hasJiraAccess
        });
      }
    } catch {
      // Continue to next account if one fails
    }
  }

  return results;
}

export async function getAllAccessibleSites(): Promise<AccessibleSite[]> {
  const provider = api.asUser().withProvider('atlassian-oauth', 'atlassian-apis') as unknown as ForgeAuthProvider;
  return fetchSitesForAccounts(provider);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/sites.test.ts`
Expected: PASS (3/3 tests passing).

- [ ] **Step 5: Commit**

```bash
git add src/resolvers/sites.ts tests/sites.test.ts
git commit -m "feat: implement multi-account site discovery and Jira access verification"
```

---

### Task 6: Issue Aggregator Resolver (`getGadgetIssues`)

**Files:**
- Create: `src/resolvers/issues.ts`
- Test: `tests/issues.test.ts`

**Interfaces:**
- Consumes: Gadget context (`gadgetConfiguration`), `extractAdfText`, Forge API provider client.
- Produces: `getGadgetIssues(req: any): Promise<GadgetIssuesResponse>`.

- [ ] **Step 1: Write unit tests for issue aggregator**

Create `tests/issues.test.ts`:
```typescript
import { aggregateIssuesFromSites } from '../src/resolvers/issues';
import { GadgetConfiguration } from '../src/types';

describe('aggregateIssuesFromSites', () => {
  it('should return NEEDS_CONFIG if selectedSites is empty', async () => {
    const config: GadgetConfiguration = {
      clusterTitle: 'My Cluster',
      jql: 'assignee = currentUser()',
      selectedSites: [],
      visibleColumns: ['status']
    };
    const mockProvider = {} as any;

    const res = await aggregateIssuesFromSites(config, mockProvider);
    expect(res.status).toBe('NEEDS_CONFIG');
    expect(res.results).toEqual([]);
  });

  it('should fetch issues in parallel and normalize responses', async () => {
    const config: GadgetConfiguration = {
      clusterTitle: 'Cross Team',
      jql: 'assignee = currentUser()',
      selectedSites: [
        {
          accountId: 'acc-1',
          accountEmail: 'dev@company.com',
          siteId: 'site-1',
          siteName: 'Main Jira',
          siteUrl: 'https://main.atlassian.net'
        }
      ],
      visibleColumns: ['status', 'priority']
    };

    const mockIssuesResponse = {
      issues: [
        {
          id: '1001',
          key: 'DEV-101',
          fields: {
            summary: 'Fix OAuth timeout',
            status: {
              name: 'In Progress',
              statusCategory: { key: 'indeterminate' }
            },
            priority: { name: 'High', iconUrl: 'https://icon/high.png' },
            issuetype: { name: 'Bug', iconUrl: 'https://icon/bug.png' },
            project: { key: 'DEV', name: 'Development' },
            updated: '2026-10-01T10:00:00.000Z',
            duedate: '2026-10-15',
            comment: {
              comments: [
                {
                  author: { displayName: 'Alice' },
                  created: '2026-10-02T12:00:00.000Z',
                  body: {
                    type: 'doc',
                    version: 1,
                    content: [
                      {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Working on reproduction.' }]
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      ]
    };

    const mockProvider = {
      asAccount: jest.fn().mockReturnValue({
        fetch: jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockIssuesResponse)
        })
      })
    };

    const res = await aggregateIssuesFromSites(config, mockProvider);
    expect(res.status).toBe('OK');
    expect(res.results).toHaveLength(1);
    expect(res.results[0].status).toBe('OK');
    expect(res.results[0].issues).toHaveLength(1);
    expect(res.results[0].issues[0].key).toBe('DEV-101');
    expect(res.results[0].issues[0].browseUrl).toBe('https://main.atlassian.net/browse/DEV-101');
    expect(res.results[0].issues[0].status.category).toBe('indeterminate');
    expect(res.results[0].issues[0].lastComment?.plainText).toBe('Working on reproduction.');
  });

  it('should isolate per-site auth errors (401) without failing healthy sites', async () => {
    const config: GadgetConfiguration = {
      clusterTitle: 'Multi Site',
      jql: 'resolution = Unresolved',
      selectedSites: [
        {
          accountId: 'acc-1',
          accountEmail: 'dev@site1.com',
          siteId: 'site-1',
          siteName: 'Healthy Site',
          siteUrl: 'https://site1.atlassian.net'
        },
        {
          accountId: 'acc-2',
          accountEmail: 'dev@site2.com',
          siteId: 'site-2',
          siteName: 'Expired Site',
          siteUrl: 'https://site2.atlassian.net'
        }
      ],
      visibleColumns: ['status']
    };

    const mockProvider = {
      asAccount: jest.fn().mockImplementation((accountId: string) => ({
        fetch: jest.fn().mockImplementation(() => {
          if (accountId === 'acc-1') {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve({ issues: [] })
            });
          }
          return Promise.resolve({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ message: 'Unauthorized' })
          });
        })
      }))
    };

    const res = await aggregateIssuesFromSites(config, mockProvider);
    expect(res.status).toBe('OK');
    expect(res.results).toHaveLength(2);

    const healthy = res.results.find(r => r.siteId === 'site-1');
    const expired = res.results.find(r => r.siteId === 'site-2');

    expect(healthy?.status).toBe('OK');
    expect(expired?.status).toBe('AUTH_ERROR');
    expect(expired?.issues).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/issues.test.ts`
Expected: FAIL ("Cannot find module '../src/resolvers/issues'")

- [ ] **Step 3: Implement `src/resolvers/issues.ts`**

Create `src/resolvers/issues.ts`:
```typescript
import api from '@forge/api';
import {
  GadgetConfiguration,
  GadgetIssuesResponse,
  NormalizedIssue,
  SelectedSite,
  SiteResult,
  SiteFetchStatus
} from '../types.js';
import { extractAdfText } from '../utils/adf.js';
import { ForgeAuthProvider } from './sites.js';

interface RawIssueResponse {
  issues?: Array<{
    id: string;
    key: string;
    fields: {
      summary?: string;
      status?: {
        name?: string;
        statusCategory?: {
          key?: string;
        };
      };
      priority?: {
        name?: string;
        iconUrl?: string;
      };
      issuetype?: {
        name?: string;
        iconUrl?: string;
      };
      project?: {
        key?: string;
        name?: string;
      };
      updated?: string;
      duedate?: string;
      comment?: {
        comments?: Array<{
          author?: { displayName?: string };
          created?: string;
          body?: unknown;
        }>;
      };
    };
  }>;
}

function mapStatusCategory(catKey?: string): 'new' | 'indeterminate' | 'done' | 'undefined' {
  if (catKey === 'new') return 'new';
  if (catKey === 'indeterminate') return 'indeterminate';
  if (catKey === 'done') return 'done';
  return 'undefined';
}

async function fetchIssuesForSite(
  site: SelectedSite,
  jql: string,
  provider: ForgeAuthProvider,
  limit: number = 25
): Promise<SiteResult> {
  const cleanSiteUrl = site.siteUrl.replace(/\/+$/, '');
  const encodedJql = encodeURIComponent(jql);
  const path = `/ex/jira/${site.siteId}/rest/api/3/search/jql?jql=${encodedJql}&maxResults=${limit}&fields=summary,status,priority,updated,duedate,issuetype,project,comment`;

  try {
    const client = provider.asAccount(site.accountId);
    const res = await client.fetch(path);

    if (res.status === 401) {
      return {
        siteId: site.siteId,
        siteName: site.siteName,
        siteUrl: cleanSiteUrl,
        status: 'AUTH_ERROR',
        errorMessage: 'Authentication expired or revoked for this account.',
        issues: []
      };
    }

    if (res.status === 403) {
      return {
        siteId: site.siteId,
        siteName: site.siteName,
        siteUrl: cleanSiteUrl,
        status: 'FORBIDDEN',
        errorMessage: 'Access forbidden. Verify Jira license and permissions.',
        issues: []
      };
    }

    if (res.status === 400) {
      return {
        siteId: site.siteId,
        siteName: site.siteName,
        siteUrl: cleanSiteUrl,
        status: 'JQL_ERROR',
        errorMessage: 'Invalid JQL syntax or field for this site schema.',
        issues: []
      };
    }

    if (!res.ok) {
      return {
        siteId: site.siteId,
        siteName: site.siteName,
        siteUrl: cleanSiteUrl,
        status: 'NETWORK_ERROR',
        errorMessage: `Jira API returned HTTP ${res.status}.`,
        issues: []
      };
    }

    const data: RawIssueResponse = await res.json();
    const rawIssues = data.issues || [];

    const issues: NormalizedIssue[] = rawIssues.map(raw => {
      const fields = raw.fields || {};
      const comments = fields.comment?.comments || [];
      const lastCommentRaw = comments.length > 0 ? comments[comments.length - 1] : undefined;

      return {
        id: raw.id,
        key: raw.key,
        summary: fields.summary || '(No summary)',
        browseUrl: `${cleanSiteUrl}/browse/${raw.key}`,
        status: {
          name: fields.status?.name || 'Unknown',
          category: mapStatusCategory(fields.status?.statusCategory?.key)
        },
        priority: fields.priority
          ? {
              name: fields.priority.name || 'None',
              iconUrl: fields.priority.iconUrl
            }
          : undefined,
        issueType: {
          name: fields.issuetype?.name || 'Task',
          iconUrl: fields.issuetype?.iconUrl
        },
        project: {
          key: fields.project?.key || '',
          name: fields.project?.name || ''
        },
        updated: fields.updated || '',
        dueDate: fields.duedate,
        lastComment: lastCommentRaw
          ? {
              author: lastCommentRaw.author?.displayName || 'Unknown',
              created: lastCommentRaw.created || '',
              plainText: extractAdfText(lastCommentRaw.body)
            }
          : undefined
      };
    });

    return {
      siteId: site.siteId,
      siteName: site.siteName,
      siteUrl: cleanSiteUrl,
      status: 'OK',
      issues
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown network failure';
    return {
      siteId: site.siteId,
      siteName: site.siteName,
      siteUrl: cleanSiteUrl,
      status: 'NETWORK_ERROR',
      errorMessage: message,
      issues: []
    };
  }
}

export async function aggregateIssuesFromSites(
  config: GadgetConfiguration | undefined,
  provider: ForgeAuthProvider
): Promise<GadgetIssuesResponse> {
  if (!config || !config.selectedSites || config.selectedSites.length === 0) {
    return {
      status: 'NEEDS_CONFIG',
      results: []
    };
  }

  const jql = config.jql || 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC';

  const promises = config.selectedSites.map(site =>
    fetchIssuesForSite(site, jql, provider)
  );

  const settled = await Promise.allSettled(promises);
  const results: SiteResult[] = settled.map((outcome, idx) => {
    if (outcome.status === 'fulfilled') {
      return outcome.value;
    }
    const site = config.selectedSites[idx];
    return {
      siteId: site.siteId,
      siteName: site.siteName,
      siteUrl: site.siteUrl,
      status: 'NETWORK_ERROR',
      errorMessage: 'Unexpected internal error during request.',
      issues: []
    };
  });

  return {
    status: 'OK',
    clusterTitle: config.clusterTitle,
    visibleColumns: config.visibleColumns,
    results
  };
}

export async function getGadgetIssues(req: any): Promise<GadgetIssuesResponse> {
  const config = req.context?.extension?.gadgetConfiguration as GadgetConfiguration | undefined;
  const provider = api.asUser().withProvider('atlassian-oauth', 'atlassian-apis') as unknown as ForgeAuthProvider;
  return aggregateIssuesFromSites(config, provider);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/issues.test.ts`
Expected: PASS (3/3 tests passing).

- [ ] **Step 5: Commit**

```bash
git add src/resolvers/issues.ts tests/issues.test.ts
git commit -m "feat: implement parallel multi-site issue aggregation with fault-tolerant error boundaries"
```

---

### Task 7: Resolver Entrypoint Handler (`src/index.ts`)

**Files:**
- Create: `src/index.ts`

**Interfaces:**
- Consumes: Resolver definitions: `getAllAccessibleSites`, `getGadgetIssues`.
- Produces: Exported Forge `handler` (`resolver.getDefinitions()`).

- [ ] **Step 1: Implement `src/index.ts`**

```typescript
import Resolver from '@forge/resolver';
import { getAllAccessibleSites } from './resolvers/sites.js';
import { getGadgetIssues } from './resolvers/issues.js';

const resolver = new Resolver();

resolver.define('getAllAccessibleSites', async () => {
  return getAllAccessibleSites();
});

resolver.define('getGadgetIssues', async (req) => {
  return getGadgetIssues(req);
});

export const handler = resolver.getDefinitions();
```

- [ ] **Step 2: Verify root backend builds clean**

Run: `npm run build:backend`
Expected: Dist generated in `./dist`, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: configure Forge resolver entrypoint with site discovery and issue aggregator handlers"
```

---

### Task 8: Frontend Custom UI App Scaffold

**Files:**
- Create: `static/gadget/package.json`
- Create: `static/gadget/tsconfig.json`
- Create: `static/gadget/vite.config.ts`
- Create: `static/gadget/index.html`
- Create: `static/gadget/src/types.ts`
- Create: `static/gadget/src/main.tsx`

**Interfaces:**
- Consumes: `@forge/bridge`, React 18, `@atlaskit/*`.
- Produces: Frontend build bundle at `static/gadget/dist` ready for Forge Custom UI serving.

- [ ] **Step 1: Create frontend configuration and entry files**

Create `static/gadget/package.json`:
```json
{
  "name": "crossdesk4jira-gadget-ui",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@atlaskit/button": "^17.0.0",
    "@atlaskit/checkbox": "^13.0.0",
    "@atlaskit/css-reset": "^6.0.7",
    "@atlaskit/dynamic-table": "^15.0.0",
    "@atlaskit/lozenge": "^11.0.0",
    "@atlaskit/section-message": "^6.0.0",
    "@atlaskit/spinner": "^16.0.0",
    "@atlaskit/textfield": "^5.0.0",
    "@atlaskit/toggle": "^13.0.0",
    "@atlaskit/tooltip": "^18.0.0",
    "@forge/bridge": "^3.5.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.2",
    "vite": "^6.0.3"
  }
}
```

Create `static/gadget/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

Create `static/gadget/vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
```

Create `static/gadget/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Cross-Site Work Items</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `static/gadget/src/types.ts` copying the shared definitions from `src/types.ts`.

Create `static/gadget/src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@atlaskit/css-reset';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 2: Install frontend dependencies**

Run: `cd static/gadget && npm install`
Expected: `static/gadget/node_modules` installed without conflict.

- [ ] **Step 3: Commit**

```bash
git add static/gadget/package.json static/gadget/tsconfig.json static/gadget/vite.config.ts static/gadget/index.html static/gadget/src/types.ts static/gadget/src/main.tsx
git commit -m "chore: scaffold Custom UI frontend with React, Vite, and Atlaskit dependencies"
```

---

### Task 9: Frontend Entry Router & View vs Edit Switching

**Files:**
- Create: `static/gadget/src/App.tsx`
- Create placeholder: `static/gadget/src/components/GadgetView.tsx`
- Create placeholder: `static/gadget/src/components/GadgetEditConfig.tsx`

**Interfaces:**
- Consumes: `@forge/bridge` `view.getContext()`.
- Produces: Top-level router mounting `<GadgetEditConfig />` when `context.extension.entryPoint === 'edit'` and `<GadgetView />` otherwise.

- [ ] **Step 1: Implement `static/gadget/src/App.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { view } from '@forge/bridge';
import Spinner from '@atlaskit/spinner';
import GadgetView from './components/GadgetView';
import GadgetEditConfig from './components/GadgetEditConfig';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [isEditMode, setIsEditMode] = useState(false);

  useEffect(() => {
    view.getContext().then(ctx => {
      const entryPoint = (ctx as any)?.extension?.entryPoint;
      setIsEditMode(entryPoint === 'edit');
      setLoading(false);
    }).catch(err => {
      console.error('Failed to load Forge context', err);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '160px' }}>
        <Spinner size="medium" />
      </div>
    );
  }

  return isEditMode ? <GadgetEditConfig /> : <GadgetView />;
}
```

- [ ] **Step 2: Create stub components for compile verification**

Create `static/gadget/src/components/GadgetView.tsx`:
```tsx
import React from 'react';

export default function GadgetView() {
  return <div>Gadget View</div>;
}
```

Create `static/gadget/src/components/GadgetEditConfig.tsx`:
```tsx
import React from 'react';

export default function GadgetEditConfig() {
  return <div>Gadget Edit Config</div>;
}
```

- [ ] **Step 3: Verify frontend compiles and builds**

Run: `cd static/gadget && npm run build`
Expected: Build succeeds, output in `static/gadget/dist`.

- [ ] **Step 4: Commit**

```bash
git add static/gadget/src/App.tsx static/gadget/src/components/GadgetView.tsx static/gadget/src/components/GadgetEditConfig.tsx
git commit -m "feat: implement Custom UI entrypoint router based on Forge context entryPoint"
```

---

### Task 10: Gadget Configuration Component (`<GadgetEditConfig />`)

**Files:**
- Modify: `static/gadget/src/components/GadgetEditConfig.tsx`

**Interfaces:**
- Consumes: `invoke('getAllAccessibleSites')`, `requestCredentials('atlassian-oauth')`, `view.getContext()`.
- Produces: Form for Cluster Title, JQL query, Column toggles, Account linking, and Site selection; submits via `view.submit(...)` and cancels via `view.close()`.

- [ ] **Step 1: Implement `<GadgetEditConfig />`**

Implement complete configuration form with:
- Loading state while loading available sites via `invoke('getAllAccessibleSites')`.
- Initializing form values from existing `gadgetConfiguration` context.
- Cluster Title text field.
- JQL textarea with placeholder and syntax help.
- Column visibility checkboxes (Status, Priority, Due Date, Site Origin, Last Comment).
- Connected accounts list with a "Connect Another Account" button invoking `requestCredentials('atlassian-oauth')`.
- Grouped sites selection tree: check/uncheck sites to monitor.
- Save button calling `view.submit(...)`.
- Cancel button calling `view.close()`.

- [ ] **Step 2: Verify type check and build**

Run: `cd static/gadget && npm run build`
Expected: Exit code 0.

- [ ] **Step 3: Commit**

```bash
git add static/gadget/src/components/GadgetEditConfig.tsx
git commit -m "feat: implement GadgetEditConfig component with multi-account linking and site tree"
```

---

### Task 11: Gadget View Component (`<GadgetView />`)

**Files:**
- Modify: `static/gadget/src/components/GadgetView.tsx`

**Interfaces:**
- Consumes: `invoke('getGadgetIssues')`, `requestCredentials('atlassian-oauth')`.
- Produces: Full interactive dashboard gadget view with Dynamic Table, Lozenges, Tooltips, comment snippets, and error resilience.

- [ ] **Step 1: Implement `<GadgetView />`**

Implement full gadget display component:
- States:
  - `LOADING`: Centered `@atlaskit/spinner`.
  - `NEEDS_CONFIG`: Clean empty state prompting to edit configuration.
  - `NO_ACCOUNTS`: Callout prompting user to link Atlassian account via `requestCredentials('atlassian-oauth')`.
  - `READY`: Displays Cluster Title header, issue counter, and refresh button.
- Per-site error warnings:
  - Inline `@atlaskit/section-message` for sites returning `AUTH_ERROR` (with "Re-authorize" button) or `JQL_ERROR` / `NETWORK_ERROR`.
- Issue Table (`@atlaskit/dynamic-table`):
  - Key: Direct link to Jira issue browse URL.
  - Summary: Issue type icon + summary text.
  - Status: `@atlaskit/lozenge` with color category mapping (`new` -> blue, `indeterminate` -> yellow, `done` -> green).
  - Priority: Icon + label.
  - Site: Origin site badge.
  - Due Date: Formatted date string.
  - Last Comment: Speech bubble badge (`💬`) with `@atlaskit/tooltip` showing author, date, and ADF plain text snippet.

- [ ] **Step 2: Verify type check and build**

Run: `cd static/gadget && npm run build`
Expected: Exit code 0.

- [ ] **Step 3: Commit**

```bash
git add static/gadget/src/components/GadgetView.tsx
git commit -m "feat: implement GadgetView component with dynamic table, status lozenges, and comment tooltips"
```

---

### Task 12: End-to-End Build & Verification

**Files:**
- Modify: `package.json` (if any helper scripts needed)
- Modify: `tasks.md` (check off completed tasks)

**Interfaces:**
- Consumes: Entire backend and frontend codebase.
- Produces: Clean test pass (`npm test`), full typecheck (`npm run type-check`), and production build (`npm run build`).

- [ ] **Step 1: Run backend unit tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Run root and frontend type checking**

Run: `npm run type-check`
Expected: Exit code 0.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: Both backend and frontend bundles build into `dist` and `static/gadget/dist`.

- [ ] **Step 4: Update `tasks.md` checklist**

Mark implemented tasks as completed in `tasks.md`.

- [ ] **Step 5: Commit**

```bash
git add tasks.md
git commit -m "chore: mark completed tasks and verify end-to-end build"
```

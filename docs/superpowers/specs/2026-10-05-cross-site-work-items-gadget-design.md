# Cross-Site Work Items Dashboard Gadget (Atlassian Forge) — Design Specification

## 1. Overview
The Cross-Site Work Items Dashboard Gadget is an Atlassian Forge Custom UI application for Jira Cloud. It aggregates and displays Jira issues across multiple Atlassian Cloud sites and multiple Atlassian user accounts using OAuth 2.0 (3LO) External Authentication (`providers.auth`).

Each dashboard gadget instance on any Jira dashboard is individually configurable with:
- A custom cluster title (e.g. "Customer Staging", "Global Core Services").
- Target sites selected from connected Atlassian accounts.
- A customized JQL query (default: `assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC`).
- Configurable column visibility toggles (Key & Summary [fixed], Status, Priority, Due Date, Site Origin, Last Comment).

---

## 2. Technical Architecture

### 2.1 Technology Stack
- **Platform:** Atlassian Forge (NodeJS 22.x runtime for backend resolvers).
- **Frontend:** React 18 with TypeScript, bundled with Vite for fast builds and HMR.
- **Design System:** Atlassian Design System (`@atlaskit/button`, `@atlaskit/lozenge`, `@atlaskit/spinner`, `@atlaskit/tooltip`, `@atlaskit/dynamic-table`, `@atlaskit/section-message`, `@atlaskit/form`, `@atlaskit/textfield`, `@atlaskit/toggle`, `@atlaskit/checkbox`).
- **Bridge & API:** `@forge/bridge` (frontend) and `@forge/api`, `@forge/resolver` (backend).
- **Testing:** Jest / Vitest for backend resolvers and frontend component testing.

### 2.2 Forge Manifest (`manifest.yml`)
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

---

## 3. Data Contracts & Models

### 3.1 Gadget Configuration Model (`GadgetConfiguration`)
Stored natively within Jira dashboard storage via `view.submit(...)` and accessed in resolver context via `req.context.extension.gadgetConfiguration`:
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
  visibleColumns: string[]; // e.g. ['status', 'priority', 'dueDate', 'site', 'lastComment']
  refreshIntervalMinutes?: number; // e.g. 15
}
```

### 3.2 Accessible Site Discovery Model (`AccessibleSite`)
```typescript
export interface AccessibleSite {
  accountId: string;
  accountEmail: string;
  siteId: string;
  siteName: string;
  siteUrl: string;
  avatarUrl?: string;
  hasJiraAccess: boolean;
}
```

### 3.3 Consolidated Issue & Site Result Models
```typescript
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

---

## 4. Backend Resolvers

### 4.1 Resolver Endpoints (`src/index.ts`)
1. **`getAllAccessibleSites`**:
   - Invokes `api.asUser().withProvider('atlassian-oauth', 'atlassian-apis').listAccounts()` to retrieve linked identities.
   - For each account:
     - Calls `GET https://api.atlassian.com/oauth/token/accessible-resources`.
     - Iterates over each site and probes `GET https://api.atlassian.com/ex/jira/${site.id}/rest/api/3/myself`.
     - Validates response: if 200, `hasJiraAccess = true`; if 403 or error, `hasJiraAccess = false`.
   - Returns flat array of `AccessibleSite[]`.

2. **`getGadgetIssues`**:
   - Reads `req.context.extension.gadgetConfiguration`.
   - Validates `selectedSites`. If empty, returns `{ status: 'NEEDS_CONFIG', results: [] }`.
   - For each site in `selectedSites`, queries concurrently with `Promise.allSettled`:
     ```
     GET https://api.atlassian.com/ex/jira/${site.siteId}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=25&fields=summary,status,priority,updated,duedate,issuetype,project,comment
     ```
   - Catches site-specific errors without failing other queries:
     - 401: `status = 'AUTH_ERROR'` (OAuth token expired or revoked for that identity).
     - 403: `status = 'FORBIDDEN'` (Missing project/site permissions).
     - 400: `status = 'JQL_ERROR'` (e.g. invalid syntax or nonexistent custom field).
     - 5xx/Timeout: `status = 'NETWORK_ERROR'`.
     - 200: Maps issues to `NormalizedIssue[]`.
   - Returns `{ status: 'OK', clusterTitle, visibleColumns, results }`.

### 4.2 ADF Plain-Text Extractor (`src/utils/adf.ts`)
Recursive parser traversing Atlassian Document Format JSON structure:
- Recursively collects `.text` properties from `text`, `mention`, `inlineCard`, and formatted blocks.
- Adds spaces between inline elements and newlines between block elements (`paragraph`, `heading`, `listItem`).
- Limits output length to 120 characters, appending `…` if truncated.
- Safely handles null, undefined, or empty payloads.

---

## 5. Frontend Custom UI (`static/gadget/`)

### 5.1 Routing & Context Initialization (`static/gadget/src/App.tsx`)
- Calls `view.getContext()`.
- Extracts `context.extension.entryPoint`:
  - If `entryPoint === 'edit'`: Render `<GadgetEditConfig />`.
  - Otherwise: Render `<GadgetView />`.

### 5.2 Configuration Component (`<GadgetEditConfig />`)
- **State:**
  - `clusterTitle`: string.
  - `jql`: string.
  - `selectedSiteIds`: Set of string keys (`${accountId}::${siteId}`).
  - `visibleColumns`: Set of column keys (`status`, `priority`, `dueDate`, `site`, `lastComment`).
  - `accessibleSites`: list loaded from `getAllAccessibleSites`.
  - `loadingSites`: boolean.
- **Account Connection:**
  - Shows list of connected accounts.
  - Button: "Connect Another Account" calls `@forge/bridge` `requestCredentials('atlassian-oauth')`. Once completed, re-invokes `getAllAccessibleSites`.
- **Site Selection:**
  - Checkbox tree grouped by account email.
  - Displays site name, URL, avatar, and a badge if Jira access is verified.
- **Form Actions:**
  - Submit: `await view.submit({ clusterTitle, jql, selectedSites, visibleColumns, refreshIntervalMinutes: 15 })`.
  - Cancel: `await view.close()`.

### 5.3 Gadget View Component (`<GadgetView />`)
- **States:**
  - **Loading:** Displays centered `@atlaskit/spinner` with "Loading cross-site issues...".
  - **Needs Configuration:** Clean empty state guiding user to configure the gadget.
  - **No Accounts Connected:** Section message prompting to connect an Atlassian account with a direct connect button.
  - **Ready / Displaying Data:**
    - Header showing Cluster Title, total issue count badge, and a Refresh action.
    - Site Error Warning Banners: if any site has `AUTH_ERROR` or `FORBIDDEN`, displays an `@atlaskit/section-message` with a "Re-authenticate" button without hiding other healthy sites.
    - Issue Table using `@atlaskit/dynamic-table`:
      - **Key:** Link to `${siteUrl}/browse/${key}` opening in new tab.
      - **Summary:** Issue type icon + summary text.
      - **Status:** `@atlaskit/lozenge` with color mapped by category:
        - `new` -> `blue` (default)
        - `indeterminate` -> `yellow` (in-progress)
        - `done` -> `green` (success)
      - **Priority:** Icon + name.
      - **Site:** Tag badge with origin site name.
      - **Due Date:** Formatted date string (highlighted if overdue).
      - **Last Comment:** Speech bubble icon with tooltip containing author, timestamp, and plain-text snippet.

---

## 6. Resilience & Edge Cases
1. **Partial Site Outage / Auth Revocation:** Handled at resolver level via `Promise.allSettled`. An error on Site A never prevents issues from Site B from displaying.
2. **Execution Limit Compliance:** All site queries run in parallel with a 10s fetch timeout, well inside the Forge 25s limit.
3. **Invalid JQL:** Handled gracefully per site. If a JQL query works on Site A (standard fields) but references a missing field on Site B, Site B displays an inline JQL error banner while Site A renders smoothly.
4. **Data Isolation:** Gadgets on the same or different dashboards maintain completely isolated configurations via Jira's native gadget configuration storage.

---

## 7. Verification & Testing Plan
1. **Unit Tests:**
   - ADF text extractor edge cases (nested lists, code blocks, empty docs, character capping).
   - Resolver parallel querying and error transformation logic.
2. **Type Checking:**
   - Full TypeScript build check (`npm run type-check`).
3. **Frontend Build:**
   - Production Vite build output verification (`npm run build`).
4. **End-to-End Deployment Verification:**
   - Configure Forge CLI variables (`ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`).
   - Validate manifest via `forge lint`.

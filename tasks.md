# TASKS: Cross-Site Work Items Dashboard Gadget (Atlassian Forge)

## Project Overview
Build a Jira Cloud Dashboard Gadget using Atlassian Forge (Custom UI) that aggregates and displays Jira issues across multiple Atlassian Cloud sites and multiple Atlassian accounts using OAuth 2.0 (3LO) External Authentication. Each gadget instance on a dashboard can be individually configured with a custom cluster title, target sites, optional JQL filter, and field toggles.

---

## Technical Architecture & Constraints
- **Runtime:** Atlassian Forge (NodeJS runtime for Resolvers, React + Atlassian Design System for Custom UI frontend).
- **Module:** `jira:dashboardGadget` with `edit` resource entry pointing to the Custom UI bundle.
- **Auth Provider:** Forge External Auth (`providers.auth`) targeting `auth.atlassian.com` and `api.atlassian.com` (`offline_access`, `read:jira-work`, `read:jira-user`, `read:me`).
- **Data Isolation & Storage:** Gadget configuration (sites, JQL, columns) stored natively via `@forge/bridge`'s `view.submit(config)`. Auth tokens managed via Forge provider multi-account mechanisms (`provider.listAccounts()`, `provider.asAccount(id)`).
- **Execution Limits:** 25s execution timeout. All site querying must be executed via `Promise.all` with fail-safe error boundaries so one dead site does not break the entire gadget.

---

## Phase 1: Environment Setup & Manifest Configuration

- [ ] **Task 1.1: Register Atlassian 3LO App**
  - Navigate to [developer.atlassian.com/console](https://developer.atlassian.com/console).
  - Create OAuth 2.0 (3LO) integration.
  - Add API Scopes: `read:jira-work`, `read:jira-user`, `read:me`, `offline_access`.
  - Set Callback URL to Forge external callback: `https://oauth-3legged.services.atlassian.com/v1/authorize/callback`.
  - Record `Client ID` and `Client Secret`.

- [x] **Task 1.2: Initialize Forge App Directory**
  - Create Forge app scaffold with Custom UI:
    ```bash
    forge create --template custom-ui
    ```
  - Set Forge environment variables:
    ```bash
    forge variables set ATLASSIAN_CLIENT_ID <client-id>
    forge variables set ATLASSIAN_CLIENT_SECRET <client-secret>
    ```

- [x] **Task 1.3: Define `manifest.yml`**
  - Declare `jira:dashboardGadget` module with `key`, `title`, `description`, `thumbnail`, `resource`, `resolver`, and `edit.resource`.
  - Declare `providers.auth` for key `atlassian-oauth` pointing to `remotes` `atlassian-auth` (`https://auth.atlassian.com`) and `atlassian-apis` (`https://api.atlassian.com`).
  - Configure `retrieveProfile` to resolve `id: account_id` and `displayName: email`.
  - Configure `permissions.external.fetch.backend` allowlisting `https://auth.atlassian.com` and `https://api.atlassian.com`.

---

## Phase 2: Backend Resolver Implementation (`src/resolvers/`)

- [x] **Task 2.1: Multi-Account Discovery & Validation Handler**
  - Implement `getAllAccessibleSites`:
    - Call `provider.listAccounts()`.
    - For each account, invoke `/oauth/token/accessible-resources`.
    - For each returned site, probe `/ex/jira/${site.id}/rest/api/3/myself` to test Jira product license and permission.
    - Return a flat structure: `[{ accountId, accountEmail, siteId, siteName, siteUrl, avatarUrl, hasJiraAccess }]`.

- [x] **Task 2.2: ADF Text Extraction Helper**
  - Implement recursive parser `extractAdfText(doc)` to extract plain-text preview strings from Atlassian Document Format (ADF) payloads for comments.
  - Enforce character cap (e.g. 120 chars + `…`).

- [x] **Task 2.3: Targeted Issue Aggregator Resolver**
  - Implement `getGadgetIssues`:
    - Read gadget configuration from `req.context.extension.gadgetConfiguration`.
    - If `selectedSites` is empty, return `{ status: 'NEEDS_CONFIG' }`.
    - For each configured `{ accountId, siteId, siteUrl }`, query:
      ```
      /ex/jira/${siteId}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${limit}&fields=summary,status,priority,updated,duedate,issuetype,project,comment
      ```
    - Map output safely: handle 401 (re-auth needed), 403, or network timeout on a per-site basis without throwing unhandled exceptions.
    - Return `{ status: 'OK', clusterTitle, columns, results: [ { siteName, siteUrl, status, issues: [...] } ] }`.

---

## Phase 3: Frontend Gadget UI (`static/gadget/src/`)

- [x] **Task 3.1: Entry Point & Routing**
  - Inspect `view.getContext()` to identify `context.extension.entryPoint`.
  - If `entryPoint === 'edit'`, mount `<GadgetEditConfig />`.
  - Else, mount `<GadgetView />`.

- [x] **Task 3.2: Configuration Component (`<GadgetEditConfig />`)**
  - Inputs:
    - Cluster Title text field (e.g. "Core Team", "Customer Staging").
    - JQL input (default: `assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC`).
    - Column visibility toggles (Key & Summary [fixed], Status, Priority, Due Date, Site Origin, Last Comment).
    - Multi-account list showing connected emails with a "Connect Another Account" action calling `requestCredentials('atlassian-oauth')`.
    - Checkbox tree of validated sites grouped by account.
  - Save button calling:
    ```javascript
    await view.submit({ clusterTitle, jql, selectedSites, visibleColumns, refresh: 15 });
    ```
  - Cancel button calling `await view.close()`.

- [x] **Task 3.3: Gadget View Component (`<GadgetView />`)**
  - Handle view states:
    - **Loading:** Render `@atlaskit/spinner`.
    - **Unconfigured:** Empty state prompting user to click "Configure".
    - **No Accounts Linked:** Prompt to authenticate via `requestCredentials('atlassian-oauth')`.
    - **Data Loaded:** Render `@atlaskit/dynamic-table` or grouped lists.
  - Render Jira status using `@atlaskit/lozenge` with standard category coloring (`new` -> blue, `indeterminate` -> yellow, `done` -> green).
  - Last Comment column: Render comment icon badge (`💬`) with `@atlaskit/tooltip` showing the author, date, and ADF-extracted preview snippet.
  - Per-site error badge/banner if an individual site returned 401/403 without blocking other sites.

---

## Phase 4: Testing & Verification

- [ ] **Task 4.1: Multi-Account Auth Verification**
  - Test linking Account A (`user@domain1.com`).
  - Link Account B (`user@domain2.com`).
  - Verify `listAccounts()` contains both identities and tokens refresh correctly.

- [ ] **Task 4.2: Side-by-Side Gadget Clustering**
  - Add Gadget Instance 1 configured for Site A + Site B.
  - Add Gadget Instance 2 configured for Site C with a different JQL query.
  - Verify that configurations remain completely isolated between gadgets on the same dashboard.

- [ ] **Task 4.3: Resilience & Edge Case Testing**
  - Revoke token or remove Jira license for one site: verify the gadget displays an inline warning for that site while rendering remaining sites normally.
  - Test JQL syntax error handling: verify user receives an inline configuration error rather than an unhandled app crash.


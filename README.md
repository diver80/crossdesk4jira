# Cross-Site Work Items Dashboard Gadget (Atlassian Forge)

An Atlassian Forge Jira Cloud Dashboard Gadget that aggregates and displays Jira work items across multiple Atlassian Cloud sites and multiple Atlassian accounts using OAuth 2.0 (3LO) External Authentication.

---

## Features

- **Multi-Site & Multi-Account Aggregation:** Aggregate Jira issues across different Atlassian Cloud sites and user accounts in a single dashboard gadget.
- **Fail-Safe Resilience:** Parallel queries using `Promise.allSettled` ensure that an authentication issue or JQL syntax variation on one site never blocks issues from healthy sites.
- **Customizable Per Gadget Instance:**
  - Cluster Title (e.g. "Customer Staging", "EMEA Production").
  - Target site multi-selection grouped by linked account.
  - Custom JQL query (default: `assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC`).
  - Column visibility toggles (Key & Summary [fixed], Status, Priority, Due Date, Site Origin, Last Comment).
- **Atlassian Design System:** Built with React 18 and `@atlaskit` components (`@atlaskit/dynamic-table`, `@atlaskit/lozenge`, `@atlaskit/spinner`, `@atlaskit/tooltip`).
- **ADF Comment Previews:** Automatically parses Atlassian Document Format (ADF) payloads into clean plain-text tooltips capped at 120 characters.

---

## Prerequisites

1. [Atlassian CLI (`forge`)](https://developer.atlassian.com/platform/forge/getting-started/) installed (`forge --version`).
2. Node.js 22.x or later.
3. An Atlassian Developer account.

---

## 3LO OAuth App Registration

To enable cross-site and cross-account access, register an OAuth 2.0 (3LO) integration in the Atlassian Developer Console:

1. Navigate to [developer.atlassian.com/console](https://developer.atlassian.com/console).
2. Click **Create** > **OAuth 2.0 (3LO) integration**.
3. Name your integration (e.g., `Cross-Site Work Items Gadget`).
4. In **Permissions**, add Jira platform REST API scopes:
   - `read:jira-work`
   - `read:jira-user`
   - `read:me`
   - `offline_access`
5. In **Authorization**, set the Callback URL to:
   ```
   https://oauth-3legged.services.atlassian.com/v1/authorize/callback
   ```
6. In **Settings**, copy your **Client ID** and **Client Secret**.

---

## Setting Forge Environment Variables

In your terminal within this directory, set the Forge environment variables:

```bash
forge variables set ATLASSIAN_CLIENT_ID <your-client-id>
forge variables set ATLASSIAN_CLIENT_SECRET <your-client-secret>
```

---

## Development & Build

### Install Dependencies
```bash
# Install root backend dependencies
npm install

# Install frontend Custom UI dependencies
cd static/gadget && npm install && cd ../..
```

### Run Tests
```bash
npm test
```

### Type Check
```bash
npm run type-check
```

### Build Production Bundles
```bash
npm run build
```

---

## Deployment & Installation

1. Register app (if first time):
   ```bash
   forge register "Cross-Site Work Items"
   ```
2. Deploy app to development environment:
   ```bash
   forge deploy
   ```
3. Install to your Jira Cloud test site:
   ```bash
   forge install --product jira --site <your-jira-site>.atlassian.net
   ```
4. In Jira, navigate to any **Dashboard**, click **Add gadget**, and find **Cross-Site Work Items**.
5. Configure your cluster title, link your accounts, pick your target sites, and save!

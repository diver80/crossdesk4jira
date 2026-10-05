# crossdesk4jira (Atlassian Forge Dashboard Gadget)

An Atlassian Forge Jira Cloud Dashboard Gadget that aggregates and displays Jira work items across multiple Atlassian Cloud sites and multiple Atlassian accounts.

---

## Features

- **Multi-Site & Multi-Account Aggregation:** Aggregate Jira issues across different Atlassian Cloud sites and user accounts in a single dashboard gadget.
- **Fail-Safe Resilience:** Parallel queries using `Promise.allSettled` and timeouts ensure that an authentication issue or JQL syntax variation on one site never blocks issues from healthy sites.
- **Configurable Maximum Items:** Global cap (1–100, default 25) across all sites, keeping the most recently updated work items with truncation indicators.
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

## Architecture: Self-Managed OAuth 2.0 (3LO)

Because Forge External Auth (`providers.auth`) rejects Atlassian OAuth credentials, this app implements a self-managed OAuth 2.0 authorization code flow:
- `startOAuth` generates a secure single-use `state` (10-minute TTL) stored in Forge secret storage and bound to the initiating Jira user.
- The authorization redirect lands on the app's `oauth-callback` web trigger, which exchanges the authorization code with Atlassian using `ATLASSIAN_CLIENT_SECRET`.
- Tokens are stored securely in Forge Secret Storage per Jira user and refreshed automatically.
- Users can connect multiple Atlassian accounts (including from private windows / other browser profiles) and disconnect them anytime.

---

## OAuth 2.0 App Registration & Setup

To enable cross-site and cross-account access, register an OAuth 2.0 (3LO) integration in the Atlassian Developer Console:

1. Navigate to [developer.atlassian.com/console](https://developer.atlassian.com/console).
2. Click **Create** > **OAuth 2.0 (3LO) integration**.
3. Name your integration (e.g., `crossdesk4jira sign-in`).
4. In **Permissions**, add Jira platform REST API scopes:
   - `read:jira-work`
   - `read:jira-user`
   - `read:me`
   - `offline_access`
5. In **Settings**, copy your **Client ID** and **Client Secret**.
6. Set Forge environment variables (use `--encrypt` for the secret):
   ```bash
   forge variables set ATLASSIAN_CLIENT_ID <your-client-id>
   forge variables set --encrypt ATLASSIAN_CLIENT_SECRET <your-client-secret>
   ```
7. Deploy the app to your environment:
   ```bash
   forge deploy -e development
   ```
8. Retrieve your environment's webtrigger callback URL:
   ```bash
   forge webtrigger create -f oauth-callback -e development -s <your-site>.atlassian.net -p Jira
   ```
   (Or use `forge webtrigger list` to find the existing URL).
9. In the Developer Console under **Authorization**, add the webtrigger URL as the **Callback URL**.

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
   forge register crossdesk4jira -s <developer-space-id> -y
   ```
2. Deploy app:
   ```bash
   forge deploy -e development
   ```
3. Install to your Jira Cloud site:
   ```bash
   forge install -e development -s <your-jira-site>.atlassian.net -p Jira
   ```
4. In Jira, navigate to any **Dashboard**, click **Add gadget**, and find **crossdesk4jira**.
5. Configure your cluster title, link your accounts, pick your target sites, and save!

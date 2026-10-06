# OAuth 2.0 Central Callback Relay Architecture

This document explains why the GitHub Pages OAuth redirect relay exists for **crossdesk4jira**, how it works, and why it is 100% secure and stateless.

---

## 1. Why is a Relay Needed?

When publishing an Atlassian Forge app on the Atlassian Marketplace:
1. **Dynamic Web Triggers:** Every customer site that installs the app receives a unique, random Forge webtrigger URL (e.g. `https://<unique-id>.hello.atlassian.net/x1/...`).
2. **Single Callback in Console:** The Atlassian Developer Console only accepts **one** fixed OAuth 2.0 (3LO) callback URL. Wildcards (`*.hello.atlassian.net`) are not supported by Atlassian.
3. **Catch-22 in Forge:** Forge External Auth (`providers.auth`) rejects Atlassian credentials with:  
   `Atlassian credentials are not supported in auth providers. MANIFEST_INVALID_RULE`

To bridge this gap, a single, fixed public callback URL is registered in the Atlassian Developer Console:
`https://diver80.github.io/crossdesk4jira/`

---

## 2. Privacy & Zero-Data Guarantee

The GitHub Pages relay (`docs/index.html`):
- **Is 100% Stateless & Client-Side:** It is a single static HTML/JS file running inside the user's browser. There is no backend, no server, and no database.
- **Never Sees or Stores Tokens:** In OAuth 2.0 authorization code flow, the callback receives only a temporary one-time authorization `code`. Access tokens and refresh tokens are **never** present at this stage.
- **Never Sees the Client Secret:** The client secret is stored encrypted inside Forge (`ATLASSIAN_CLIENT_SECRET`) and never leaves the customer's Jira instance.
- **No Analytics / No Tracking:** Zero external scripts, cookies, analytics, or third-party requests.
- **Open Source:** The full code is visible in [`docs/index.html`](index.html).

---

## 3. Security Protections

### Open Redirect Defense
To prevent malicious use of the relay as an open redirect:
- The relay script inspects the target URL encoded in the `state` parameter.
- It strictly enforces that the destination protocol is `https:`.
- It strictly enforces that the destination domain ends with `.hello.atlassian.net` or `.hello.atlassian-dev.net` (Atlassian Forge web trigger infrastructure).
- Any attempt to redirect to an unauthorized host displays an immediate error and aborts.

### Referrer Policy
The page includes `<meta name="referrer" content="no-referrer">` to ensure authorization parameters are never leaked through HTTP referrer headers.

---

## 4. How the Flow Works (Step-by-Step)

```
[1] User clicks "Connect Account" in Gadget
       │
       ▼
[2] Forge Gadget creates a 64-hex state secret (stored in user's Forge Secret Storage)
    Encodes: state = base64url({ t: customerWebTriggerUrl, s: stateSecret })
    Directs browser to: https://auth.atlassian.com/authorize?redirect_uri=https://diver80.github.io/crossdesk4jira/&state=...
       │
       ▼
[3] User approves access on Atlassian Consent Screen
       │
       ▼
[4] Atlassian redirects browser to GitHub Pages Relay:
    https://diver80.github.io/crossdesk4jira/?code=AUTH_CODE&state=...
       │
       ▼
[5] Relay extracts target Forge webtrigger and validates domain (*.hello.atlassian.net)
    Immediately forwards browser:
    https://<customer>.hello.atlassian.net/x1/.../?code=AUTH_CODE&state=stateSecret
       │
       ▼
[6] Customer's Forge Webtrigger receives the code & stateSecret:
    - Validates stateSecret against Forge Secret Storage
    - Exchanges AUTH_CODE directly with https://auth.atlassian.com/oauth/token
    - Saves access & refresh tokens in the user's private Forge Secret Storage
       │
       ▼
[7] User closes tab and clicks "Refresh" in the gadget. All set!
```

---

## 5. Enabling GitHub Pages on the Repository

1. Push this repository to GitHub under `diver80/crossdesk4jira`.
2. On GitHub, navigate to **Settings** > **Pages**.
3. Under **Build and deployment**:
   - Source: **Deploy from a branch**
   - Branch: `main` / Folder: `/docs`
4. Click **Save**.
5. Your callback URL is live at:
   `https://diver80.github.io/crossdesk4jira/`
6. Register `https://diver80.github.io/crossdesk4jira/` as the **Callback URL** in your Atlassian Developer Console.

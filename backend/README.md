# VERTEX-ER backend (static server)

This backend serves your frontend files (index.html, asset-manager.html, vos.css) from the project root.

## Prerequisites
- Windows 10/11
- Node.js 18 or newer installed and available on PATH
  - Check: open PowerShell and run: `node -v`
  - If you see "node is not recognized", install Node.js LTS from https://nodejs.org/ and reopen your terminal.

## Quick start (recommended on Windows)
1) In File Explorer, open this folder: `C:\Users\aranj\WebstormProjects\VERTEX-ER_asset&equipments\backend`
2) Double‑click `start-server.cmd`
   - The script will:
     - Check if Node is installed and guide you if it is missing
     - Run `npm install` (first time only)
     - Start the server

## Manual start via PowerShell
1) Open PowerShell
2) Change directory:
   ```powershell
   cd C:\Users\aranj\WebstormProjects\VERTEX-ER_asset&equipments\backend
   ```
3) Install dependencies (first time):
   ```powershell
   npm install
   ```
4) Start the server:
   ```powershell
   npm start
   ```

## Access
- App: http://localhost:3001
- Health: http://localhost:3001/health

The server serves static files from the project root (`..`), so both `index.html` and `asset-manager.html` are available directly.

## Configuration
- Environment file: `backend\.env`
  - `PORT=3001` (change if needed)
  - `USER_API_URL=http://goatedcodoer:8080/api/users`  # Java API endpoint to proxy
- Server file: `backend\server.js`

Port handling:
- If the chosen PORT is already in use, the server automatically tries the next ports (e.g., 3001, 3002, …) up to a limit and logs the final URL.
- You can control this via `backend/.env`:
  - `PORT=3001`          # starting port
  - `HOST=0.0.0.0`       # optional bind address
  - `PORT_RETRY_MAX=10`  # optional number of additional ports to try
If all retries fail, stop the process using the port or pick a higher `PORT` and try again.

## Java API proxy
- The Node server exposes `GET /api/users` which forwards to `USER_API_URL`. This allows the frontend to call the Java service without CORS issues.
- Frontend example: `fetch('/api/users')`
- To point to a different Java endpoint or host, set `USER_API_URL` in `backend/.env`.
- To proxy more Java controllers (e.g., `AssetsEquipmentsController` at `/api/assets`), add a similar route in `backend/server.js` or extend the proxy.


## Auto-login from external software

This frontend supports auto-login so you can embed it in another application and pass the current user’s credentials.

What it does:
- The login page (index.html) includes script.js which handles auto-login and manual login.
- When logged in, a session object is stored in sessionStorage under the key `vosUser`.
- If a user is already logged in and visits the root, they are redirected to asset-manager.html.
- The main UI (asset-manager.html) checks for `vosUser` and redirects back to index.html if missing. The Logout button clears the session and returns to index.html.

Methods to auto-login:
1) URL parameters
   - Open the app with query parameters:
     - http://localhost:3001/?email=user@example.com&token=XYZ
       or
     - http://localhost:3001/?email=user@example.com&password=secret
   - Supported aliases: `email|username|user`, `password|pass`, `token|auth`.
   - On load, the app stores a session and redirects to asset-manager.html.

2) postMessage (for iframe/embedded scenarios)
   - If you host index.html within your software (e.g., in a WebView or iframe), post a message to the frame:
```js
iframe.contentWindow.postMessage({
  type: 'VOS_LOGIN',
  email: 'user@example.com',
  token: 'XYZ' // or password: 'secret'
}, '*');
```
   - The app will store the session and redirect to asset-manager.html.

Notes:
- By default, credentials are not validated server-side. If you need server-side verification against your Java API before establishing the session, add a backend endpoint (e.g., POST /api/login) to validate credentials and then let script.js call it before storing the session.
- The current Node server already proxies GET /api/users via USER_API_URL. You can extend backend/server.js similarly for other Java controllers (e.g., AssetsEquipmentsController).

Manual login (fallback):
- Without URL params or postMessage, the login form on index.html will store the session and redirect after you click Sign In.

Testing:
- Start the server (see instructions above) and open:
  - Auto via token: http://localhost:3001/?email=you@domain.com&token=DEMO
  - Auto via password: http://localhost:3001/?email=you@domain.com&password=demo
  - Direct access guard: open http://localhost:3001/asset-manager.html without logging in, it should redirect to index.html.
  - Logout: click Logout in asset-manager.html and you should return to index.html.

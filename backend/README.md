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
- App: http://localhost:3000
- Health: http://localhost:3000/health

The server serves static files from the project root (`..`), so both `index.html` and `asset-manager.html` are available directly.

## Configuration
- Environment file: `backend\.env`
  - `PORT=3000` (change if needed)
  - `USER_API_URL=http://goatedcodoer:8080/api/users`  # Java API endpoint to proxy
- Server file: `backend\server.js`

Port handling:
- If the chosen PORT is already in use, the server automatically tries the next ports (e.g., 3001, 3002, …) up to a limit and logs the final URL.
- You can control this via `backend/.env`:
  - `PORT=3000`          # starting port
  - `HOST=0.0.0.0`       # optional bind address
  - `PORT_RETRY_MAX=10`  # optional number of additional ports to try
If all retries fail, stop the process using the port or pick a higher `PORT` and try again.

## Java API proxy
- The Node server exposes `GET /api/users` which forwards to `USER_API_URL`. This allows the frontend to call the Java service without CORS issues.
- Frontend example: `fetch('/api/users')`
- To point to a different Java endpoint or host, set `USER_API_URL` in `backend/.env`.
- To proxy more Java controllers (e.g., `AssetsEquipmentsController` at `/api/assets`), add a similar route in `backend/server.js` or extend the proxy.

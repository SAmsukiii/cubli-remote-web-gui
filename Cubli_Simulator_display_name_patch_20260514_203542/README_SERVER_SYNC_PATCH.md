# Cubli Remote Web GUI - Server Sync Patch

This patch keeps the existing React source structure and adds a local Node.js/Express server sync feature.

## Added files

- `src/useServerSync.js`
- `src/ServerPanel.js`
- `server/index.js`
- `server/data/.gitkeep`

## Modified files

- `src/CubliSimulator.js`
- `src/SerialPanel.js`
- `src/BlePanel.js`
- `src/CubliSimulator.css`
- `package.json`

## Kept files

- `src/useEsp32Serial.js`
- `src/useEsp32Ble.js`
- `public/index.html`
- `public/manifest.json`
- `public/sw.js`

`public/models/body.glb` and `public/models/wheel.glb` are not included in this patch zip. Keep them in your real project at the same paths.

## What changed in package.json

The uploaded package.json was preserved and only the following items were added:

- dependencies: `express`, `cors`
- scripts: `server`

Existing `npm start`, `npm run build`, `npm test`, and `npm run eject` scripts were kept unchanged.

## Install

In your real React project folder:

```bash
npm install
```

If you copy only the changed source files and do not replace package.json, run:

```bash
npm install express cors
```

## Run

Terminal 1:

```bash
npm run server
```

Terminal 2:

```bash
npm start
```

React app server URL:

```text
http://localhost:5050
```

## Test order

1. Start the server with `npm run server`.
2. Start React with `npm start`.
3. Open the Server tab.
4. Set Server URL to `http://localhost:5050`.
5. Click `Test Connection`.
6. Click `Start Server Session`.
7. Turn `Auto Upload` ON.
8. Connect Serial Receiver or BLE Sender.
9. Check sample queue, uploaded samples, uploaded events, and last upload time.
10. Press a command button such as Tare or Stop, then check uploaded events.
11. Click `Download Session Data`.

## VS Code use

Open the real project folder in VS Code, not the patch folder alone. Copy the patch files into the same relative paths, then run `npm install`, `npm run server`, and `npm start` in separate terminals.

## Codex handoff

You can continue this in Codex from VS Code. Give Codex the real project folder plus this patch, and ask it to apply the patch without changing the existing file structure or GLB model paths.

Suggested Codex instruction:

```text
Apply the attached Cubli server sync patch to the current React project. Preserve the existing project structure and do not move public/models/body.glb or public/models/wheel.glb. Keep existing Serial, BLE, Phone Sensor, PWA, command UI, CSV logging, and 3D Cubli rendering behavior. Add the Server tab, useServerSync hook, local Express server, and package.json changes exactly as provided. After applying, check npm start, npm run server, and npm run build errors and only make minimal fixes if needed.
```

## Netlify / deployed use

A Netlify HTTPS frontend cannot reliably call a plain local HTTP server because of browser security rules. Use an HTTPS server address or a tunnel/reverse proxy such as ngrok or Cloudflare Tunnel.

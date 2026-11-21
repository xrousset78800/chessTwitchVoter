#!/usr/bin/env node
/**
 * Pilote la simulation du serveur qui tourne sur cette machine (voir sim.js).
 *
 *   node sim-cli.js status
 *   node sim-cli.js seed        [channels=28] [battles=160]
 *   node sim-cli.js live-start  [games=8] [moveMs=8000]
 *   node sim-cli.js live-stop
 *   node sim-cli.js purge
 *   node sim-cli.js snapshot
 *   node sim-cli.js restore     [name]
 *
 * En production : docker exec chesstwitchvoter node sim-cli.js status
 * (ou le workflow GitHub « Simulation »).
 */
const fs = require('fs');
const { KEY_FILE } = require('./sim');

const [action = 'status', ...args] = process.argv.slice(2);
const body = {};
for (const a of args) {
    const [k, v] = a.includes('=') ? a.split('=') : ['name', a];
    body[k] = /^\d+$/.test(v) ? Number(v) : v;
}

(async () => {
    let key;
    try { key = fs.readFileSync(KEY_FILE, 'utf8').trim(); }
    catch { console.error(`Clé introuvable (${KEY_FILE}) : le serveur tourne-t-il sur cette machine ?`); process.exit(1); }
    const port = process.env.PORT || 3000;
    const res = await fetch(`http://127.0.0.1:${port}/api/sim/${encodeURIComponent(action)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Sim-Key': key },
        body: JSON.stringify(body)
    });
    const text = await res.text();
    try { console.log(JSON.stringify(JSON.parse(text), null, 2)); } catch { console.log(res.status, text); }
    process.exit(res.ok ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });

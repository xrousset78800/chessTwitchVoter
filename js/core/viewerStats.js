/**
 * Stats des viewers : à chaque coup joué, la liste des viewers qui ont voté
 * part au serveur (regroupée toutes les quelques secondes).
 *
 * Un viewer compte une seule fois par coup, même avec plusieurs votes.
 * « picked » : son coup a été joué (partie) ou c'était la bonne réponse (puzzle).
 * Les stats sont rangées sous la chaîne Twitch connectée : sans connexion, rien n'est envoyé.
 * Les viewers « picked » sont crédités en pions par le serveur : réponse rendue par l'événement
 * « coinsCredited » (detail : { kind, move, ply, rows: [{ login, name, coins, xp }] }), affiché par CoinFx.
 */
import twitchAuth from './twitchAuth.js';

const API = '/api/stats/votes';
const LOGIN_RE = /^[a-z0-9_]{1,25}$/;
// Envoi presque immédiat : la fenêtre « Crédités sur ce coup » suit le coup joué
const FLUSH_MS = 400;

const queue = [];
let timer = null;

/**
 * @param {'game'|'puzzle'} kind
 * @param {Array<{login:string, name?:string, move:string}>} votes - votes du tour
 * @param {(move:string) => boolean} isPicked
 * @param {{move?:string, ply?:number}} [meta] - coup joué (ou bonne réponse), pour la fenêtre des crédités
 */
export function recordTurn(kind, votes, isPicked, meta = {}) {
    if (!twitchAuth.isLoggedIn || !votes?.length) return;
    const voters = new Map();
    for (const v of votes) {
        const login = String(v.login || '').toLowerCase();
        // sim_* : faux viewers des outils de test, jamais comptés
        if (!LOGIN_RE.test(login) || login.startsWith('sim_')) continue;
        const e = voters.get(login) || { login, name: v.name || login, picked: false };
        if (!e.picked && isPicked(v.move)) e.picked = true;
        voters.set(login, e);
    }
    if (!voters.size) return;
    queue.push({ kind, voters: [...voters.values()], meta });
    if (queue.length >= 50) flush();
    else if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

export function flush() {
    clearTimeout(timer);
    timer = null;
    if (!queue.length || !twitchAuth.isLoggedIn) return;
    const turns = queue.splice(0, 50);
    const user = twitchAuth.user;
    fetch(API, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', ...twitchAuth.authHeaders() },
        body: JSON.stringify({ turns: turns.map(({ meta, ...t }) => t), displayName: user?.displayName, avatar: user?.avatar })
    }).then(r => r.ok ? r.json() : null).then(d => {
        (d?.credits || []).forEach((rows, i) => {
            if (!rows?.length || !turns[i]) return;
            const { kind, meta } = turns[i];
            window.dispatchEvent(new CustomEvent('coinsCredited', { detail: { kind, move: meta?.move || '', ply: meta?.ply || null, channel: user?.login || '', rows } }));
        });
        window.economy?.noteGain(d?.gain, 'turns');
    }).catch(e => console.warn('📊 Stats viewers non envoyées:', e.message));
    if (queue.length) timer = setTimeout(flush, FLUSH_MS);
}

// Page fermée ou cachée : on envoie ce qui reste
window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

const ViewerStats = { recordTurn, flush };
window.ViewerStats = ViewerStats;
export default ViewerStats;

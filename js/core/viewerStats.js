/**
 * Stats des viewers : à chaque coup joué, la liste des viewers qui ont voté
 * part au serveur (regroupée toutes les quelques secondes).
 *
 * Un viewer compte une seule fois par coup, même avec plusieurs votes.
 * « picked » : son coup a été joué (partie) ou c'était la bonne réponse (puzzle).
 * Les stats sont rangées sous la chaîne Twitch connectée : sans connexion, rien n'est envoyé.
 */
import twitchAuth from './twitchAuth.js';

const API = '/api/stats/votes';
const LOGIN_RE = /^[a-z0-9_]{1,25}$/;
const FLUSH_MS = 4000;

const queue = [];
let timer = null;

/**
 * @param {'game'|'puzzle'} kind
 * @param {Array<{login:string, name?:string, move:string}>} votes - votes du tour
 * @param {(move:string) => boolean} isPicked
 */
export function recordTurn(kind, votes, isPicked) {
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
    queue.push({ kind, voters: [...voters.values()] });
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
        body: JSON.stringify({ turns, displayName: user?.displayName, avatar: user?.avatar })
    }).catch(e => console.warn('📊 Stats viewers non envoyées:', e.message));
    if (queue.length) timer = setTimeout(flush, FLUSH_MS);
}

// Page fermée ou cachée : on envoie ce qui reste
window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

const ViewerStats = { recordTurn, flush };
window.ViewerStats = ViewerStats;
export default ViewerStats;

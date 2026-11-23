// ============================================
// API TWITCH CÔTÉ SERVEUR (jeton d'application)
// ============================================
// Clé de l'application Twitch : TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET (variables d'environnement).
// Sans secret, tout reste inactif : les appels renvoient null et l'interface se passe des photos.
//
// Photos de profil : demandées par lots (100 logins max par appel Helix), gardées en mémoire 24 h
// (6 h pour un login introuvable), et signalées aux abonnés quand elles arrivent.

const CLIENT_ID = process.env.TWITCH_CLIENT_ID || '5lgt1omtgbo8gp4bla49ktvvr7gbj3';
const SECRET = process.env.TWITCH_CLIENT_SECRET || '';
const LOGIN_RE = /^[a-z0-9_]{2,25}$/;

const OK_MS = 24 * 3600 * 1000;
const MISS_MS = 6 * 3600 * 1000;
const MAX_CACHE = 5000;

let token = null, tokenExp = 0, tokenWait = null;

/** Jeton d'application (client credentials), renouvelé une minute avant expiration */
async function appToken() {
    if (!SECRET) return null;
    if (token && Date.now() < tokenExp - 60000) return token;
    tokenWait ||= (async () => {
        try {
            const r = await fetch('https://id.twitch.tv/oauth2/token', {
                method: 'POST',
                body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: SECRET, grant_type: 'client_credentials' })
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const d = await r.json();
            token = d.access_token;
            tokenExp = Date.now() + (Number(d.expires_in) || 3600) * 1000;
            return token;
        } catch (e) {
            console.warn('🟣 Twitch : jeton d\'application refusé', e?.message || e);
            token = null;
            return null;
        } finally {
            tokenWait = null;
        }
    })();
    return tokenWait;
}

/** GET Helix avec le jeton d'application ; params peut répéter une clé (tableau de paires) */
async function helix(path, params) {
    const tok = await appToken();
    if (!tok) return null;
    const qs = new URLSearchParams(params).toString();
    const send = () => fetch(`https://api.twitch.tv/helix/${path}${qs ? `?${qs}` : ''}`, {
        headers: { Authorization: `Bearer ${tok}`, 'Client-Id': CLIENT_ID }
    });
    let r = await send();
    if (r.status === 401) { token = null; if (!(await appToken())) return null; r = await send(); }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}

// ------------------------------------------------------------ photos de profil
const avatars = new Map();   // login -> { url, at }
const queue = new Set();
const listeners = new Set();
let flushTimer = null;

function fresh(e) { return e && Date.now() - e.at < (e.url ? OK_MS : MISS_MS); }

/** URL de la photo si connue ; sinon la demande (lot différé) et renvoie null pour l'instant */
function avatar(login) {
    login = String(login || '').toLowerCase();
    if (!SECRET || !LOGIN_RE.test(login)) return null;
    const e = avatars.get(login);
    if (fresh(e)) return e.url;
    if (!queue.has(login)) {
        queue.add(login);
        flushTimer ||= setTimeout(flush, 250);
    }
    return e?.url || null;
}

async function flush() {
    flushTimer = null;
    const batch = [...queue].slice(0, 100);
    batch.forEach(l => queue.delete(l));
    if (queue.size) flushTimer = setTimeout(flush, 250);
    if (!batch.length) return;
    let found = false;
    try {
        const d = await helix('users', batch.map(l => ['login', l]));
        if (!d) return;
        const byLogin = new Map((d.data || []).map(u => [String(u.login).toLowerCase(), u.profile_image_url || null]));
        const at = Date.now();
        for (const l of batch) {
            const url = byLogin.get(l) || null;
            if (url) found = true;
            avatars.set(l, { url, at });
        }
        while (avatars.size > MAX_CACHE) avatars.delete(avatars.keys().next().value);
    } catch (e) {
        console.warn('🟣 Twitch : photos indisponibles', e?.message || e);
        return;
    }
    if (found) listeners.forEach(fn => { try { fn(); } catch {} });
}

/** Appelé quand de nouvelles photos sont arrivées */
function onAvatars(fn) { listeners.add(fn); }

module.exports = { enabled: !!SECRET, clientId: CLIENT_ID, appToken, helix, avatar, onAvatars };

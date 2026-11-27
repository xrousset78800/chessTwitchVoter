/**
 * Compte du streamer connecté : XP / niveau, pions, objets possédés (economy.js côté serveur).
 *   window.economy.account   → dernier état connu (null sans connexion)
 *   window.economy.refresh() → relit le compte
 *   window.economy.buy(id)   → achète un objet du magasin
 * Les objets possédés alimentent window.unlockedRewards (menu Pièces, js/utils/pieceSet.js).
 * Événement « economyChanged » (detail : compte) à chaque mise à jour.
 * Événement « economyGain » (detail : { gain, source }) à chaque gain signalé (bilan de fin de partie).
 */
import twitchAuth from './twitchAuth.js';

const economy = {
    account: null,

    async refresh() {
        if (!twitchAuth.isLoggedIn) return this._set(null);
        try {
            const r = await fetch('/api/economy/me', { headers: twitchAuth.authHeaders() });
            if (r.ok) this._set(await r.json());
        } catch (e) {
            console.warn('🪙 Compte non chargé:', e.message);
        }
        return this.account;
    },

    async buy(item) {
        const r = await fetch('/api/economy/buy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...twitchAuth.authHeaders() },
            body: JSON.stringify({ item })
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status, data });
        return this._set(data);
    },

    /** Gain renvoyé par le serveur (fin de run, coups…) : on relit le compte. source : turns, rush, predictMove… */
    noteGain(gain, source = 'other') {
        if (!gain || !(gain.xp || gain.coins || gain.daily || gain.achievements?.length)) return;
        window.dispatchEvent(new CustomEvent('economyGain', { detail: { gain, source } }));
        this.refresh();
    },

    _set(account) {
        this.account = account;
        window.unlockedRewards = new Set(account?.owned || []);
        window.dispatchEvent(new CustomEvent('economyChanged', { detail: account }));
        return account;
    }
};

window.economy = economy;
window.addEventListener('twitchAuthChange', () => economy.refresh());
economy.refresh();

export default economy;

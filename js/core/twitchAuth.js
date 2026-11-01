/**
 * PHANTOM TWITCHESS - Twitch Auth
 * Connexion Twitch via OAuth "implicit grant" (100 % navigateur, sans secret).
 *
 * Flux :
 *  1. login()          → redirection vers id.twitch.tv (scope : lecture des followers)
 *  2. Twitch redirige vers l'app avec #access_token=... dans le fragment
 *  3. init()           → récupère le token, le valide, restaure la route d'avant
 *  4. validate()       → appelé à l'init puis toutes les heures (exigence Twitch)
 *
 * Le login Twitch de l'utilisateur devient la chaîne de référence de l'application
 * (chat rejoint automatiquement, identité pour les records côté serveur).
 */

const TWITCH_CLIENT_ID = '5lgt1omtgbo8gp4bla49ktvvr7gbj3';
const AUTH_BASE        = 'https://id.twitch.tv/oauth2';
const HELIX_BASE       = 'https://api.twitch.tv/helix';
const FOLLOWERS_SCOPE  = 'moderator:read:followers'; // option "Followers only"
const STORAGE_KEY      = 'twitchess_auth';
const RETURN_KEY       = 'twitchess_auth_return';
const STATE_KEY        = 'twitchess_auth_state';
const SWITCH_KEY       = 'twitchess_auth_switch'; // posé au logout : prochain login = choix du compte
const VALIDATE_EVERY   = 60 * 60 * 1000; // 1 h

class TwitchAuth {
    constructor() {
        this.clientId = TWITCH_CLIENT_ID;
        this.session  = null;   // { token, login, userId, displayName, avatar, expiresAt, scopes }
        this._validateTimer = null;
    }

    // ========== GETTERS ==========

    /** Utilisateur connecté ou null */
    get user() {
        return this.session ? {
            login:       this.session.login,
            userId:      this.session.userId,
            displayName: this.session.displayName || this.session.login,
            avatar:      this.session.avatar || null
        } : null;
    }

    get token() {
        return this.session?.token || null;
    }

    get isLoggedIn() {
        return !!this.session;
    }

    /** false pour un token obtenu avant l'ajout du scope : il faut se reconnecter */
    get canCheckFollowers() {
        return !!this.session?.scopes?.includes(FOLLOWERS_SCOPE);
    }

    /** URL de retour enregistrée dans la console Twitch (ex: http://localhost:3000/) */
    get redirectUri() {
        const path = window.location.pathname.replace(/index\.html$/, '');
        return window.location.origin + path;
    }

    // ========== INIT ==========

    /**
     * À appeler avant le Router : traite un éventuel retour OAuth
     * puis restaure la session sauvegardée.
     */
    async init() {
        const handled = await this._handleRedirect();
        if (handled) return;

        this._load();
        if (!this.session) return;

        if (this.session.expiresAt && this.session.expiresAt <= Date.now()) {
            this._clear('expired');
            return;
        }

        const ok = await this.validate();
        if (ok) this._scheduleValidation();
    }

    // ========== LOGIN / LOGOUT ==========

    /**
     * Redirige vers Twitch. Ne retourne jamais (la page change).
     * @param {object}  [opts]
     * @param {boolean} [opts.forceVerify] Toujours afficher la page Twitch (permet de
     *   changer de compte via « Pas vous ? »). Automatique après une déconnexion.
     */
    login(opts = {}) {
        const state = (window.crypto?.randomUUID?.() || String(Math.random()).slice(2));
        let forceVerify = !!opts.forceVerify;
        try {
            sessionStorage.setItem(STATE_KEY, state);
            sessionStorage.setItem(RETURN_KEY, window.location.hash || '#/');
            if (localStorage.getItem(SWITCH_KEY)) {
                forceVerify = true;
                localStorage.removeItem(SWITCH_KEY);
            }
        } catch {}

        const params = new URLSearchParams({
            response_type: 'token',
            client_id:     this.clientId,
            redirect_uri:  this.redirectUri,
            scope:         FOLLOWERS_SCOPE,
            state
        });
        // Sans ce paramètre, Twitch réutilise silencieusement le compte de sa propre
        // session navigateur : impossible de changer de compte.
        if (forceVerify) params.set('force_verify', 'true');
        window.location.assign(`${AUTH_BASE}/authorize?${params}`);
    }

    /** Révoque le token côté Twitch et oublie la session. */
    async logout() {
        const token = this.token;
        try { localStorage.setItem(SWITCH_KEY, '1'); } catch {}
        this._clear('logout');
        if (!token) return;
        try {
            await fetch(`${AUTH_BASE}/revoke`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ client_id: this.clientId, token })
            });
        } catch (e) {
            console.warn('🟣 [Auth] Révocation impossible:', e.message);
        }
    }

    // ========== VALIDATION ==========

    /**
     * Vérifie le token auprès de Twitch. Met à jour login/userId/expiresAt.
     * Retourne false (et purge la session) si le token n'est plus valide.
     */
    async validate() {
        if (!this.token) return false;
        try {
            const r = await fetch(`${AUTH_BASE}/validate`, {
                headers: { Authorization: `OAuth ${this.token}` }
            });
            if (r.status === 401) {
                this._clear('expired');
                return false;
            }
            if (!r.ok) throw new Error(`HTTP ${r.status}`);

            const data = await r.json();
            if (data.client_id !== this.clientId) {
                this._clear('expired');
                return false;
            }

            this.session.login     = data.login;
            this.session.userId    = data.user_id;
            this.session.expiresAt = Date.now() + (data.expires_in * 1000);
            this.session.scopes    = data.scopes || [];
            this._save();
            return true;
        } catch (e) {
            // Erreur réseau : on garde la session, on réessaiera
            console.warn('🟣 [Auth] Validation impossible:', e.message);
            return !!this.session;
        }
    }

    _scheduleValidation() {
        clearInterval(this._validateTimer);
        this._validateTimer = setInterval(() => this.validate(), VALIDATE_EVERY);
    }

    // ========== RETOUR OAUTH ==========

    /**
     * Détecte un retour de Twitch (#access_token=... ou ?error=...).
     * Retourne true si l'URL a été consommée.
     */
    async _handleRedirect() {
        const hash   = window.location.hash.slice(1);
        const search = new URLSearchParams(window.location.search);

        let expectedState = null, returnHash = '#/';
        try {
            expectedState = sessionStorage.getItem(STATE_KEY);
            returnHash    = sessionStorage.getItem(RETURN_KEY) || '#/';
        } catch {}

        // --- Erreur renvoyée par Twitch (query string) ---
        if (search.get('error')) {
            const description = search.get('error_description') || search.get('error');
            this._cleanupRedirect(returnHash, search);
            this._emit('error', { error: description.replace(/\+/g, ' ') });
            return true;
        }

        // --- Succès : token dans le fragment ---
        if (!hash.includes('access_token=')) return false;

        const frag  = new URLSearchParams(hash);
        const token = frag.get('access_token');
        const state = frag.get('state');

        this._cleanupRedirect(returnHash, search);

        if (expectedState && state !== expectedState) {
            this._emit('error', { error: 'État OAuth invalide (state)' });
            return true;
        }

        this.session = { token, login: null, userId: null, displayName: null, avatar: null, expiresAt: null };
        const ok = await this.validate();
        if (!ok) {
            this._emit('error', { error: 'Token Twitch invalide' });
            return true;
        }

        await this._fetchProfile();
        this._save();
        this._scheduleValidation();
        this._emit('login');
        return true;
    }

    /** Remet l'URL propre : plus de token dans l'historique, route d'origine restaurée */
    _cleanupRedirect(returnHash, search) {
        try {
            sessionStorage.removeItem(STATE_KEY);
            sessionStorage.removeItem(RETURN_KEY);
        } catch {}
        ['error', 'error_description', 'state'].forEach(k => search.delete(k));
        const qs = search.toString();
        const url = window.location.pathname + (qs ? `?${qs}` : '') + returnHash;
        window.history.replaceState(null, '', url);
    }

    // ========== PROFIL (nom affiché, avatar) ==========

    async _fetchProfile() {
        try {
            const r = await fetch(`${HELIX_BASE}/users`, {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Client-Id':   this.clientId
                }
            });
            if (!r.ok) return;
            const { data } = await r.json();
            const me = data?.[0];
            if (!me) return;
            this.session.displayName = me.display_name;
            this.session.avatar      = me.profile_image_url;
        } catch (e) {
            console.warn('🟣 [Auth] Profil indisponible:', e.message);
        }
    }

    // ========== FOLLOWERS ==========

    /** Ce compte Twitch suit-il la chaîne connectée ? Lève une erreur si Twitch ne répond pas. */
    async isFollower(userId) {
        const params = new URLSearchParams({ broadcaster_id: this.session.userId, user_id: userId });
        const r = await fetch(`${HELIX_BASE}/channels/followers?${params}`, {
            headers: {
                Authorization: `Bearer ${this.token}`,
                'Client-Id':   this.clientId
            }
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const { data } = await r.json();
        return data.length > 0;
    }

    /** En-têtes prêts à l'emploi pour appeler notre serveur avec l'identité Twitch */
    authHeaders() {
        return this.token ? { Authorization: `Bearer ${this.token}` } : {};
    }

    // ========== PERSISTANCE ==========

    _save() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.session)); } catch {}
    }

    _load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            this.session = raw ? JSON.parse(raw) : null;
            if (this.session && !this.session.token) this.session = null;
        } catch {
            this.session = null;
        }
    }

    _clear(reason) {
        const hadSession = !!this.session;
        this.session = null;
        clearInterval(this._validateTimer);
        try { localStorage.removeItem(STORAGE_KEY); } catch {}
        if (hadSession) this._emit(reason);
    }

    _emit(reason, extra = {}) {
        window.dispatchEvent(new CustomEvent('twitchAuthChange', {
            detail: { reason, user: this.user, ...extra }
        }));
    }
}

// ========== INSTANCE GLOBALE ==========
window.twitchAuth = new TwitchAuth();

export default window.twitchAuth;

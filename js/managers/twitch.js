/**
 * PHANTOM TWITCHESS - Twitch Manager v3
 * Connexion au chat Twitch (lecture des votes) via tmi.js
 *
 * L'identité vient de twitchAuth (OAuth) : par défaut on rejoint le chat
 * de l'utilisateur connecté. Un channel explicite reste possible
 * (mode Bataille : l'hôte rejoint aussi le chat de l'adversaire).
 */

import twitchAuth from '../core/twitchAuth.js';

class TwitchManager {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.channel = null;
        this.linkedChannels = new Set();

        // Settings
        this.settings = {
            followersOnly: false,
            subsOnly: false,
            autoReconnect: true
        };

        // État de connexion
        this.connectionState = 'disconnected'; // disconnected, connecting, connected, error
        this.lastError = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;

        // Callbacks
        this.onConnectionChange = null;
        this.onMessage = null;
        this.onVote = null;
        this.onStateChange = null;

        this.handleMessage = this.handleMessage.bind(this);
    }

    // ========== CONNECTION STATE ==========

    setState(state, error = null) {
        this.connectionState = state;
        this.lastError = error;

        this.updateUI();

        if (this.onStateChange) {
            this.onStateChange({
                state,
                error,
                channel: this.channel,
                linkedChannels: Array.from(this.linkedChannels)
            });
        }

        window.dispatchEvent(new CustomEvent('twitchStateChange', {
            detail: { state, error, channel: this.channel }
        }));
    }

    // ========== UI UPDATES ==========

    updateUI() {
        const user = twitchAuth.user;

        document.querySelectorAll('.status-dot--twitch').forEach(dot => {
            dot.classList.remove('is-connecting', 'is-connected', 'is-error');
            switch (this.connectionState) {
                case 'connecting': dot.classList.add('is-connecting'); break;
                case 'connected':  dot.classList.add('is-connected');  break;
                case 'error':      dot.classList.add('is-error');      break;
            }
        });

        document.querySelectorAll('[data-twitch-status]').forEach(el => {
            switch (this.connectionState) {
                case 'disconnected':
                    el.textContent = user
                        ? user.displayName
                        : (el.dataset.textDisconnected || 'Non connecté');
                    break;
                case 'connecting':
                    el.textContent = el.dataset.textConnecting || 'Connexion...';
                    break;
                case 'connected':
                    el.textContent = this.channel ? `#${this.channel}` : 'Connecté';
                    break;
                case 'error':
                    el.textContent = el.dataset.textError || 'Erreur';
                    break;
            }
        });

        document.querySelectorAll('[data-action="connect-twitch"]').forEach(btn => {
            btn.classList.toggle('is-connected', this.connectionState === 'connected');
            btn.classList.toggle('is-logged', !!user);
            btn.disabled = this.connectionState === 'connecting';

            // Les badges de la nav gardent leur markup (dot + texte)
            if (btn.classList.contains('nav__status-badge')) return;

            const avatar = user?.avatar
                ? `<img class="twitch-avatar" src="${user.avatar}" alt="">`
                : `<i class="fab fa-twitch"></i>`;

            if (this.connectionState === 'connecting') {
                btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Connexion...`;
            } else if (user) {
                const chat = this.connectionState === 'connected' ? ` · #${this.channel}` : '';
                btn.innerHTML = `${avatar} ${user.displayName}${chat} <span class="twitch-logout">Déconnexion</span>`;
            } else {
                btn.innerHTML = `<i class="fab fa-twitch"></i> Se connecter avec Twitch`;
            }
        });
    }

    // ========== CONNECTION ==========

    /**
     * Rejoint un chat Twitch. Sans argument : le chat de l'utilisateur connecté.
     */
    async connect(channel = null, options = {}) {
        if (!channel) channel = twitchAuth.user?.login;
        if (!channel) throw new Error('Non authentifié');

        channel = channel.toLowerCase().replace(/[^a-z0-9_]/g, '').trim();
        if (!channel || channel.length < 2) {
            throw new Error('Nom de channel invalide');
        }

        if (this.isConnected && this.channel === channel) {
            this.log(`Déjà connecté à #${channel}`);
            return true;
        }

        if (this.isConnected) {
            await this.disconnect();
        }

        this.setState('connecting');

        try {
            this.log(`🔍 Connexion à #${channel}...`);

            this.client = new tmi.Client({
                options: { debug: false },
                connection: { secure: true, reconnect: true },
                identity: options.identity || undefined,
                channels: [channel]
            });

            this.setupEventHandlers(channel);
            await this.client.connect();
            return true;

        } catch (error) {
            this.log(`❌ Erreur: ${error.message}`, 'error');
            this.setState('error', error.message);
            throw error;
        }
    }

    setupEventHandlers(channel) {
        this.client.on('connected', () => {
            this.log(`✅ Connecté à #${channel}`);
            this.isConnected = true;
            this.channel = channel;
            this.reconnectAttempts = 0;

            this.setState('connected');

            if (this.onConnectionChange) this.onConnectionChange(true);

            window.dispatchEvent(new CustomEvent('twitchConnected', { detail: { channel } }));
        });

        this.client.on('disconnected', (reason) => {
            this.log(`🔌 Déconnecté: ${reason}`);
            this.handleDisconnect(reason);
        });

        this.client.on('message', (channel, tags, message, self) => {
            if (self) return;
            this.handleMessage(channel, tags, message);
        });

        this.client.on('reconnect', () => {
            this.log('🔄 Reconnexion en cours...');
            this.setState('connecting');
        });
    }

    handleDisconnect(reason) {
        this.isConnected = false;

        if (this.onConnectionChange) this.onConnectionChange(false);

        if (this.settings.autoReconnect &&
            this.reconnectAttempts < this.maxReconnectAttempts &&
            this.channel) {

            this.reconnectAttempts++;
            this.setState('connecting');
            this.log(`🔄 Tentative de reconnexion ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);

            setTimeout(() => {
                this.connect(this.channel).catch(err => {
                    this.log(`❌ Reconnexion échouée: ${err.message}`, 'error');
                });
            }, 2000 * this.reconnectAttempts);

        } else {
            this.setState('disconnected');
            this.channel = null;
        }
    }

    // ========== MULTI-CHANNEL (Chat vs Chat) ==========

    async joinChannel(channel) {
        if (!this.client || !this.isConnected) {
            throw new Error('Non connecté au client principal');
        }

        channel = channel.toLowerCase().replace(/[^a-z0-9_]/g, '').trim();

        if (this.linkedChannels.has(channel)) {
            this.log(`Déjà connecté à #${channel}`);
            return true;
        }

        try {
            await this.client.join(channel);
            this.linkedChannels.add(channel);
            this.log(`✅ Rejoint #${channel}`);
            window.dispatchEvent(new CustomEvent('twitchChannelJoined', { detail: { channel } }));
            return true;
        } catch (error) {
            this.log(`❌ Erreur join #${channel}: ${error.message}`, 'error');
            throw error;
        }
    }

    async leaveChannel(channel) {
        if (!this.client || !this.isConnected) return;

        channel = channel.toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (!this.linkedChannels.has(channel)) return;

        try {
            await this.client.part(channel);
            this.linkedChannels.delete(channel);
            this.log(`👋 Quitté #${channel}`);
        } catch (error) {
            this.log(`Erreur leave #${channel}: ${error.message}`, 'error');
        }
    }

    // ========== MESSAGE HANDLING ==========

    handleMessage(channel, tags, message) {
        const channelName = channel.replace('#', '');

        if (this.onMessage) {
            this.onMessage({
                channel: channelName,
                username: tags.username,
                displayName: tags['display-name'] || tags.username,
                message: message,
                tags: tags,
                isMod: tags.mod || tags.badges?.moderator,
                isVip: tags.badges?.vip,
                isSub: tags.subscriber,
                isBroadcaster: tags.badges?.broadcaster
            });
        }

        const vote = this.parseChessMove(message);
        if (vote && this.onVote && this.checkVoteEligibility(tags)) {
            this.onVote({
                channel: channelName,
                username: tags.username,
                displayName: tags['display-name'] || tags.username,
                move: vote,
                tags: tags
            });
        }
    }

    parseChessMove(message) {
        // On conserve le texte tel que tapé ("Kh1", "e2-e4", "o-o") :
        // la résolution contre les coups légaux (utils/moveMatch.js) gère la casse.
        const raw   = message.trim();
        const clean = raw.toLowerCase();

        const patterns = [
            // SAN: e4, Nf3, Qxd5, O-O, etc.
            /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h])([1-8])(=[QRBN])?(\+|#)?$/i,
            // Roque
            /^(o-o-o|o-o|0-0-0|0-0)$/i,
            // UCI: e2e4, e2-e4
            /^([a-h])([1-8])-?([a-h])([1-8])(=[qrbn])?$/i
        ];

        for (const pattern of patterns) {
            if (pattern.test(clean)) {
                return raw;
            }
        }
        return null;
    }

    checkVoteEligibility(tags) {
        // Toujours autoriser: broadcaster, mods, VIPs
        if (tags.badges?.broadcaster || tags.mod || tags.badges?.vip) {
            return true;
        }

        // Followers only : tmi.js ne fournit pas le statut follower. Les routes à
        // inscription le vérifient à l'inscription (PresetGame.verifyFollower), ailleurs
        // on s'appuie sur le mode followers de Twitch côté chat.

        if (this.settings.subsOnly && !tags.subscriber) {
            return false;
        }

        return true;
    }

    // ========== UTILITY ==========

    /** Quitte le chat (la session OAuth reste active) */
    async disconnect() {
        this.settings.autoReconnect = false;

        if (this.client) {
            try { await this.client.disconnect(); } catch {}
            this.client = null;
        }

        this.isConnected = false;
        this.channel = null;
        this.linkedChannels.clear();
        this.setState('disconnected');

        this.settings.autoReconnect = true;

        window.dispatchEvent(new Event('twitchDisconnected'));
    }

    /** Quitte le chat ET révoque la session Twitch */
    async logout() {
        await this.disconnect();
        await twitchAuth.logout();
        this.updateUI();
    }

    async say(message, channel = null) {
        if (!this.client || !this.isConnected) return false;
        try {
            await this.client.say(channel || this.channel, message);
            return true;
        } catch (error) {
            this.log(`Erreur envoi: ${error.message}`, 'error');
            return false;
        }
    }

    /**
     * Au chargement : si une session Twitch existe, rejoindre son propre chat.
     */
    async restore() {
        this.updateUI();
        const login = twitchAuth.user?.login;
        if (!login) return false;
        try {
            await this.connect(login);
            return true;
        } catch {
            this.log('Impossible de restaurer la connexion au chat');
            return false;
        }
    }

    log(message, level = 'info') {
        const prefix = '🟣 [Twitch]';
        switch (level) {
            case 'error': console.error(prefix, message); break;
            case 'warn':  console.warn(prefix, message);  break;
            default:      console.log(prefix, message);
        }
    }

    getStatus() {
        return {
            state: this.connectionState,
            isConnected: this.isConnected,
            channel: this.channel,
            linkedChannels: Array.from(this.linkedChannels),
            user: twitchAuth.user,
            error: this.lastError
        };
    }
}

// ========== INSTANCE GLOBALE ==========
window.twitch = new TwitchManager();

export default window.twitch;

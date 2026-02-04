/**
 * PHANTOM TWITCHESS - Twitch Manager
 * Gestion de la connexion Twitch via TMI.js
 */

class TwitchManager {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.channel = null;
        this.linkedChannels = [];
        
        // Settings
        this.settings = {
            followersOnly: false,
            subsOnly: false
        };

        // Callbacks
        this.onConnectionChange = null;
        this.onMessage = null;
        this.onVote = null;
    }

    /**
     * Connexion à un channel Twitch
     */
    async connect(channel, options = {}) {
        if (!channel) {
            throw new Error('Channel required');
        }

        // Nettoyer le nom du channel
        channel = channel.toLowerCase().replace('#', '').trim();
        
        if (!channel) {
            throw new Error('Invalid channel name');
        }

        try {
            // Créer le client TMI.js
            this.client = new tmi.Client({
                options: { debug: false },
                connection: {
                    secure: true,
                    reconnect: true
                },
                identity: options.identity || undefined,
                channels: [channel]
            });

            // Event handlers
            this.client.on('connected', (addr, port) => {
                this.log(`✅ Connecté à ${channel}`);
                this.isConnected = true;
                this.channel = channel;
                
                window.storage?.set('twitch_channel', channel);
                
                if (this.onConnectionChange) this.onConnectionChange(true);
                window.dispatchEvent(new CustomEvent('twitchConnected', { detail: { channel } }));
            });

            this.client.on('disconnected', (reason) => {
                this.log(`🔌 Déconnecté: ${reason}`);
                this.handleDisconnect();
            });

            this.client.on('message', (channel, tags, message, self) => {
                if (self) return; // Ignorer nos propres messages
                this.handleMessage(channel, tags, message);
            });

            // Connexion
            await this.client.connect();
            
            return true;
        } catch (error) {
            this.log(`❌ Erreur: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Ajouter un channel supplémentaire (pour Chat vs Chat)
     */
    async joinChannel(channel) {
        if (!this.client || !this.isConnected) {
            throw new Error('Not connected');
        }

        channel = channel.toLowerCase().replace('#', '').trim();
        
        if (this.linkedChannels.includes(channel)) {
            return true; // Déjà connecté
        }

        try {
            await this.client.join(channel);
            this.linkedChannels.push(channel);
            this.log(`✅ Rejoint #${channel}`);
            return true;
        } catch (error) {
            this.log(`❌ Erreur join ${channel}: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Quitter un channel
     */
    async leaveChannel(channel) {
        if (!this.client) return;

        channel = channel.toLowerCase().replace('#', '').trim();

        try {
            await this.client.part(channel);
            this.linkedChannels = this.linkedChannels.filter(c => c !== channel);
            this.log(`👋 Quitté #${channel}`);
        } catch (error) {
            this.log(`Erreur leave ${channel}: ${error.message}`, 'warn');
        }
    }

    /**
     * Déconnexion
     */
    async disconnect() {
        if (this.client) {
            try {
                await this.client.disconnect();
            } catch (e) {
                // Ignore
            }
        }
        this.handleDisconnect();
    }

    /**
     * Gestion de la déconnexion
     */
    handleDisconnect() {
        this.isConnected = false;
        this.channel = null;
        this.linkedChannels = [];
        
        window.storage?.remove('twitch_channel');
        
        if (this.onConnectionChange) this.onConnectionChange(false);
        window.dispatchEvent(new CustomEvent('twitchDisconnected'));
    }

    /**
     * Gestion des messages
     */
    handleMessage(channel, tags, message) {
        const channelName = channel.replace('#', '').toLowerCase();
        
        // Créer un objet contexte enrichi
        const context = {
            channel: channelName,
            username: tags.username,
            displayName: tags['display-name'] || tags.username,
            userId: tags['user-id'],
            isMod: tags.mod,
            isVIP: tags.badges?.vip === '1',
            isSub: tags.subscriber,
            isBroadcaster: tags.badges?.broadcaster === '1',
            message: message.trim(),
            raw: tags
        };

        // Vérifier les restrictions
        if (!this.checkPermissions(context)) {
            return;
        }

        // Callback général
        if (this.onMessage) {
            this.onMessage(context);
        }

        // Vérifier si c'est un vote (coup d'échecs)
        const vote = this.parseVote(context.message);
        if (vote && this.onVote) {
            this.onVote({
                ...context,
                move: vote
            });
        }
    }

    /**
     * Vérifie les permissions du viewer
     */
    checkPermissions(context) {
        // Broadcaster, mods et VIPs passent toujours
        if (context.isBroadcaster || context.isMod || context.isVIP) {
            return true;
        }

        // Mode abonnés uniquement
        if (this.settings.subsOnly && !context.isSub) {
            return false;
        }

        // Mode followers uniquement (nécessite l'API Twitch pour vérifier)
        // Pour l'instant, on laisse passer si followersOnly est activé
        // car TMI.js ne fournit pas cette info directement
        
        return true;
    }

    /**
     * Parse un message pour détecter un coup d'échecs
     */
    parseVote(message) {
        // Nettoyer le message
        const clean = message.toLowerCase().trim();
        
        // Patterns de coups d'échecs
        const patterns = [
            // Format standard: e4, Nf3, Bxc6, O-O, etc.
            /^([kqrbnp])?([a-h])?([1-8])?(x)?([a-h])([1-8])(=[qrbn])?(\+|#)?$/i,
            // Roque
            /^(o-o-o|o-o|0-0-0|0-0)$/i,
            // Format simple: e2e4, e2-e4
            /^([a-h])([1-8])-?([a-h])([1-8])(=[qrbn])?$/i
        ];

        for (const pattern of patterns) {
            if (pattern.test(clean)) {
                return clean;
            }
        }

        return null;
    }

    /**
     * Envoyer un message dans le chat
     */
    async say(message, channel = null) {
        if (!this.client || !this.isConnected) return false;
        
        try {
            await this.client.say(channel || this.channel, message);
            return true;
        } catch (error) {
            this.log(`Erreur envoi message: ${error.message}`, 'error');
            return false;
        }
    }

    /**
     * Restaurer une connexion précédente
     */
    async restore() {
        const savedChannel = window.storage?.get('twitch_channel');
        if (savedChannel) {
            try {
                await this.connect(savedChannel);
                return true;
            } catch (e) {
                this.log('Impossible de restaurer la connexion Twitch');
                return false;
            }
        }
        return false;
    }

    /**
     * Log avec préfixe
     */
    log(message, level = 'info') {
        const prefix = '[Twitch]';
        switch (level) {
            case 'error':
                console.error(prefix, message);
                break;
            case 'warn':
                console.warn(prefix, message);
                break;
            default:
                console.log(prefix, message);
        }
    }
}

// Create global instance
window.twitch = new TwitchManager();

export default window.twitch;

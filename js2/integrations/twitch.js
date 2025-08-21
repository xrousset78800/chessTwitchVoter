/**
 * TWITCH.JS - Intégration Twitch avec TMI.js
 */

export class TwitchClient {
    constructor(channel) {
        this.channel = channel;
        this.client = null;
        this.connected = false;
        this.username = null;
        this.oauth = null;
        
        // Callbacks
        this.onMessage = null;
        this.onConnect = null;
        this.onDisconnect = null;
        
        // Stats
        this.messageCount = 0;
        this.uniqueUsers = new Set();
    }

    /**
     * Se connecte à Twitch
     */
    async connect() {
        // Vérifier si tmi.js est chargé
        if (typeof window.tmi === 'undefined') {
            console.error('tmi.js n\'est pas chargé');
            return false;
        }
        
        // Récupérer les credentials
        this.username = window.TWITCH_USERNAME || 'justinfan' + Math.floor(Math.random() * 100000);
        this.oauth = window.TWITCH_OAUTH || '';
        
        // Configuration du client
        const options = {
            options: {
                debug: true,
                messagesLogLevel: 'info'
            },
            connection: {
                reconnect: true,
                secure: true
            },
            channels: [this.channel]
        };
        
        // Ajouter l'identité si on a les credentials
        if (this.oauth) {
            options.identity = {
                username: this.username,
                password: this.oauth
            };
        }
        
        // Créer le client
        this.client = new window.tmi.Client(options);
        
        // Attacher les événements
        this.attachEvents();
        
        try {
            // Se connecter
            await this.client.connect();
            this.connected = true;
            console.log(`✅ Connecté à Twitch (canal: ${this.channel})`);
            
            if (this.onConnect) {
                this.onConnect();
            }
            
            return true;
        } catch (error) {
            console.error('❌ Erreur de connexion Twitch:', error);
            this.connected = false;
            return false;
        }
    }

    /**
     * Attache les événements
     */
    attachEvents() {
        if (!this.client) return;
        
        // Message reçu
        this.client.on('message', (channel, tags, message, self) => {
            // Ignorer ses propres messages
            if (self) return;
            
            this.messageCount++;
            this.uniqueUsers.add(tags.username);
            
            // Parser pour les commandes
            this.handleMessage(channel, tags, message);
            
            // Callback custom
            if (this.onMessage) {
                this.onMessage(channel, tags, message, self);
            }
        });
        
        // Connexion établie
        this.client.on('connected', (addr, port) => {
            console.log(`Connecté à ${addr}:${port}`);
            this.connected = true;
        });
        
        // Déconnexion
        this.client.on('disconnected', (reason) => {
            console.log('Déconnecté de Twitch:', reason);
            this.connected = false;
            
            if (this.onDisconnect) {
                this.onDisconnect(reason);
            }
        });
        
        // Rejoindre un canal
        this.client.on('join', (channel, username, self) => {
            if (self) {
                console.log(`Rejoint le canal ${channel}`);
            }
        });
        
        // Quitter un canal
        this.client.on('part', (channel, username, self) => {
            if (self) {
                console.log(`Quitté le canal ${channel}`);
            }
        });
    }

    /**
     * Gère un message
     */
    handleMessage(channel, tags, message) {
        const trimmed = message.trim().toLowerCase();
        
        // Commandes de vote
        if (trimmed.startsWith('!vote') || trimmed.startsWith('!v')) {
            this.handleVoteCommand(tags, message);
        }
        
        // Commande d'aide
        else if (trimmed === '!help' || trimmed === '!aide') {
            this.sendHelp(tags.username);
        }
        
        // Commande de position
        else if (trimmed === '!position' || trimmed === '!pos') {
            this.sendPosition();
        }
        
        // Commande de coups possibles
        else if (trimmed === '!moves' || trimmed === '!coups') {
            this.sendMoves();
        }
        
        // Vérifier si c'est un vote direct (numéro ou notation)
        else if (/^\d+$/.test(trimmed) || /^[a-h][1-8]/.test(trimmed)) {
            this.handleVoteCommand(tags, message);
        }
    }

    /**
     * Gère une commande de vote
     */
    handleVoteCommand(tags, message) {
        // Émettre l'événement de vote
        window.dispatchEvent(new CustomEvent('twitchess:vote', {
            detail: {
                voter: tags.username,
                move: message.replace(/^!v(ote)?\s*/i, '').trim(),
                displayName: tags['display-name'] || tags.username,
                subscriber: tags.subscriber,
                mod: tags.mod,
                vip: tags.vip
            }
        }));
    }

    /**
     * Envoie un message
     */
    say(message) {
        if (!this.connected || !this.client) {
            console.warn('Client Twitch non connecté');
            return;
        }
        
        this.client.say(this.channel, message).catch(console.error);
    }

    /**
     * Envoie l'aide
     */
    sendHelp(username) {
        this.say(`@${username} Commandes: !vote [coup] ou tapez directement le numéro du coup. Ex: !`);
        }
}
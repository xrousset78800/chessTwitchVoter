/**
 * CONFIG.JS - Gestion centralisée de la configuration
 */

export class Config {
    constructor() {
        // Configuration par défaut
        this.defaults = {
            // ========== Mode de jeu ==========
            gameMode: 'solo', // solo, twitch, multiplayer
            difficulty: 'medium', // easy, medium, hard, expert
            
            // ========== Timer ==========
            timerEnabled: true,
            timePerMove: 30, // secondes
            totalGameTime: 600, // secondes (10 minutes)
            incrementPerMove: 0, // secondes
            
            // ========== Votes ==========
            votingEnabled: false,
            votingOnly: false, // Si true, seuls les votes peuvent jouer
            votingTime: 20, // secondes
            minVotesToPlay: 1,
            showVotesLive: true,
            allowMultipleVotes: false,
            
            // ========== Twitch ==========
            twitchEnabled: false,
            twitchChannel: '',
            twitchUsername: '',
            twitchOAuth: '',
            twitchCommands: {
                vote: '!vote',
                help: '!help',
                moves: '!moves',
                position: '!position'
            },
            
            // ========== Multijoueur ==========
            multiplayerEnabled: false,
            serverUrl: 'ws://localhost:3000',
            playerName: 'Joueur',
            roomCode: '',
            isHost: false,
            
            // ========== Affichage ==========
            boardTheme: 'default',
            pieceTheme: 'default',
            boardSize: 630,
            showNotation: true,
            showHighlights: true,
            showLegalMoves: true,
            showLastMove: true,
            showThreats: false,
            soundEnabled: true,
            animationSpeed: 'normal', // slow, normal, fast, none
            
            // ========== Problèmes ==========
            problemsEnabled: false,
            problemsFile: 'lichess_db_puzzle.csv',
            problemThemes: [],
            problemDifficulty: 'all',
            problemTimeLimit: 60,
            
            // ========== Analyse ==========
            analysisEnabled: false,
            engineDepth: 15,
            showEvaluation: true,
            showBestMove: true,
            showThreats: false,
            
            // ========== Phantom ==========
            phantomEnabled: true,
            phantomDuration: 3000,
            phantomStyle: 'slide', // slide, fade, bounce
            
            // ========== Historique ==========
            saveHistory: true,
            maxHistorySize: 100,
            exportFormat: 'pgn', // pgn, fen, json
            
            // ========== Interface ==========
            language: 'fr-FR', // fr-FR, en-US, es-ES
            theme: 'dark', // dark, light, auto
            fontSize: 'medium', // small, medium, large
            compactMode: false,
            
            // ========== Debug ==========
            debugMode: false,
            logLevel: 'info', // error, warn, info, debug
            showFPS: false,
            showPerformance: false
        };
        
        // Configuration actuelle (merge avec localStorage)
        this.config = { ...this.defaults };
        this.loadFromStorage();
        
        // Observers pour les changements
        this.observers = new Map();
    }

    /**
     * Obtient une valeur de configuration
     */
    get(key) {
        // Support de la notation pointée (ex: 'twitch.channel')
        const keys = key.split('.');
        let value = this.config;
        
        for (const k of keys) {
            if (value && typeof value === 'object') {
                value = value[k];
            } else {
                return undefined;
            }
        }
        
        return value;
    }

    /**
     * Définit une valeur de configuration
     */
    set(key, value) {
        const keys = key.split('.');
        const lastKey = keys.pop();
        
        let target = this.config;
        for (const k of keys) {
            if (!target[k] || typeof target[k] !== 'object') {
                target[k] = {};
            }
            target = target[k];
        }
        
        const oldValue = target[lastKey];
        target[lastKey] = value;
        
        // Sauvegarder
        this.saveToStorage();
        
        // Notifier les observers
        this.notifyObservers(key, value, oldValue);
        
        return this;
    }

    /**
     * Met à jour plusieurs valeurs
     */
    update(updates) {
        Object.entries(updates).forEach(([key, value]) => {
            this.set(key, value);
        });
        return this;
    }

    /**
     * Obtient toute la configuration
     */
    getAll() {
        return { ...this.config };
    }

    /**
     * Réinitialise une valeur ou toute la config
     */
    reset(key = null) {
        if (key) {
            const keys = key.split('.');
            const lastKey = keys.pop();
            
            let defaultValue = this.defaults;
            let target = this.config;
            
            for (const k of keys) {
                defaultValue = defaultValue[k];
                target = target[k];
            }
            
            if (defaultValue && lastKey in defaultValue) {
                target[lastKey] = defaultValue[lastKey];
            }
        } else {
            this.config = { ...this.defaults };
        }
        
        this.saveToStorage();
        return this;
    }

    /**
     * Observe les changements d'une clé
     */
    observe(key, callback) {
        if (!this.observers.has(key)) {
            this.observers.set(key, new Set());
        }
        this.observers.get(key).add(callback);
        
        // Retourne une fonction pour se désabonner
        return () => {
            const callbacks = this.observers.get(key);
            if (callbacks) {
                callbacks.delete(callback);
                if (callbacks.size === 0) {
                    this.observers.delete(key);
                }
            }
        };
    }

    /**
     * Notifie les observers
     */
    notifyObservers(key, newValue, oldValue) {
        // Notifier les observers exacts
        const callbacks = this.observers.get(key);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(newValue, oldValue, key);
                } catch (error) {
                    console.error(`Erreur dans l'observer pour ${key}:`, error);
                }
            });
        }
        
        // Notifier les observers parents (ex: 'twitch' pour 'twitch.channel')
        const parts = key.split('.');
        for (let i = parts.length - 1; i > 0; i--) {
            const parentKey = parts.slice(0, i).join('.');
            const parentCallbacks = this.observers.get(parentKey);
            if (parentCallbacks) {
                parentCallbacks.forEach(callback => {
                    try {
                        callback(this.get(parentKey), undefined, parentKey);
                    } catch (error) {
                        console.error(`Erreur dans l'observer parent pour ${parentKey}:`, error);
                    }
                });
            }
        }
        
        // Notifier l'observer global
        const globalCallbacks = this.observers.get('*');
        if (globalCallbacks) {
            globalCallbacks.forEach(callback => {
                try {
                    callback(newValue, oldValue, key);
                } catch (error) {
                    console.error('Erreur dans l\'observer global:', error);
                }
            });
        }
    }

    /**
     * Charge la configuration depuis le localStorage
     */
    loadFromStorage() {
        try {
            const stored = localStorage.getItem('twitchess_config');
            if (stored) {
                const parsed = JSON.parse(stored);
                // Merger avec les defaults pour gérer les nouvelles clés
                this.config = this.deepMerge(this.defaults, parsed);
                console.log('Configuration chargée depuis le localStorage');
            }
        } catch (error) {
            console.error('Erreur lors du chargement de la configuration:', error);
        }
    }

    /**
     * Sauvegarde la configuration dans le localStorage
     */
    saveToStorage() {
        try {
            localStorage.setItem('twitchess_config', JSON.stringify(this.config));
        } catch (error) {
            console.error('Erreur lors de la sauvegarde de la configuration:', error);
        }
    }

    /**
     * Exporte la configuration
     */
    export() {
        return JSON.stringify(this.config, null, 2);
    }

    /**
     * Importe une configuration
     */
    import(configString) {
        try {
            const imported = JSON.parse(configString);
            this.config = this.deepMerge(this.defaults, imported);
            this.saveToStorage();
            
            // Notifier tous les changements
            this.notifyObservers('*', this.config, null);
            
            return true;
        } catch (error) {
            console.error('Erreur lors de l\'import de la configuration:', error);
            return false;
        }
    }
}
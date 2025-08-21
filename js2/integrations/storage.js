/**
 * STORAGE.JS - Gestion du stockage local
 */

export class StorageManager {
    constructor() {
        this.prefix = 'twitchess_';
        this.storage = window.localStorage;
        this.cache = new Map();
    }

    /**
     * Sauvegarde une donnée
     */
    save(key, value) {
        const fullKey = this.prefix + key;
        
        try {
            const serialized = JSON.stringify(value);
            this.storage.setItem(fullKey, serialized);
            this.cache.set(key, value);
            return true;
        } catch (error) {
            console.error('Erreur de sauvegarde:', error);
            
            // Si quota dépassé, essayer de nettoyer
            if (error.name === 'QuotaExceededError') {
                this.cleanup();
                try {
                    const serialized = JSON.stringify(value);
                    this.storage.setItem(fullKey, serialized);
                    this.cache.set(key, value);
                    return true;
                } catch (retryError) {
                    console.error('Impossible de sauvegarder après nettoyage:', retryError);
                    return false;
                }
            }
            
            return false;
        }
    }

    /**
     * Charge une donnée
     */
    get(key) {
        // Vérifier le cache d'abord
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }
        
        const fullKey = this.prefix + key;
        
        try {
            const serialized = this.storage.getItem(fullKey);
            if (serialized === null) {
                return null;
            }
            
            const value = JSON.parse(serialized);
            this.cache.set(key, value);
            return value;
        } catch (error) {
            console.error('Erreur de chargement:', error);
            return null;
        }
    }

    /**
     * Supprime une donnée
     */
    remove(key) {
        const fullKey = this.prefix + key;
        this.storage.removeItem(fullKey);
        this.cache.delete(key);
    }

    /**
     * Vérifie si une clé existe
     */
    has(key) {
        const fullKey = this.prefix + key;
        return this.storage.getItem(fullKey) !== null;
    }

    /**
     * Obtient toutes les clés
     */
    getAllKeys() {
        const keys = [];
        for (let i = 0; i < this.storage.length; i++) {
            const key = this.storage.key(i);
            if (key && key.startsWith(this.prefix)) {
                keys.push(key.substring(this.prefix.length));
            }
        }
        return keys;
    }

    /**
     * Efface tout
     */
    clear() {
        const keys = this.getAllKeys();
        keys.forEach(key => this.remove(key));
        this.cache.clear();
    }

    /**
     * Nettoie les anciennes données
     */
    cleanup() {
        const now = Date.now();
        const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 jours
        
        const keys = this.getAllKeys();
        keys.forEach(key => {
            if (key.startsWith('game_')) {
                const data = this.get(key);
                if (data && data.timestamp && (now - data.timestamp) > maxAge) {
                    this.remove(key);
                }
            }
        });
    }

    /**
     * Obtient la taille utilisée
     */
    getSize() {
        let size = 0;
        for (let i = 0; i < this.storage.length; i++) {
            const key = this.storage.key(i);
            if (key && key.startsWith(this.prefix)) {
                size += this.storage.getItem(key).length + key.length;
            }
        }
        return size;
    }

    /**
     * Sauvegarde une partie
     */
    saveGame(gameData) {
        const gameId = this.generateGameId();
        const fullData = {
            ...gameData,
            id: gameId,
            timestamp: Date.now(),
            date: new Date().toISOString()
        };
        
        // Sauvegarder la partie
        this.save(`game_${gameId}`, fullData);
        
        // Mettre à jour l'index des parties
        const gameIndex = this.get('gameIndex') || [];
        gameIndex.unshift({
            id: gameId,
            date: fullData.date,
            moves: gameData.moves?.length || 0,
            result: gameData.result || 'unknown'
        });
        
        // Limiter à 100 parties
        if (gameIndex.length > 100) {
            const removed = gameIndex.pop();
            this.remove(`game_${removed.id}`);
        }
        
        this.save('gameIndex', gameIndex);
        
        return gameId;
    }

    /**
     * Charge une partie
     */
    loadGame(gameId) {
        return this.get(`game_${gameId}`);
    }

    /**
     * Obtient la liste des parties
     */
    getGames() {
        return this.get('gameIndex') || [];
    }

    /**
     * Génère un ID de partie
     */
    generateGameId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Exporte toutes les données
     */
    exportAll() {
        const data = {};
        const keys = this.getAllKeys();
        
        keys.forEach(key => {
            data[key] = this.get(key);
        });
        
        return JSON.stringify(data, null, 2);
    }

    /**
     * Importe des données
     */
    importData(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            
            Object.entries(data).forEach(([key, value]) => {
                this.save(key, value);
            });
            
            return true;
        } catch (error) {
            console.error('Erreur d\'import:', error);
            return false;
        }
    }

    /**
     * Sauvegarde automatique de l'état
     */
    autoSave(key, getData, interval = 30000) {
        // Sauvegarder immédiatement
        this.save(key, getData());
        
        // Puis régulièrement
        const intervalId = setInterval(() => {
            this.save(key, getData());
        }, interval);
        
        // Retourner une fonction pour arrêter
        return () => clearInterval(intervalId);
    }
}
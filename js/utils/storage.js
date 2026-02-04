/**
 * PHANTOM TWITCHESS - Storage Manager
 * Gestion du localStorage avec préfixe et JSON automatique
 */

class Storage {
    constructor(prefix = 'twitchess_') {
        this.prefix = prefix;
    }

    /**
     * Get a value from storage
     * @param {string} key 
     * @param {any} defaultValue 
     */
    get(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(this.prefix + key);
            if (item === null) return defaultValue;
            return JSON.parse(item);
        } catch (e) {
            console.warn(`Storage get error for ${key}:`, e);
            return defaultValue;
        }
    }

    /**
     * Set a value in storage
     * @param {string} key 
     * @param {any} value 
     */
    set(key, value) {
        try {
            localStorage.setItem(this.prefix + key, JSON.stringify(value));
            return true;
        } catch (e) {
            console.warn(`Storage set error for ${key}:`, e);
            return false;
        }
    }

    /**
     * Remove a value from storage
     * @param {string} key 
     */
    remove(key) {
        try {
            localStorage.removeItem(this.prefix + key);
            return true;
        } catch (e) {
            console.warn(`Storage remove error for ${key}:`, e);
            return false;
        }
    }

    /**
     * Check if a key exists
     * @param {string} key 
     */
    has(key) {
        return localStorage.getItem(this.prefix + key) !== null;
    }

    /**
     * Get all keys with prefix
     */
    keys() {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(this.prefix)) {
                keys.push(key.substring(this.prefix.length));
            }
        }
        return keys;
    }

    /**
     * Clear all storage with this prefix
     */
    clear() {
        const keysToRemove = this.keys();
        keysToRemove.forEach(key => this.remove(key));
    }
}

// Create global instance
window.storage = new Storage();

export default window.storage;

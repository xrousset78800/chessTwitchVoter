/**
 * UTILS.JS - Fonctions utilitaires générales
 */

export class Utils {
    /**
     * Génère un ID unique
     */
    generateId(prefix = '') {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substr(2, 9);
        return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
    }

    /**
     * Génère un code de salle (6 caractères)
     */
    generateRoomCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    /**
     * Clone un objet en profondeur
     */
    deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime());
        if (obj instanceof Array) return obj.map(item => this.deepClone(item));
        if (obj instanceof Object) {
            const clonedObj = {};
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    clonedObj[key] = this.deepClone(obj[key]);
                }
            }
            return clonedObj;
        }
    }

    /**
     * Debounce une fonction
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Throttle une fonction
     */
    throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    /**
     * Formate un temps en mm:ss
     */
    formatTime(seconds) {
        if (seconds < 0) return '00:00';
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Formate un temps en format lisible
     */
    formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    /**
     * Parse un temps depuis une chaîne
     */
    parseTime(timeString) {
        const parts = timeString.split(':').map(Number);
        if (parts.length === 2) {
            return parts[0] * 60 + parts[1];
        } else if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
        return parseInt(timeString) || 0;
    }

    /**
     * Mélange un tableau (Fisher-Yates)
     */
    shuffle(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    /**
     * Obtient un élément aléatoire d'un tableau
     */
    randomElement(array) {
        return array[Math.floor(Math.random() * array.length)];
    }

    /**
     * Clamp une valeur entre min et max
     */
    clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    /**
     * Interpolation linéaire
     */
    lerp(start, end, amount) {
        return start + (end - start) * amount;
    }

    /**
     * Calcule la distance entre deux points
     */
    distance(x1, y1, x2, y2) {
        return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    }

    /**
     * Convertit une position de case en coordonnées
     */
    squareToCoords(square) {
        if (!/^[a-h][1-8]$/.test(square)) return null;
        
        const file = square.charCodeAt(0) - 97; // a=0, h=7
        const rank = parseInt(square[1]) - 1;   // 1=0, 8=7
        return { x: file, y: 7 - rank };
    }

    /**
     * Convertit des coordonnées en position de case
     */
    coordsToSquare(x, y) {
        if (x < 0 || x > 7 || y < 0 || y > 7) return null;
        const file = String.fromCharCode(97 + x);
        const rank = 8 - y;
        return `${file}${rank}`;
    }

    /**
     * Vérifie si une case est valide
     */
    isValidSquare(square) {
        return /^[a-h][1-8]$/.test(square);
    }

    /**
     * Obtient la couleur d'une case
     */
    getSquareColor(square) {
        const coords = this.squareToCoords(square);
        if (!coords) return null;
        return (coords.x + coords.y) % 2 === 0 ? 'light' : 'dark';
    }

    /**
     * Parse une notation algébrique
     */
    parseAlgebraic(notation) {
        const regex = /^([NBRQK])?([a-h])?([1-8])?(x)?([a-h][1-8])(=[NBRQ])?(\+|#)?$/;
        const match = notation.match(regex);
        
        if (!match) return null;
        
        return {
            piece: match[1] || 'P',
            fromFile: match[2],
            fromRank: match[3],
            capture: !!match[4],
            to: match[5],
            promotion: match[6]?.substring(1),
            check: match[7] === '+',
            checkmate: match[7] === '#'
        };
    }

    /**
     * Capitalise la première lettre
     */
    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Tronque une chaîne
     */
    truncate(str, maxLength, suffix = '...') {
        if (str.length <= maxLength) return str;
        return str.slice(0, maxLength - suffix.length) + suffix;
    }

    /**
     * Escape les caractères HTML
     */
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Parse une URL
     */
    parseUrl(url) {
        const a = document.createElement('a');
        a.href = url;
        return {
            protocol: a.protocol,
            hostname: a.hostname,
            port: a.port,
            pathname: a.pathname,
            search: a.search,
            hash: a.hash,
            host: a.host
        };
    }

    /**
     * Obtient les paramètres de l'URL
     */
    getUrlParams() {
        const params = {};
        const searchParams = new URLSearchParams(window.location.search);
        for (const [key, value] of searchParams) {
            params[key] = value;
        }
        return params;
    }

    /**
     * Met à jour un paramètre de l'URL
     */
    updateUrlParam(key, value) {
        const url = new URL(window.location);
        if (value === null || value === undefined) {
            url.searchParams.delete(key);
        } else {
            url.searchParams.set(key, value);
        }
        window.history.replaceState({}, '', url);
    }

    /**
     * Copie dans le presse-papier
     */
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            // Fallback pour les anciens navigateurs
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            
            try {
                document.execCommand('copy');
                document.body.removeChild(textarea);
                return true;
            } catch (err) {
                document.body.removeChild(textarea);
                return false;
            }
        }
    }

    /**
     * Télécharge un fichier
     */
    downloadFile(content, filename, mimeType = 'text/plain') {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Lit un fichier
     */
    readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    /**
     * Attend un délai
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Retry une fonction
     */
    async retry(fn, retries = 3, delay = 1000) {
        for (let i = 0; i < retries; i++) {
            try {
                return await fn();
            } catch (error) {
                if (i === retries - 1) throw error;
                await this.sleep(delay);
            }
        }
    }

    /**
     * Vérifie si on est sur mobile
     */
    isMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    /**
     * Vérifie si on est sur tactile
     */
    isTouchDevice() {
        return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    }

    /**
     * Obtient la taille de l'écran
     */
    getScreenSize() {
        return {
            width: window.innerWidth,
            height: window.innerHeight,
            ratio: window.devicePixelRatio || 1
        };
    }

    /**
     * Observe les changements de taille
     */
    observeResize(element, callback) {
        if (window.ResizeObserver) {
            const observer = new ResizeObserver(callback);
            observer.observe(element);
            return () => observer.disconnect();
        } else {
            // Fallback
            window.addEventListener('resize', callback);
            return () => window.removeEventListener('resize', callback);
        }
    }

    /**
     * Formate un nombre
     */
    formatNumber(num, decimals = 0) {
        return new Intl.NumberFormat('fr-FR', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        }).format(num);
    }

    /**
     * Parse un CSV
     */
    parseCSV(csv, delimiter = ',') {
        const lines = csv.split('\n').filter(line => line.trim());
        const headers = lines[0].split(delimiter).map(h => h.trim());
        
        return lines.slice(1).map(line => {
            const values = line.split(delimiter);
            const row = {};
            headers.forEach((header, i) => {
                row[header] = values[i]?.trim();
            });
            return row;
        });
    }

    /**
     * Convertit en CSV
     */
    toCSV(data, delimiter = ',') {
        if (!data.length) return '';
        
        const headers = Object.keys(data[0]);
        const csvHeaders = headers.join(delimiter);
        
        const csvRows = data.map(row => {
            return headers.map(header => {
                const value = row[header];
                return typeof value === 'string' && value.includes(delimiter) 
                    ? `"${value}"` 
                    : value;
            }).join(delimiter);
        });
        
        return [csvHeaders, ...csvRows].join('\n');
    }

    /**
     * Valide une adresse email
     */
    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    /**
     * Obtient un cookie
     */
    getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    /**
     * Définit un cookie
     */
    setCookie(name, value, days = 30) {
        const expires = new Date();
        expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/`;
    }

    /**
     * Supprime un cookie
     */
    deleteCookie(name) {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/`;
    }
}
/**
 * PHANTOM TWITCHESS - i18n (Internationalisation)
 * Gestion des traductions FR/EN
 */

class I18n {
    constructor() {
        this.currentLang = localStorage.getItem('lang') || 'fr';
        this.translations = {};
        this.loaded = false;
    }

    async init() {
        await this.loadLanguage(this.currentLang);
        this.setupLanguageSelector();
        this.updateDOM();
        this.loaded = true;
    }

    async loadLanguage(lang) {
        try {
            const response = await fetch(`lang/${lang}.json`);
            if (!response.ok) throw new Error(`Failed to load ${lang}.json`);
            this.translations = await response.json();
            this.currentLang = lang;
            localStorage.setItem('lang', lang);
        } catch (error) {
            console.error('i18n load error:', error);
            // Fallback to French
            if (lang !== 'fr') {
                await this.loadLanguage('fr');
            }
        }
    }

    async setLanguage(lang) {
        if (lang === this.currentLang) return;
        await this.loadLanguage(lang);
        this.updateDOM();
        window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang } }));
    }

    /**
     * Get a translation by key path (e.g., 'nav.new', 'toast.moveUndone')
     * @param {string} key - Dot-separated path
     * @param {Object} params - Optional parameters for interpolation
     */
    t(key, params = {}) {
        const keys = key.split('.');
        let value = this.translations;

        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                console.warn(`Translation missing: ${key}`);
                return key;
            }
        }

        if (typeof value !== 'string') {
            console.warn(`Translation not a string: ${key}`);
            return key;
        }

        // Interpolate parameters: {name} -> params.name
        return value.replace(/\{(\w+)\}/g, (match, paramName) => {
            return params[paramName] !== undefined ? params[paramName] : match;
        });
    }

    /**
     * Update all elements with data-i18n attribute
     */
    updateDOM() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            const translation = this.t(key);
            
            // Check if it's an input placeholder
            if (el.hasAttribute('placeholder') && el.dataset.i18nPlaceholder) {
                el.placeholder = this.t(el.dataset.i18nPlaceholder);
            }
            
            // Check for HTML content
            if (el.dataset.i18nHtml !== undefined) {
                el.innerHTML = translation;
            } else {
                el.textContent = translation;
            }
        });

        // Update title attribute translations
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            el.title = this.t(el.dataset.i18nTitle);
        });

        // Update language selector UI
        document.querySelectorAll('[data-lang]').forEach(el => {
            el.classList.toggle('is-active', el.dataset.lang === this.currentLang);
        });
    }
    setupLanguageSelector() {
        document.querySelectorAll('[data-lang]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const lang = btn.dataset.lang;
                this.setLanguage(lang);
            });
        });
    }
    /**
     * Get current language
     */
    getLang() {
        return this.currentLang;
    }
}

// Create global instance
window.i18n = new I18n();
window.i18n.init();
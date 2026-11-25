/**
 * PHANTOM TWITCHESS - i18n (Internationalisation)
 * Traductions (lang/<code>.json) et sélecteur de langue à drapeaux
 */

// Drapeaux en SVG (les emojis drapeaux ne s'affichent pas sous Windows)
const FLAG = (body, vb = '0 0 30 20') => `<svg class="lang-flag" viewBox="${vb}" preserveAspectRatio="none" aria-hidden="true">${body}</svg>`;
const STRIPES_V = (a, b, c) => FLAG(`<rect width="10" height="20" fill="${a}"/><rect x="10" width="10" height="20" fill="${b}"/><rect x="20" width="10" height="20" fill="${c}"/>`);
const STRIPES_H = (a, b, c) => FLAG(`<rect width="30" height="7" fill="${a}"/><rect y="6.67" width="30" height="7" fill="${b}"/><rect y="13.33" width="30" height="6.67" fill="${c}"/>`);
const LANGS = [
    { code: 'fr', name: 'Français', locale: 'fr-FR', flag: STRIPES_V('#002395', '#fff', '#ED2939') },
    { code: 'en', name: 'English', locale: 'en-US', flag: FLAG('<rect width="60" height="30" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" stroke-width="2.4"/><path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/><path d="M30,0 v30 M0,15 h60" stroke="#C8102E" stroke-width="6"/>', '0 0 60 30') },
    { code: 'es', name: 'Español', locale: 'es-ES', flag: FLAG('<rect width="30" height="20" fill="#AA151B"/><rect y="5" width="30" height="10" fill="#F1BF00"/>') },
    { code: 'de', name: 'Deutsch', locale: 'de-DE', flag: STRIPES_H('#000', '#DD0000', '#FFCE00') },
    { code: 'it', name: 'Italiano', locale: 'it-IT', flag: STRIPES_V('#009246', '#fff', '#CE2B37') },
    { code: 'pt', name: 'Português', locale: 'pt-BR', flag: FLAG('<rect width="30" height="20" fill="#009C3B"/><polygon points="15,2.5 27.5,10 15,17.5 2.5,10" fill="#FFDF00"/><circle cx="15" cy="10" r="4.4" fill="#002776"/>') },
    { code: 'nl', name: 'Nederlands', locale: 'nl-NL', flag: STRIPES_H('#AE1C28', '#fff', '#21468B') },
    { code: 'pl', name: 'Polski', locale: 'pl-PL', flag: FLAG('<rect width="30" height="10" fill="#fff"/><rect y="10" width="30" height="10" fill="#DC143C"/>') },
    { code: 'tr', name: 'Türkçe', locale: 'tr-TR', flag: FLAG('<rect width="30" height="20" fill="#E30A17"/><circle cx="11" cy="10" r="5" fill="#fff"/><circle cx="12.3" cy="10" r="4" fill="#E30A17"/><polygon points="14.90,10.00 16.43,9.44 16.49,7.81 17.49,9.10 19.06,8.65 18.15,10.00 19.06,11.35 17.49,10.90 16.49,12.19 16.43,10.56" fill="#fff"/>') },
    { code: 'ru', name: 'Русский', locale: 'ru-RU', flag: STRIPES_H('#fff', '#0039A6', '#D52B1E') },
];
const langInfo = (code) => LANGS.find(l => l.code === code) || LANGS[0];

/** Fusion profonde : les clés absentes d'une traduction retombent sur la base */
function mergeDeep(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' ? mergeDeep(base[k], v) : v;
    }
    return out;
}

class I18n {
    constructor() {
        // Langue de l'adresse (/en/...), fixee par le script en tete de index.html
        let saved = window.CG_LANG;
        try { saved = saved || localStorage.getItem('lang'); } catch {}
        this.currentLang = LANGS.some(l => l.code === saved) ? saved : 'fr';
        this.langs = LANGS;
        this.translations = {};
        this.loaded = false;
    }

    async init() {
        await this.loadLanguage(this.currentLang);
        this.setupLanguageSelector();
        this.updateDOM();
        this.loaded = true;
        window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang: this.currentLang } }));
    }

    async loadLanguage(lang) {
        try {
            const get = async (code) => {
                const response = await fetch(`/lang/${code}.json`);
                if (!response.ok) throw new Error(`Failed to load ${code}.json`);
                return response.json();
            };
            // Langues ajoutées : l'anglais comble ce qui manquerait
            const [main, base] = await Promise.all([get(lang), lang === 'fr' || lang === 'en' ? null : get('en').catch(() => null)]);
            this.translations = base ? mergeDeep(base, main) : main;
            this.currentLang = lang;
            localStorage.setItem('lang', lang);
            document.documentElement.lang = lang;
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
        window.setUrlLang?.(this.currentLang);
        if (window.langUrl) document.querySelectorAll('[data-navigate]').forEach(el => el.setAttribute('href', langUrl(el.dataset.navigate)));
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

        // Placeholders traduits (champs sans data-i18n)
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            el.placeholder = this.t(el.dataset.i18nPlaceholder);
        });

        // Update title attribute translations
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            el.title = this.t(el.dataset.i18nTitle);
        });

        this.renderLanguageSelector();
    }

    /** Locale des dates et nombres pour la langue choisie */
    locale() {
        return langInfo(this.currentLang).locale;
    }

    /** Sélecteur discret : le drapeau de la langue en cours, la liste au clic */
    setupLanguageSelector() {
        document.querySelectorAll('.nav__lang').forEach(box => {
            box.innerHTML = `
                <button class="nav__lang-current" type="button" aria-haspopup="listbox" aria-expanded="false"></button>
                <ul class="nav__lang-menu" role="listbox" hidden>
                    ${LANGS.map(l => `<li><button type="button" role="option" class="nav__lang-item" data-lang-code="${l.code}">${l.flag}<span>${l.name}</span></button></li>`).join('')}
                </ul>`;
            const current = box.querySelector('.nav__lang-current');
            const menu = box.querySelector('.nav__lang-menu');
            const toggle = (open) => {
                menu.hidden = !open;
                current.setAttribute('aria-expanded', String(open));
                box.classList.toggle('is-open', open);
            };
            current.addEventListener('click', (e) => { e.stopPropagation(); toggle(menu.hidden); });
            menu.addEventListener('click', (e) => {
                const item = e.target.closest('[data-lang-code]');
                if (!item) return;
                toggle(false);
                this.setLanguage(item.dataset.langCode);
            });
            document.addEventListener('click', (e) => { if (!box.contains(e.target)) toggle(false); });
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
        });
        this.renderLanguageSelector();
    }

    renderLanguageSelector() {
        const info = langInfo(this.currentLang);
        document.querySelectorAll('.nav__lang-current').forEach(btn => {
            btn.innerHTML = `${info.flag}<i class="fas fa-chevron-down" aria-hidden="true"></i>`;
            btn.title = info.name;
            btn.setAttribute('aria-label', info.name);
        });
        document.querySelectorAll('.nav__lang-item').forEach(el => {
            const on = el.dataset.langCode === this.currentLang;
            el.classList.toggle('is-active', on);
            el.setAttribute('aria-selected', String(on));
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
/** Traduction avec repli (texte d'origine) tant que la langue n'est pas chargée ou si la clé manque */
window.tt = (key, params, fallback) => {
    const v = window.i18n?.t?.(key, params || {});
    return v && v !== key ? v : (fallback ?? key);
};
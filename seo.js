/**
 * Une adresse par langue pour l'indexation : le français à la racine (/rush), les autres langues
 * préfixées (/en/rush, /de/rush…). Le serveur envoie la page déjà traduite (textes data-i18n, titre,
 * description, hreflang, canonical) : les moteurs lisent la bonne langue sans exécuter le JavaScript.
 * La traduction côté client (js/utils/i18n.js) reste la même par-dessus.
 */
const fs = require('fs');
const path = require('path');

const LANGS = ['fr', 'en', 'es', 'de', 'it', 'pt', 'nl', 'pl', 'tr', 'ru'];
const DEFAULT_LANG = 'fr';
const PREFIXED = LANGS.filter(l => l !== DEFAULT_LANG);
const SITE_URL = (process.env.SITE_URL || 'https://chesstwitchvoter.xouindaplace.fr').replace(/\/+$/, '');

// Pages indexées ('' = accueil, la station 24/24) et le libellé qui sert de titre
const PAGES = {
    '': null, rush: 'nav.rush', mono: 'nav.mono', multi: 'nav.multi', sandbox: 'newTabs.free',
    browse: 'nav.browse', records: 'nav.records', achievements: 'nav.achievements', live: 'nav.live', tournament: 'nav.tournament',
};
// Description propre à la page si la langue l'a, sinon celle de l'accueil
const DESC_KEY = (page) => `seo.desc.${page || 'home'}`;

const OG_LOCALE = { fr: 'fr_FR', en: 'en_US', es: 'es_ES', de: 'de_DE', it: 'it_IT', pt: 'pt_BR', nl: 'nl_NL', pl: 'pl_PL', tr: 'tr_TR', ru: 'ru_RU' };

function mergeDeep(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' ? mergeDeep(base[k], v) : v;
    }
    return out;
}
const lookup = (obj, key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');

/** Adresse publique d'une page dans une langue : /rush, /en/rush ; l'accueil : /, /en/ */
const urlFor = (lang, page) => (lang === DEFAULT_LANG ? '' : '/' + lang) + '/' + page;

module.exports = function setupSeo({ app, rootDir, indexHtml, appRoutes }) {
    const read = (code) => JSON.parse(fs.readFileSync(path.join(rootDir, 'lang', `${code}.json`), 'utf8'));
    const raw = Object.fromEntries(LANGS.map(l => [l, read(l)]));
    // Même fusion que le client : l'anglais comble ce qui manque aux langues ajoutées
    const dict = Object.fromEntries(LANGS.map(l => [l, l === 'fr' || l === 'en' ? raw[l] : mergeDeep(raw.en, raw[l])]));
    const t = (lang, key) => { const v = lookup(dict[lang], key); return typeof v === 'string' ? v : null; };

    // Corps traduit, calculé une fois par langue
    const prefixRoutes = new RegExp(`(\\shref=")/(?=(?:${appRoutes.source.match(/\(([^)]*)\)/)[1]})\\b)`, 'g');
    const render = (lang) => {
        const pre = lang === DEFAULT_LANG ? '' : '/' + lang;
        let html = indexHtml.replace(/<html lang="[^"]*"/, `<html lang="${lang}"`);
        // Textes simples
        html = html.replace(/<([a-zA-Z][\w-]*)(\s[^>]*?\bdata-i18n="([^"]+)"[^>]*)>([^<]*)<\/\1>/g, (m, tag, attrs, key) => {
            const v = t(lang, key);
            if (v == null) return m;
            return `<${tag}${attrs}>${/\sdata-i18n-html\b/.test(attrs) ? v : escText(v)}</${tag}>`;
        });
        // Textes en HTML (liens dans la phrase…)
        html = html.replace(/<([a-zA-Z][\w-]*)(\s(?:[^>]*?\s)?data-i18n-html\b[^>]*)>([\s\S]*?)<\/\1>/g, (m, tag, attrs, inner) => {
            const key = (attrs.match(/\sdata-i18n="([^"]+)"/) || [])[1];
            const v = key && t(lang, key);
            if (v == null || inner.includes(`<${tag}`)) return m;
            return `<${tag}${attrs}>${v}</${tag}>`;
        });
        // Infobulles et placeholders
        html = html.replace(/<[a-zA-Z][^>]*\sdata-i18n-(?:title|placeholder)="[^"]+"[^>]*>/g, (tagStr) => {
            for (const attr of ['title', 'placeholder']) {
                const k = tagStr.match(new RegExp(`\\sdata-i18n-${attr}="([^"]+)"`));
                const v = k && t(lang, k[1]);
                if (v == null) continue;
                const re = new RegExp(`(\\s${attr}=")[^"]*"`);
                tagStr = re.test(tagStr) ? tagStr.replace(re, `$1${escAttr(v)}"`) : tagStr.replace(/\s*(\/?)>$/, ` ${attr}="${escAttr(v)}"$1>`);
            }
            return tagStr;
        });
        // Liens du menu et liens internes dans la langue de la page
        html = html.replace(/(<a\b[^>]*?)\sdata-navigate="([^"]+)"/g, (m, start, to) =>
            /\shref="/.test(start) ? m : `${start} href="${pre}${to}" data-navigate="${to}"`);
        if (pre) html = html.replace(prefixRoutes, `$1${pre}/`);
        return html;
    };
    const bodies = Object.fromEntries(LANGS.map(l => [l, render(l)]));

    const head = (lang, page, indexable) => {
        const label = PAGES[page] && t(lang, PAGES[page]);
        const title = label ? `${label} · Crowd Gambit` : (t(lang, 'seo.title') || 'Crowd Gambit');
        const desc = (lookup(raw[lang], DESC_KEY(page)) || t(lang, DESC_KEY(page)) || t(lang, 'seo.desc.home') || '');
        const url = SITE_URL + urlFor(lang, page);
        const tags = [
            `<title>${escText(title)}</title>`,
            `<meta name="description" content="${escAttr(desc)}">`,
        ];
        if (indexable) {
            tags.push(`<link rel="canonical" href="${url}">`);
            for (const l of LANGS) tags.push(`<link rel="alternate" hreflang="${l}" href="${SITE_URL}${urlFor(l, page)}">`);
            tags.push(`<link rel="alternate" hreflang="x-default" href="${SITE_URL}${urlFor(DEFAULT_LANG, page)}">`);
        } else {
            tags.push('<meta name="robots" content="noindex">');
        }
        tags.push(
            `<meta property="og:type" content="website">`,
            `<meta property="og:site_name" content="Crowd Gambit">`,
            `<meta property="og:title" content="${escAttr(title)}">`,
            `<meta property="og:description" content="${escAttr(desc)}">`,
            `<meta property="og:locale" content="${OG_LOCALE[lang]}">`,
            `<meta property="og:url" content="${url}">`,
            `<meta name="twitter:card" content="summary">`,
        );
        return tags.join('\n    ');
    };

    /** Envoie la page de l'appli pour une langue et un chemin sans préfixe (/rush, /multi/hote/x…) */
    const send = (lang, rest, res) => {
        const segs = rest.split('/').filter(Boolean);
        let page = segs[0] || '';
        if (page === '24h') page = '';
        const indexable = segs.length <= 1 && page in PAGES;
        const html = bodies[lang].replace(/<title>[^<]*<\/title>/, head(lang, indexable ? page : '', indexable));
        res.set('Cache-Control', 'no-cache').set('Content-Language', lang).type('html').send(html);
    };

    app.get(['/', '/index.html'], (req, res) => send(DEFAULT_LANG, '/', res));
    app.get(appRoutes, (req, res) => send(DEFAULT_LANG, req.path, res));

    // /en, /en/, /en/rush, /en/multi/hote/x… ; /fr/… renvoie vers l'adresse sans préfixe
    const LANG_PATH = new RegExp(`^/(${LANGS.join('|')})(/.*)?$`);
    app.get(LANG_PATH, (req, res, next) => {
        const [, lang, rest = '/'] = req.path.match(LANG_PATH);
        const qs = req.originalUrl.slice(req.path.length);
        if (lang === DEFAULT_LANG) return res.redirect(301, rest + qs);
        if (rest !== '/' && !appRoutes.test(rest)) return next();
        if (req.path === '/' + lang) return res.redirect(301, `/${lang}/${qs}`);
        send(lang, rest, res);
    });

    app.get('/robots.txt', (req, res) => res.type('text/plain').send(
        `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /proxy/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`));

    const sitemap = (() => {
        const alt = (page) => LANGS.map(l => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE_URL}${urlFor(l, page)}"/>`)
            .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}${urlFor(DEFAULT_LANG, page)}"/>`).join('\n');
        const urls = Object.keys(PAGES).flatMap(page => LANGS.map(l =>
            `  <url>\n    <loc>${SITE_URL}${urlFor(l, page)}</loc>\n${alt(page)}\n  </url>`));
        return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
    })();
    app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(sitemap));

    return { LANGS, render };
};

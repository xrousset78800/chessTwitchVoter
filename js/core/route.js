// ============================================
// ADRESSES PROPRES (/24h, /records?c=x) au lieu de /#/24h
// ============================================
// Le code manipule toujours des routes « #/chemin?query » (forme historique) ; ces aides font le lien
// avec la vraie adresse. Les anciens liens en #/… restent valables : ils sont nettoyés à l'arrivée.

/** Route courante sous la forme « #/chemin?query » */
export function routeHash() {
    if (location.hash.startsWith('#/')) return location.hash;
    return '#' + appPath() + location.search;
}

/** « #/records?c=x » ou « /records?c=x » → « /records?c=x » */
export function toUrl(route) {
    const r = String(route || '/');
    return (r.startsWith('#') ? r.slice(1) : r) || '/';
}

/** Va sur une route (nouvelle entrée d'historique, ou remplacement) et prévient le routeur */
export function go(route, { replace = false } = {}) {
    const url = toUrl(route);
    if (url !== appPath() + location.search || location.hash) {
        history[replace ? 'replaceState' : 'pushState'](null, '', url);
    }
    window.dispatchEvent(new Event('routechange'));
}

/** Ancienne adresse /#/24h → /24h (sans recharger) */
export function cleanLegacyHash() {
    if (location.hash.startsWith('#/')) history.replaceState(null, '', toUrl(location.hash));
}

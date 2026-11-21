/**
 * Liste des spectateurs d'une partie : affichée aux joueurs (fenêtre de jeu)
 * comme aux spectateurs eux-mêmes. Les pseudos viennent du serveur, qui ne
 * retient que des comptes Twitch vérifiés ; les autres sont comptés comme anonymes.
 */
const t = (key, params) => window.i18n?.t(key, params) ?? key;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Texte court : « 3 spectateurs » */
export function spectatorsLabel(count) {
    return t(count > 1 ? 'spectators.countMany' : 'spectators.countOne', { n: count });
}

/**
 * @param {HTMLElement} el   conteneur de la liste
 * @param {{count:number,names:string[],anon:number}|null} data
 * @param {string|null} me   login du spectateur courant (marqué « toi »)
 */
export function renderSpectatorList(el, data, me = null) {
    if (!el) return;
    const names = data?.names || [];
    if (!data?.count) {
        el.innerHTML = `<p class="spectators__empty">${esc(t('spectators.none'))}</p>`;
        return;
    }
    const meLogin = (me || '').toLowerCase();
    const chips = names.map(login => {
        const isMe = login === meLogin;
        return `<a class="spectators__chip${isMe ? ' is-me' : ''}" href="#/records?c=${encodeURIComponent(login)}">
            <i class="fas fa-eye"></i> ${esc(login)}${isMe ? ` <span class="spectators__me">${esc(t('spectators.you'))}</span>` : ''}</a>`;
    });
    // Spectateurs non connectés à Twitch (un même compte ouvert deux fois ne compte qu'une fois)
    const others = data.anon || 0;
    if (others) {
        chips.push(`<span class="spectators__chip spectators__chip--anon"><i class="fas fa-user-secret"></i> ${esc(t(others > 1 ? 'spectators.anonMany' : 'spectators.anonOne', { n: others }))}</span>`);
    }
    el.innerHTML = chips.join('');
}

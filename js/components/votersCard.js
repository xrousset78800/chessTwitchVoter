/**
 * Carte « Votants », partagée par la page Tournoi (prochain coup, vainqueur en fin de partie)
 * et le 24/24 (votes visibles, prédiction) : une ligne par choix (pièce du coup, part des votes,
 * photos des votants, nombre), ✓ / ✗ au résultat, ligne tirée au sort et votant tiré mis en avant.
 *
 * Votant (normalisé par l'appelant) : { login, name, pic, src: 'site' | 'chat' | 'bot', key, label, san, hit, tip }
 *   key   : regroupement (coup UCI / SAN, ou pronostic 1-0…) ; label : texte affiché ; san : pour la pièce
 * Script classique : window.VotersCard
 */
(() => {
    const T = (k, p, f) => (window.tt ? window.tt(k, p, f) : f);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const MAXF = 10;

    const who = v => (v.name || v.login || '?') + (v.src === 'chat' ? ` · ${T('voters.chat', null, 'Chat Twitch')}` : v.src === 'bot' ? ` · ${T('voters.bot', null, 'Bot de test')}` : '');

    /** Photo du votant (robot pour un bot, initiale sans photo) */
    function face(v, winner = null) {
        const a = ` data-u="${esc(v.login || '')}"${v.login && v.src !== 'bot' ? ` data-look-pic="${esc(v.login)}"` : ''} title="${esc(v.tip || who(v))}"`;
        const w = v.login && v.login === winner ? ' is-winner' : '';
        if (v.src === 'bot') return `<span class="tv-pic is-bot${w}"${a}><i class="fas fa-robot"></i></span>`;
        if (v.pic) return `<img class="tv-pic${w}" src="${esc(v.pic)}" alt="" loading="lazy" referrerpolicy="no-referrer"${a}>`;
        return `<span class="tv-pic${w}"${a}>${esc(String(v.name || v.login || '?')[0].toUpperCase())}</span>`;
    }

    /** Pièce du coup (SAN), à la couleur du camp qui joue, dans le jeu de pièces choisi */
    function piece(san, turn) {
        if (!san || (turn !== 'w' && turn !== 'b') || !window.pieceUrl) return '';
        const c = String(san)[0];
        const p = c === 'O' || c === '0' ? 'K' : 'KQRBN'.includes(c) ? c : 'P';
        return `<img class="tv-piece" src="${esc(window.pieceUrl(turn + p))}" alt="">`;
    }

    /**
     * Liste des votants (contenu de .tv-body, sans le pied)
     * opts : me, turn ('w' | 'b' : pièces des coups), flash (✓ / ✗), gain (html du ✓, ou fonction(groupe)),
     *        drawn (clé tirée), winner (login tiré), keys ([{ key, label, title }] : lignes fixes, même vides),
     *        empty (texte sans votant)
     */
    function list(rows, { me = null, turn = null, flash = false, gain = '', drawn = null, winner = null, keys = null, empty = '' } = {}) {
        const byKey = new Map();
        for (const v of rows) {
            if (!byKey.has(v.key)) byKey.set(v.key, { key: v.key, label: v.label, san: v.san, list: [] });
            byKey.get(v.key).list.push(v);
        }
        let groups;
        if (keys) groups = keys.map(k => ({ key: k.key, label: k.label, san: k.san, title: k.title, list: byKey.get(k.key)?.list || [] }));
        else groups = [...byKey.values()];
        for (const g of groups) g.hit = !!(flash && g.list.some(v => v.hit));
        if (!keys) groups.sort((a, b) => ((b.key === drawn) - (a.key === drawn)) || (b.hit - a.hit) || b.list.length - a.list.length);
        if (!rows.length && !keys) return `<p class="tp-hint">${esc(empty || T('voters.none', null, 'Pas encore de prono pour ce coup.'))}</p>`;
        const row = (g, i) => {
            const isDrawn = drawn != null && g.key === drawn;
            // Le votant tiré au sort en tête de sa ligne
            const faces = isDrawn && winner ? [...g.list.filter(v => v.login === winner), ...g.list.filter(v => v.login !== winner)] : g.list;
            const gh = g.hit ? (typeof gain === 'function' ? gain(g) : gain) : '';
            const mark = !flash ? '' : g.hit
                ? `<span class="tv-mark is-hit"><i class="fas fa-check"></i>${gh ? `<b class="tv-gain">${gh}</b>` : ''}</span>`
                : '<span class="tv-mark is-miss"><i class="fas fa-xmark"></i></span>';
            const more = faces.length - MAXF;
            const cls = `tv-item tv-grp${faces.some(v => v.login === me) ? ' is-me' : ''}${flash ? (g.hit ? ' is-hit' : ' is-miss') : ''}${isDrawn ? ' is-drawn' : ''}`;
            return `<li class="${cls}" data-m="${esc(g.key)}" style="--i:${i};--p:${rows.length ? Math.round(100 * faces.length / rows.length) : 0}%"${g.title ? ` title="${esc(g.title)}"` : ''}>
                ${piece(g.san, turn)}<span class="tv-move">${esc(g.label)}</span>
                <span class="tv-faces">${faces.slice(0, MAXF).map(v => face(v, isDrawn ? winner : null)).join('')}${more > 0 ? `<span class="tv-more">+${more}</span>` : ''}</span>
                <span class="tv-n">${faces.length}</span>${mark}</li>`;
        };
        return `<ul class="tv-list tv-groups${flash ? ' is-flash' : ''}${drawn != null ? ' has-drawn' : ''}">${groups.map(row).join('')}</ul>`;
    }

    /** Carte complète : titre « Votants », nombre, liste, pied */
    function card(rows, opts = {}) {
        return `<div class="live-card tv-card">
            <div class="live-card__title tv-head"><span><i class="fas fa-users"></i> ${esc(T('voters.title', null, 'Votants'))}</span> <span class="tv-headright"><small class="tv-count">${rows.length || ''}</small></span></div>
            <div class="tv-body">${opts.head || ''}${list(rows, opts)}${opts.footer || ''}</div></div>`;
    }

    /** Tirage terminé : la ligne du coup tiré passe en tête et s'allume, le votant tiré est mis en avant */
    function mark(root, key, login) {
        const ul = root?.querySelector('.tv-list');
        if (!ul || key == null) return;
        const row = [...ul.querySelectorAll('.tv-grp')].find(li => li.dataset.m === key);
        if (!row) return;
        ul.classList.add('has-drawn');
        row.classList.add('is-drawn');
        ul.prepend(row);
        const f = login && [...row.querySelectorAll('.tv-pic')].find(x => x.dataset.u === login);
        if (f) { f.classList.add('is-winner'); f.parentElement.prepend(f); }
    }

    window.VotersCard = { face, piece, list, card, mark };
})();

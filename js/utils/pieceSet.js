/**
 * Sets de pièces : choix gardé dans le navigateur (localStorage « pieceSet »), appliqué à
 * tous les échiquiers et à toutes les petites pièces (votes, historique, miniatures…).
 *   window.pieceUrl('wN')  → adresse de l'image dans le set choisi
 *   window.pieceTheme      → fonction à passer à Chessboard({ pieceTheme })
 * Le sélecteur est construit dans chaque .nav__pieces (barre du haut, à côté de la langue).
 */
(function () {
    // free : disponible pour tous. Les autres sont des récompenses de succès (ticket #16) :
    // ils n'apparaissent que lorsque window.unlockedRewards (Set d'ids) les contient.
    const unlocked = x => !!x.free || !!window.unlockedRewards?.has?.(x.id);
    const SETS = [
        { id: 'wikipedia', ext: 'png', key: 'classic', label: 'Classique', free: true },
        { id: 'flat', ext: 'svg', key: 'flat', label: 'Plat' },
        { id: 'neon', ext: 'svg', key: 'neon', label: 'Néon' },
        { id: 'token', ext: 'svg', key: 'token', label: 'Jetons' },
    ];
    const byId = id => SETS.find(s => s.id === id && unlocked(s)) || SETS[0];
    let current = SETS[0];
    try { current = byId(localStorage.getItem('pieceSet')); } catch (e) { }

    // Couleurs de l'échiquier (variables --sq-light / --sq-dark, cf. css/components/boardTheme.css)
    // Le premier est le thème par défaut
    const BOARDS = [
        { id: 'night', key: 'night', label: 'Bleu nuit', light: '#9db0d3', dark: '#42598c', free: true },
        { id: 'black', key: 'black', label: 'Noir', light: '#a6a6a6', dark: '#474747', free: true },
        { id: 'grey', key: 'grey', label: 'Ardoise', light: '#dcdcdc', dark: '#8a8d93', free: true },
        { id: 'wood', key: 'wood', label: 'Bois', light: '#f0d9b5', dark: '#b58863' },
        { id: 'green', key: 'green', label: 'Vert', light: '#eeeed2', dark: '#769656' },
        { id: 'blue', key: 'blue', label: 'Bleu', light: '#dee3e6', dark: '#8ca2ad' },
        { id: 'orange', key: 'orange', label: 'Braise', light: '#f6e2cc', dark: '#d2804f' },
        { id: 'purple', key: 'purple', label: 'Lavande', light: '#e9e1f3', dark: '#8f77b5' },
        { id: 'rose', key: 'rose', label: 'Rose', light: '#f5e1e4', dark: '#c27a87' },
    ];
    const boardById = id => BOARDS.find(b => b.id === id && unlocked(b)) || BOARDS[0];
    let board = BOARDS[0];
    try { board = boardById(localStorage.getItem('boardTheme')); } catch (e) { }
    function applyBoard() {
        const s = document.documentElement.style;
        s.setProperty('--sq-light', board.light);
        s.setProperty('--sq-dark', board.dark);
    }
    applyBoard();

    const url = (piece, set = current) => `/img/chesspieces/${set.id}/${piece}.${set.ext}`;
    window.pieceUrl = piece => url(piece);
    window.pieceTheme = piece => url(piece);

    const label = s => {
        const v = window.i18n?.t?.(`pieces.${s.key}`);
        return v && v !== `pieces.${s.key}` ? v : s.label;
    };
    const tr = (key, fb) => {
        const v = window.i18n?.t?.(key);
        return v && v !== key ? v : fb;
    };
    const title = () => tr('pieces.title', 'Pièces');
    const boardLabel = b => tr(`pieces.board.${b.key}`, b.label);

    // Toutes les images de pièces déjà affichées (échiquiers et petites icônes)
    const PIECE_SRC = /\/chesspieces\/[^/]+\/([wb][PNBRQK])\.(?:png|svg)(?:[?#].*)?$/;
    function refreshImages() {
        document.querySelectorAll('img').forEach(img => {
            const m = (img.getAttribute('src') || '').match(PIECE_SRC);
            if (m) img.src = url(m[1]);
        });
    }

    function render() {
        document.querySelectorAll('.nav__pieces').forEach(box => {
            const btn = box.querySelector('.nav__pieces-current');
            if (!btn) return;
            btn.innerHTML = `<img src="${url('wN')}" alt=""><i class="fas fa-chevron-down" aria-hidden="true"></i>`;
            btn.title = `${title()} : ${label(current)} · ${tr('pieces.boardTitle', 'Échiquier')} : ${boardLabel(board)}`;
            btn.setAttribute('aria-label', btn.title);
            box.querySelectorAll('[data-piece-set]').forEach(el => {
                const s = byId(el.dataset.pieceSet);
                const on = s.id === current.id;
                el.classList.toggle('is-active', on);
                el.setAttribute('aria-selected', String(on));
                el.querySelector('.nav__pieces-name').textContent = label(s);
            });
            box.querySelectorAll('[data-board-theme]').forEach(el => {
                const b = boardById(el.dataset.boardTheme);
                const on = b.id === board.id;
                el.classList.toggle('is-active', on);
                el.setAttribute('aria-pressed', String(on));
                el.title = boardLabel(b);
                el.setAttribute('aria-label', boardLabel(b));
            });
            box.querySelectorAll('.nav__pieces-heading').forEach(h => { h.textContent = tr(h.dataset.key, h.dataset.fb); });
        });
    }

    function setPieceSet(id) {
        current = byId(id);
        try { localStorage.setItem('pieceSet', current.id); } catch (e) { }
        refreshImages();
        render();
        window.dispatchEvent(new CustomEvent('pieceSetChanged', { detail: { id: current.id } }));
    }
    window.setPieceSet = setPieceSet;

    function setBoardTheme(id) {
        board = boardById(id);
        try { localStorage.setItem('boardTheme', board.id); } catch (e) { }
        applyBoard();
        render();
        window.dispatchEvent(new CustomEvent('boardThemeChanged', { detail: { id: board.id } }));
    }
    window.setBoardTheme = setBoardTheme;

    function setup() {
        const sets = SETS.filter(unlocked);
        document.querySelectorAll('.nav__pieces').forEach(box => {
            box.innerHTML = `
                <button class="nav__pieces-current" type="button" aria-haspopup="listbox" aria-expanded="false"></button>
                <ul class="nav__pieces-menu" hidden>
                    <li class="nav__pieces-heading" data-key="pieces.boardTitle" data-fb="Échiquier"></li>
                    <li class="nav__pieces-boards">${BOARDS.filter(unlocked).map(b => `<button type="button" class="nav__pieces-swatch" data-board-theme="${b.id}"
                        style="--l:${b.light};--d:${b.dark}"></button>`).join('')}</li>
                    ${sets.length > 1 ? '<li class="nav__pieces-heading" data-key="pieces.title" data-fb="Pièces"></li>' : ''}
                    ${(sets.length > 1 ? sets : []).map(s => `<li><button type="button" role="option" class="nav__pieces-item" data-piece-set="${s.id}">
                        <span class="nav__pieces-preview">${['wK', 'wN', 'bQ', 'bP'].map(p => `<img src="${url(p, s)}" alt="" loading="lazy">`).join('')}</span>
                        <span class="nav__pieces-name"></span></button></li>`).join('')}
                </ul>`;
            const btn = box.querySelector('.nav__pieces-current');
            const menu = box.querySelector('.nav__pieces-menu');
            const toggle = open => {
                menu.hidden = !open;
                btn.setAttribute('aria-expanded', String(open));
                box.classList.toggle('is-open', open);
            };
            box._closeMenu = () => toggle(false);
            btn.addEventListener('click', e => { e.stopPropagation(); toggle(menu.hidden); });
            menu.addEventListener('click', e => {
                const sw = e.target.closest('[data-board-theme]');
                if (sw) { e.stopPropagation(); setBoardTheme(sw.dataset.boardTheme); return; }   // le menu reste ouvert pour comparer
                const item = e.target.closest('[data-piece-set]');
                if (!item) return;
                toggle(false);
                setPieceSet(item.dataset.pieceSet);
            });
        });
        render();
        // Images créées avant le chargement du choix (HTML statique) : alignées sur le set
        if (current.id !== SETS[0].id) refreshImages();
    }

    // Fermeture des menus (une seule fois : setup() est rappelé quand les récompenses changent)
    const closeMenus = keep => document.querySelectorAll('.nav__pieces').forEach(box => { if (box !== keep) box._closeMenu?.(); });
    document.addEventListener('click', e => closeMenus(e.target.closest?.('.nav__pieces')));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(null); });

    // Objets débloqués (js/core/economy.js) : choix enregistrés réappliqués, menu reconstruit
    window.addEventListener('economyChanged', () => {
        let ps = null, bt = null;
        try { ps = localStorage.getItem('pieceSet'); bt = localStorage.getItem('boardTheme'); } catch (e) { }
        const prevSet = current.id;
        current = byId(ps || current.id);
        board = boardById(bt || board.id);
        applyBoard();
        setup();
        if (current.id !== prevSet) refreshImages();
    });

    window.addEventListener('languageChanged', render);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
    else setup();
})();

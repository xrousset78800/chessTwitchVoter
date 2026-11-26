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
    // own : id de l'objet au magasin (economy.js, CATALOG) quand il diffère de l'id local
    const unlocked = x => !!x.free || !!window.unlockedRewards?.has?.(x.own || x.id);
    const SETS = [
        { id: 'wikipedia', ext: 'png', key: 'classic', label: 'Classique', free: true },
        { id: 'flat', ext: 'svg', key: 'flat', label: 'Plat' },
        { id: 'neon', ext: 'svg', key: 'neon', label: 'Néon' },
        { id: 'token', ext: 'svg', key: 'token', label: 'Jetons' },
        { id: 'ice', ext: 'svg', key: 'ice', label: 'Banquise' },
        { id: 'ruby', ext: 'svg', key: 'ruby', label: 'Rubis' },
        { id: 'royal', ext: 'svg', key: 'royal', label: 'Royal' },
        { id: 'synth', ext: 'svg', key: 'synth', label: 'Synthwave' },
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
        { id: 'mint', key: 'mint', label: 'Menthe', light: '#e3f4ec', dark: '#6fae95' },
        { id: 'sand', key: 'sand', label: 'Sable', light: '#f3e7c9', dark: '#c9a46a' },
        { id: 'forest', key: 'forest', label: 'Forêt', light: '#c9d8b6', dark: '#3f6b4a' },
        { id: 'petrol', key: 'petrol', label: 'Pétrole', light: '#cfe0e3', dark: '#2f6670' },
        { id: 'aurora', key: 'aurora', label: 'Aurore', light: '#d5efe6', dark: '#5f6fb0' },
        { id: 'ice', key: 'ice', label: 'Glace', light: '#e6f2f8', dark: '#7fa7c2' },
        { id: 'coral', key: 'coral', label: 'Corail', light: '#fbe3d6', dark: '#e07a5f' },
        { id: 'olive', key: 'olive', label: 'Olive', light: '#e8e6c8', dark: '#8a8c4a' },
        { id: 'coffee', key: 'coffee', label: 'Café', light: '#e6d2bc', dark: '#6f4e37' },
        { id: 'bubblegum', key: 'bubblegum', label: 'Chewing-gum', light: '#ffe3f1', dark: '#e48fbf' },
        { id: 'cherry', key: 'cherry', label: 'Cerise', light: '#f6dede', dark: '#9e2a3a' },
        { id: 'midnight', key: 'midnight', label: 'Minuit', light: '#5a6788', dark: '#1f2538' },
        { id: 'gilded', key: 'gilded', label: 'Doré', light: '#f7e7b0', dark: '#b8902c' },
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

    // Matières : texture posée sur les couleurs (html[data-board-mat], cf. css/components/boardTheme.css)
    const MATS = [
        { id: 'none', key: 'none', label: 'Aucune', free: true },
        { id: 'paper', key: 'paper', label: 'Papier', own: 'mat-paper' },
        { id: 'tile', key: 'tile', label: 'Carrelage', own: 'mat-tile' },
        { id: 'felt', key: 'felt', label: 'Feutrine', own: 'mat-felt' },
        { id: 'walnut', key: 'walnut', label: 'Noyer', own: 'mat-walnut' },
        { id: 'lava', key: 'lava', label: 'Lave', own: 'mat-lava' },
        { id: 'mosaic', key: 'mosaic', label: 'Mosaïque', own: 'mat-mosaic' },
        { id: 'frost', key: 'frost', label: 'Givre', own: 'mat-frost' },
        { id: 'carbon', key: 'carbon', label: 'Carbone', own: 'mat-carbon' },
        { id: 'marble', key: 'marble', label: 'Marbre', own: 'mat-marble' },
    ];
    const matById = id => MATS.find(m => m.id === id && unlocked(m)) || MATS[0];
    let mat = MATS[0];
    try { mat = matById(localStorage.getItem('boardMat')); } catch (e) { }
    function applyMat() {
        const el = document.documentElement;
        if (mat.id === 'none') delete el.dataset.boardMat;
        else el.dataset.boardMat = mat.id;
    }
    applyMat();

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
    const matLabel = m => tr(`pieces.mat.${m.key}`, m.label);

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
            box.querySelectorAll('[data-board-mat]').forEach(el => {
                const m = matById(el.dataset.boardMat);
                const on = m.id === mat.id;
                el.classList.toggle('is-active', on);
                el.setAttribute('aria-pressed', String(on));
                el.title = matLabel(m);
                el.setAttribute('aria-label', matLabel(m));
            });
            box.querySelectorAll('.nav__pieces-shop span').forEach(s => { s.textContent = tr('nav.shop', 'Boutique'); });
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

    function setBoardMat(id) {
        mat = matById(id);
        try { localStorage.setItem('boardMat', mat.id); } catch (e) { }
        applyMat();
        render();
        window.dispatchEvent(new CustomEvent('boardMatChanged', { detail: { id: mat.id } }));
    }
    window.setBoardMat = setBoardMat;

    // Catalogue pour la page Boutique (js/pages/shop.js)
    window.pieceCatalog = {
        sets: SETS, boards: BOARDS, mats: MATS, unlocked, url,
        label, boardLabel, matLabel,
        current: () => current, board: () => board, mat: () => mat,
    };

    function setup() {
        const sets = SETS.filter(unlocked);
        const mats = MATS.filter(unlocked);
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
                    ${mats.length > 1 ? `<li class="nav__pieces-heading" data-key="pieces.matTitle" data-fb="Matière"></li>
                    <li class="nav__pieces-boards">${mats.map(m => `<button type="button" class="nav__pieces-swatch nav__pieces-mat mat--${m.id}" data-board-mat="${m.id}"></button>`).join('')}</li>` : ''}
                    <li><a class="nav__pieces-shop" href="/shop"><i class="fas fa-store"></i> <span></span></a></li>
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
                const mt = e.target.closest('[data-board-mat]');
                if (mt) { e.stopPropagation(); setBoardMat(mt.dataset.boardMat); return; }
                if (e.target.closest('.nav__pieces-shop')) { toggle(false); return; }
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
        let ps = null, bt = null, bm = null;
        try { ps = localStorage.getItem('pieceSet'); bt = localStorage.getItem('boardTheme'); bm = localStorage.getItem('boardMat'); } catch (e) { }
        const prevSet = current.id;
        current = byId(ps || current.id);
        board = boardById(bt || board.id);
        mat = matById(bm || mat.id);
        applyBoard();
        applyMat();
        setup();
        if (current.id !== prevSet) refreshImages();
    });

    window.addEventListener('languageChanged', render);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
    else setup();
})();

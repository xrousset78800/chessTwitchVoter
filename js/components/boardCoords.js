/**
 * Coordonnées (a-h, 1-8) affichées autour de l'échiquier plutôt que dessus.
 * Suit l'orientation (retournement) et la taille réelle du plateau chessboard.js.
 * À charger avant la création des Chessboard() pour que leur largeur tienne compte de la marge.
 */
(function () {
    const FILES = 'abcdefgh';

    function attach(id) {
        const el = document.getElementById(id);
        if (!el || el.dataset.coords) return;
        el.dataset.coords = '1';

        const wrap = document.createElement('div');
        wrap.className = 'board-coords';
        el.parentNode.insertBefore(wrap, el);
        wrap.appendChild(el);

        const ranks = document.createElement('div');
        ranks.className = 'board-coords__ranks';
        const files = document.createElement('div');
        files.className = 'board-coords__files';
        for (let i = 0; i < 8; i++) {
            ranks.appendChild(document.createElement('span'));
            files.appendChild(document.createElement('span'));
        }
        wrap.append(ranks, files);

        let raf = 0;
        const update = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                const board = el.querySelector('.board-b72b1');
                if (!board || !board.clientWidth) return;
                const first = board.querySelector('[data-square]');
                const white = !first || first.dataset.square === 'a8';
                const b = board.getBoundingClientRect();
                const w = wrap.getBoundingClientRect();
                const left = b.left - w.left + board.clientLeft;
                const top = b.top - w.top + board.clientTop;
                const size = board.clientWidth;

                Object.assign(ranks.style, { top: `${top}px`, height: `${size}px`, left: `${left - board.clientLeft}px` });
                Object.assign(files.style, { left: `${left}px`, width: `${size}px`, top: `${b.bottom - w.top}px` });
                [...ranks.children].forEach((s, i) => { s.textContent = white ? 8 - i : i + 1; });
                [...files.children].forEach((s, i) => { s.textContent = white ? FILES[i] : FILES[7 - i]; });
                wrap.classList.add('is-ready');
            });
        };

        // Redessin du plateau (retournement, position) et changement de taille
        new MutationObserver(update).observe(el, { childList: true, subtree: true });
        if (window.ResizeObserver) new ResizeObserver(update).observe(el);
        window.addEventListener('resize', update);
        update();
    }

    ['myBoard', 'liveBoard', 'liveBoardT'].forEach(attach);
    window.BoardCoords = { attach };
})();

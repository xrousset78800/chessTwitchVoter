/**
 * PHANTOM TWITCHESS - Flèches et cases surlignées sur un échiquier chessboard.js
 * Comme sur chess.com : clic droit glissé = flèche, clic droit sur une case = case surlignée,
 * Maj / Ctrl / Alt changent la couleur, un clic gauche ou un coup joué efface tout.
 * Script classique : expose window.BoardAnnotations
 */
(function () {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const COLORS = {
        default: 'rgb(255, 170, 0)',
        shift:   'rgb(130, 200, 60)',
        ctrl:    'rgb(240, 72, 72)',
        alt:     'rgb(72, 175, 245)'
    };
    const SQUARE_DEFAULT = 'rgb(235, 97, 80)';

    const colorKey = e => e.shiftKey ? 'shift' : e.ctrlKey ? 'ctrl' : e.altKey ? 'alt' : 'default';
    const fileIndex = sq => sq.charCodeAt(0) - 97;
    const rankIndex = sq => Number(sq[1]) - 1;

    class BoardAnnotations {
        constructor(container, options = {}) {
            this.container = container;
            this.draggable = !!options.draggable;
            this.arrows = new Map();  // "e2e4" -> clé de couleur
            this.squares = new Map(); // "e4" -> clé de couleur
            this.drawing = null;      // { from, to, color } pendant un clic droit
            this.positionKey = null;

            if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
            container.classList.add('board--annotatable');
            if (this.draggable) container.classList.add('board--draggable');

            this.svg = document.createElementNS(SVG_NS, 'svg');
            this.svg.classList.add('board-annotations');
            container.appendChild(this.svg);

            // Avant chessboard.js (capture) : un clic droit ne doit pas saisir la pièce
            container.addEventListener('mousedown', e => this.onMouseDown(e), true);
            // Pas de menu du navigateur autour de l'échiquier : on rate vite une case en traçant une flèche
            (container.closest('.board-wrapper, .board-container') || container)
                .addEventListener('contextmenu', e => e.preventDefault());
            window.addEventListener('mousemove', e => this.onMouseMove(e));
            window.addEventListener('mouseup', e => this.onMouseUp(e));

            // Un coup joué (ou une nouvelle position) efface les annotations
            new MutationObserver(() => this.onBoardMutation())
                .observe(container, { childList: true, subtree: true });
            new ResizeObserver(() => this.render()).observe(container);
            this.positionKey = this.readPosition();
        }

        squareAt(e) {
            const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-square]');
            return el && this.container.contains(el) ? el.dataset.square : null;
        }

        onMouseDown(e) {
            if (e.button === 2) {
                e.stopPropagation();
                e.preventDefault();
                const from = this.squareAt(e);
                if (from) this.drawing = { from, to: from, color: colorKey(e) };
                return;
            }
            if (e.button !== 0) return;
            this.clear();
            if (this.draggable) {
                // La pièce saisie par chessboard.js est un <img> ajouté au <body>
                requestAnimationFrame(() => {
                    const dragged = [...document.querySelectorAll('body > img.piece-417db')]
                        .some(img => img.style.display !== 'none');
                    document.body.classList.toggle('is-dragging-piece', dragged);
                });
            }
        }

        onMouseMove(e) {
            if (!this.drawing) return;
            const to = this.squareAt(e);
            if (to && to !== this.drawing.to) {
                this.drawing.to = to;
                this.render();
            }
        }

        onMouseUp(e) {
            document.body.classList.remove('is-dragging-piece');
            if (e.button !== 2 || !this.drawing) return;
            const { from, color } = this.drawing;
            const to = this.squareAt(e) || this.drawing.to;
            this.drawing = null;
            if (from === to) this.toggle(this.squares, from, color);
            else this.toggle(this.arrows, from + to, color);
            this.render();
        }

        // Même annotation et même couleur : on l'enlève ; autre couleur : on la remplace
        toggle(map, key, color) {
            if (map.get(key) === color) map.delete(key);
            else map.set(key, color);
        }

        readPosition() {
            return [...this.container.querySelectorAll('[data-square]')]
                .map(sq => sq.querySelector('[data-piece]')?.dataset.piece || '')
                .join(',');
        }

        onBoardMutation() {
            const key = this.readPosition();
            if (key === this.positionKey) return;
            this.positionKey = key;
            // Pendant une animation chessboard.js les pièces passent par des états intermédiaires : on attend la fin
            clearTimeout(this.mutationTimer);
            this.mutationTimer = setTimeout(() => this.clear(), 50);
        }

        clear() {
            if (this.arrows.size === 0 && this.squares.size === 0) return;
            this.arrows.clear();
            this.squares.clear();
            this.render();
        }

        // Centre et taille d'une case, relatifs au conteneur
        geometry(square) {
            const el = this.container.querySelector(`[data-square="${square}"]`);
            if (!el) return null;
            const box = this.container.getBoundingClientRect();
            const r = el.getBoundingClientRect();
            return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2, size: r.width, left: r.left - box.left, top: r.top - box.top };
        }

        render() {
            const svg = this.svg;
            svg.replaceChildren();
            svg.setAttribute('width', this.container.clientWidth);
            svg.setAttribute('height', this.container.clientHeight);

            this.squares.forEach((color, sq) => {
                const g = this.geometry(sq);
                if (!g) return;
                const rect = document.createElementNS(SVG_NS, 'rect');
                rect.setAttribute('x', g.left);
                rect.setAttribute('y', g.top);
                rect.setAttribute('width', g.size);
                rect.setAttribute('height', g.size);
                rect.setAttribute('fill', color === 'default' ? SQUARE_DEFAULT : COLORS[color]);
                rect.setAttribute('opacity', 0.75);
                svg.appendChild(rect);
            });

            const arrows = [...this.arrows];
            if (this.drawing && this.drawing.from !== this.drawing.to) {
                arrows.push([this.drawing.from + this.drawing.to, this.drawing.color]);
            }
            arrows.forEach(([key, color]) => this.drawArrow(key.slice(0, 2), key.slice(2), COLORS[color]));
        }

        drawArrow(from, to, color) {
            const a = this.geometry(from);
            const b = this.geometry(to);
            if (!a || !b) return;
            const size = a.size;
            const points = [{ x: a.x, y: a.y }];

            // Saut de cavalier : flèche en L, d'abord sur l'axe le plus long
            const df = Math.abs(fileIndex(to) - fileIndex(from));
            const dr = Math.abs(rankIndex(to) - rankIndex(from));
            if ((df === 1 && dr === 2) || (df === 2 && dr === 1)) {
                points.push(dr === 2 ? { x: a.x, y: b.y } : { x: b.x, y: a.y });
            }
            points.push({ x: b.x, y: b.y });

            const width = size * 0.2;
            const headLength = size * 0.42;
            const headWidth = size * 0.5;

            // Le trait part un peu après le centre et s'arrête à la base de la pointe
            const start = points[0], next = points[1];
            const len0 = Math.hypot(next.x - start.x, next.y - start.y);
            const offset = size * 0.3;
            points[0] = { x: start.x + (next.x - start.x) / len0 * offset, y: start.y + (next.y - start.y) / len0 * offset };

            const end = points[points.length - 1], prev = points[points.length - 2];
            const len = Math.hypot(end.x - prev.x, end.y - prev.y);
            const ux = (end.x - prev.x) / len, uy = (end.y - prev.y) / len;
            const base = { x: end.x - ux * headLength, y: end.y - uy * headLength };
            points[points.length - 1] = base;

            const group = document.createElementNS(SVG_NS, 'g');
            group.setAttribute('opacity', 0.8);
            const line = document.createElementNS(SVG_NS, 'polyline');
            line.setAttribute('points', points.map(p => `${p.x},${p.y}`).join(' '));
            line.setAttribute('fill', 'none');
            line.setAttribute('stroke', color);
            line.setAttribute('stroke-width', width);
            line.setAttribute('stroke-linejoin', 'miter');
            const head = document.createElementNS(SVG_NS, 'polygon');
            const px = -uy * headWidth / 2, py = ux * headWidth / 2;
            head.setAttribute('points', `${end.x},${end.y} ${base.x + px},${base.y + py} ${base.x - px},${base.y - py}`);
            head.setAttribute('fill', color);
            group.append(line, head);
            this.svg.appendChild(group);
        }
    }

    const instances = new Map();
    window.BoardAnnotations = {
        // À appeler après Chessboard(id, …)
        attach(id, options) {
            const container = document.getElementById(id);
            if (!container) return null;
            if (!instances.has(id)) instances.set(id, new BoardAnnotations(container, options));
            return instances.get(id);
        },
        clear(id) {
            instances.get(id)?.clear();
        }
    };
})();

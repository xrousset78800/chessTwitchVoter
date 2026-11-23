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
            this.lastMove = null;     // { from, to } : dernier coup joué, toujours surligné
            this.overlay = null;      // { kind: 'lead' | 'win', from, to, label } : coup en tête / coup gagnant

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
            this.settled = this.readMap();
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

        // Case -> pièce (indépendant de l'orientation de l'échiquier)
        readMap() {
            const map = {};
            this.container.querySelectorAll('[data-square]').forEach(sq => {
                map[sq.dataset.square] = sq.querySelector('[data-piece]')?.dataset.piece || '';
            });
            return map;
        }

        readPosition() {
            const map = this.readMap();
            return Object.keys(map).sort().map(k => map[k]).join(',');
        }

        onBoardMutation() {
            // Échiquier redessiné (retourné, redimensionné) ou pièces déplacées : on attend la fin des animations
            clearTimeout(this.settleTimer);
            this.settleTimer = setTimeout(() => this.settle(), 60);
            const key = this.readPosition();
            if (key === this.positionKey) return;
            this.positionKey = key;
            clearTimeout(this.mutationTimer);
            this.mutationTimer = setTimeout(() => this.clear(), 50);
        }

        /**
         * Déduit le dernier coup de la différence entre deux positions stables.
         * Marche quel que soit le chemin du coup : glisser, vote, réseau, problème, Rush.
         */
        settle() {
            const now = this.readMap();
            const before = this.settled || {};
            const changed = Object.keys(now).filter(sq => (before[sq] || '') !== now[sq]);
            if (changed.length) {
                const emptied = changed.filter(sq => !now[sq]);
                const filled = changed.filter(sq => now[sq]);
                // Début d'animation (la case de départ s'est vidée, l'arrivée pas encore remplie) : on attend
                if (!filled.length && emptied.length <= 2) { this.applyLastMove(); return; }
                this.settled = now;
                if (filled.length <= 2 && emptied.length >= 1 && emptied.length <= 2 && changed.length <= 4) {
                    // Roque : la case du roi ; prise en passant : la case du pion qui a bougé
                    const to = filled.find(sq => /K$/.test(now[sq])) || filled[0];
                    const from = emptied.find(sq => before[sq] === now[to]) || emptied[0];
                    this.lastMove = { from, to };
                } else {
                    this.lastMove = null; // nouvelle position (partie, problème…)
                }
                this.overlay = null;
                this.overlaySig = '';
                this.render();
            }
            this.applyLastMove();
        }

        /** Coup joué connu par l'appelant (prioritaire sur la déduction) */
        setLastMove(from, to) {
            this.lastMove = from && to ? { from, to } : null;
            this.applyLastMove();
        }

        applyLastMove() {
            const lm = this.lastMove;
            this.container.querySelectorAll('[data-square]').forEach(el => {
                const sq = el.dataset.square;
                const on = !!lm && (sq === lm.from || sq === lm.to);
                if (el.classList.contains('is-last-move') !== on) el.classList.toggle('is-last-move', on);
                const dest = on && sq === lm.to;
                if (el.classList.contains('is-last-move--to') !== dest) el.classList.toggle('is-last-move--to', dest);
            });
        }

        /** Flèche du coup en tête du vote ('lead') ou du coup gagnant avec son étiquette ('win') */
        setOverlay(overlay) {
            const o = overlay && overlay.from && overlay.to ? overlay : null;
            const sig = o ? `${o.kind}${o.from}${o.to}${o.label || ''}${o.who ? `${o.who.name}${o.who.via}${o.who.pic}` : ''}` : '';
            if (sig === (this.overlaySig || '')) return;
            this.overlaySig = sig;
            this.overlay = o;
            this.render();
        }

        /** Aperçu au survol d'un coup de la liste : flèche légère, posée par-dessus le reste */
        setHover(move) {
            const h = move && move.from && move.to ? { from: move.from, to: move.to } : null;
            const sig = h ? h.from + h.to : '';
            if (sig === (this.hoverSig || '')) return;
            this.hoverSig = sig;
            this.hover = h;
            this.render();
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
            this.drawOverlay();
            if (this.hover) this.drawArrow(this.hover.from, this.hover.to, 'rgb(250, 246, 242)', { opacity: 0.95, scale: 1, dash: true })
                ?.classList.add('board-annotations__hover');
        }

        drawOverlay() {
            const o = this.overlay;
            if (!o) return;
            const win = o.kind === 'win';
            // Coup retenu : orange posé, à peine plus épais qu'une flèche normale ; coup en tête : gris discret
            const group = this.drawArrow(o.from, o.to, win ? 'rgb(255, 138, 61)' : 'rgb(185, 174, 166)', {
                opacity: win ? 0.85 : 0.5, scale: win ? 1.1 : 0.85
            });
            if (!group) return;
            group.classList.add('board-annotations__vote', win ? 'is-win' : 'is-lead');
            if (!win || !o.label) return;
            // Étiquette sombre au-dessus de la case d'arrivée : « Cf3 · 42 % », puis photo, @pseudo et #chaîne du votant
            const b = this.geometry(o.to);
            const w = this.container.clientWidth;
            const fs = Math.max(11, b.size * 0.22);
            const pad = fs * 0.6, gap = fs * 0.35;
            const el = (tag, attrs = {}) => {
                const n = document.createElementNS(SVG_NS, tag);
                for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
                return n;
            };
            const label = el('g');
            label.classList.add('board-annotations__label');
            const rect = el('rect', { rx: 3, fill: 'rgba(16, 13, 11, 0.92)', stroke: 'rgba(255, 255, 255, 0.14)', 'stroke-width': 1 });
            label.appendChild(rect);
            this.svg.appendChild(label);
            const font = { 'font-family': "'IBM Plex Sans', system-ui, sans-serif", 'dominant-baseline': 'central' };
            const measure = (t, fallback) => { let x = 0; try { x = t.getComputedTextLength(); } catch {} return x || fallback; };

            const top = el('text', { ...font, 'font-size': fs, 'font-weight': 700, fill: '#f4eee8' });
            top.textContent = o.label;
            label.appendChild(top);
            const topW = measure(top, o.label.length * fs * 0.6);

            const who = o.who;
            const fs2 = fs * 0.82, av = fs * 1.35;
            let line2 = null, line2W = 0;
            if (who) {
                line2 = el('text', { ...font, 'font-size': fs2, 'font-weight': 600, fill: '#f4eee8' });
                line2.appendChild(document.createTextNode(`@${who.name}`));
                if (who.via) {
                    const via = el('tspan', { fill: '#b9aea6', 'font-weight': 400 });
                    via.textContent = `  ${who.via.startsWith('#') ? who.via : '#' + who.via}`;
                    line2.appendChild(via);
                }
                label.appendChild(line2);
                line2W = av + gap + measure(line2, (who.name.length + (who.via?.length || 0) + 3) * fs2 * 0.58);
            }

            const pw = Math.max(topW, line2W) + pad * 2;
            const ph = who ? pad * 2 + fs * 1.2 + gap + av : fs * 1.9;
            const cx = Math.min(Math.max(b.x, pw / 2 + 2), w - pw / 2 - 2);
            let y0 = b.top - ph - 4;
            if (y0 < 0) y0 = b.top + b.size + 4;
            const x0 = cx - pw / 2;
            Object.entries({ x: x0, y: y0, width: pw, height: ph }).forEach(([k, v]) => rect.setAttribute(k, v));
            top.setAttribute('x', x0 + pad);
            top.setAttribute('y', who ? y0 + pad + fs * 0.6 : y0 + ph / 2);
            if (who) {
                const ay = y0 + pad + fs * 1.2 + gap;
                // Photo Twitch (carré à angles nets), sinon initiale sur fond neutre
                label.appendChild(el('rect', { x: x0 + pad, y: ay, width: av, height: av, rx: 2, fill: '#2b2420' }));
                if (who.pic) {
                    const clipId = `ba-av-${Math.random().toString(36).slice(2, 8)}`;
                    const clip = el('clipPath', { id: clipId });
                    clip.appendChild(el('rect', { x: x0 + pad, y: ay, width: av, height: av, rx: 2 }));
                    label.appendChild(clip);
                    const img = el('image', { x: x0 + pad, y: ay, width: av, height: av, 'clip-path': `url(#${clipId})`, preserveAspectRatio: 'xMidYMid slice' });
                    img.setAttribute('href', who.pic);
                    label.appendChild(img);
                } else {
                    const ini = el('text', { ...font, x: x0 + pad + av / 2, y: ay + av / 2, 'text-anchor': 'middle', 'font-size': fs2, 'font-weight': 700, fill: '#b9aea6' });
                    ini.textContent = who.name.charAt(0).toUpperCase();
                    label.appendChild(ini);
                }
                line2.setAttribute('x', x0 + pad + av + gap);
                line2.setAttribute('y', ay + av / 2);
                label.appendChild(line2);
            }
        }

        drawArrow(from, to, color, opts = {}) {
            const a = this.geometry(from);
            const b = this.geometry(to);
            if (!a || !b || !a.size) return null; // échiquier masqué
            const size = a.size;
            const points = [{ x: a.x, y: a.y }];

            // Saut de cavalier : flèche en L, d'abord sur l'axe le plus long
            const df = Math.abs(fileIndex(to) - fileIndex(from));
            const dr = Math.abs(rankIndex(to) - rankIndex(from));
            if ((df === 1 && dr === 2) || (df === 2 && dr === 1)) {
                points.push(dr === 2 ? { x: a.x, y: b.y } : { x: b.x, y: a.y });
            }
            points.push({ x: b.x, y: b.y });

            const k = opts.scale || 1;
            const width = size * 0.2 * k;
            const headLength = size * 0.42 * Math.min(k, 1.1);
            const headWidth = size * 0.5 * k;

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
            group.setAttribute('opacity', opts.opacity ?? 0.8);
            const line = document.createElementNS(SVG_NS, 'polyline');
            line.setAttribute('points', points.map(p => `${p.x},${p.y}`).join(' '));
            line.setAttribute('fill', 'none');
            line.setAttribute('stroke', color);
            line.setAttribute('stroke-width', width);
            line.setAttribute('stroke-linejoin', 'miter');
            // Aperçu : trait en pointillés, pour ne pas le confondre avec une flèche posée
            if (opts.dash) line.setAttribute('stroke-dasharray', `${width * 1.5} ${width * 0.9}`);
            const head = document.createElementNS(SVG_NS, 'polygon');
            const px = -uy * headWidth / 2, py = ux * headWidth / 2;
            head.setAttribute('points', `${end.x},${end.y} ${base.x + px},${base.y + py} ${base.x - px},${base.y - py}`);
            head.setAttribute('fill', color);
            group.append(line, head);
            this.svg.appendChild(group);
            return group;
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
        },
        get(id) {
            return instances.get(id) || null;
        }
    };
})();

/**
 * Jauge d'évaluation à gauche d'un échiquier (Blancs en bas) : Stockfish dans un Worker dédié,
 * séparé de celui des bots. La position est relue régulièrement ; chaque nouvelle position
 * interrompt l'analyse précédente.
 *
 *   const bar = EvalBar.attach({ host, boardEl, getFen });
 *   bar.setEnabled(true);
 *
 * host : conteneur positionné (la jauge s'y place en absolu, sur la hauteur de l'échiquier).
 */
(function () {
    const ENGINE_URL = '/vendor/stockfish/stockfish-19-lite-single.js';
    const DEPTH = 16;

    /** Part des Blancs (0 à 1) pour un avantage en centipions (même courbe que les sites d'échecs) */
    const share = cp => 1 / (1 + Math.exp(-0.004 * cp));

    function attach({ host, boardEl, getFen }) {
        const bar = document.createElement('div');
        bar.className = 'eval-bar';
        bar.hidden = true;
        bar.innerHTML = '<div class="eval-bar__white"></div><span class="eval-bar__label"></span>';
        host.appendChild(bar);
        const fill = bar.querySelector('.eval-bar__white');
        const label = bar.querySelector('.eval-bar__label');

        let worker = null, enabled = false, timer = null;
        let fen = null, turn = 'w', searching = false, ignore = 0;

        function place() {
            const b = boardEl.querySelector('.board-b72b1') || boardEl;
            const h = host.getBoundingClientRect(), r = b.getBoundingClientRect();
            if (!r.height) return;
            bar.style.top = `${r.top - h.top}px`;
            bar.style.height = `${r.height}px`;
        }

        /** Score du point de vue des Blancs : { cp } ou { mate: coups, whiteWins } (mate 0 : déjà mat) */
        function show(s) {
            const isMate = s.mate != null;
            const whiteUp = isMate ? s.whiteWins : s.cp >= 0;
            let text;
            if (isMate) text = s.mate === 0 ? '#' : `M${s.mate}`;
            else {
                const p = Math.abs(s.cp) / 100;
                text = p >= 10 ? p.toFixed(0) : p.toFixed(1);
            }
            const pct = isMate ? (whiteUp ? 1 : 0) : share(s.cp);
            fill.style.height = `${(pct * 100).toFixed(1)}%`;
            label.textContent = text;
            label.classList.toggle('is-white', whiteUp);
            const side = whiteUp ? 'Blancs' : 'Noirs';
            bar.title = isMate
                ? (s.mate === 0 ? `Mat : victoire des ${side}` : `Mat en ${s.mate} pour les ${side}`)
                : `Évaluation : ${s.cp >= 0 ? '+' : '−'}${(Math.abs(s.cp) / 100).toFixed(2)} (profondeur ${DEPTH})`;
        }

        function onLine(line) {
            if (line.startsWith('bestmove')) {
                if (ignore > 0) ignore--; else searching = false;
                return;
            }
            if (ignore > 0 || !line.startsWith('info ')) return;
            const m = /\bscore (cp|mate) (-?\d+)/.exec(line);
            if (!m || /\b(lowerbound|upperbound)\b/.test(line)) return;
            const n = Number(m[2]);
            const sign = turn === 'w' ? 1 : -1;   // Stockfish note du point de vue du camp au trait
            if (m[1] === 'cp') show({ cp: n * sign });
            // mate 0 : le camp au trait est mat
            else show({ mate: Math.abs(n), whiteWins: n === 0 ? turn === 'b' : n * sign > 0 });
        }

        function analyse(next) {
            if (!worker) {
                try { worker = new Worker(ENGINE_URL); } catch (e) { console.warn('Jauge : Stockfish indisponible', e); return; }
                worker.onmessage = e => String(e.data ?? '').split('\n').forEach(l => onLine(l.trim()));
                worker.postMessage('uci');
                worker.postMessage('setoption name Threads value 1');
            }
            if (searching) { ignore++; worker.postMessage('stop'); }
            fen = next;
            turn = next.split(' ')[1] === 'b' ? 'b' : 'w';
            searching = true;
            worker.postMessage(`position fen ${next}`);
            worker.postMessage(`go depth ${DEPTH}`);
        }

        function tick() {
            place();
            const next = getFen();
            if (next && next !== fen) analyse(next);
        }

        function setEnabled(on) {
            enabled = !!on;
            bar.hidden = !enabled;
            clearInterval(timer);
            timer = null;
            if (enabled) {
                fen = null;
                tick();
                timer = setInterval(tick, 400);
            } else if (worker && searching) {
                ignore++;
                searching = false;
                worker.postMessage('stop');
            }
        }

        return { setEnabled, get enabled() { return enabled; }, place };
    }

    window.EvalBar = { attach };
})();

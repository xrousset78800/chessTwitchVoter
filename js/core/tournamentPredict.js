/**
 * Page Tournois : matchs en direct (tous tournois chess.com confondus), recherche par joueur,
 * pronostics sur la partie suivie (prochain coup, vainqueur). Serveur : predictions.js et
 * /api/tournament/live (server.js). Script classique chargé après liveTournament.js, dont il
 * réutilise l'état (stateT, tournamentData, pendingGameT, loadAndRenderTournament…).
 */
(() => {
    const T = (k, p, f) => window.tt(k, p, f);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const PICKS = ['1-0', '1/2-1/2', '0-1'];
    const PICK_KEY = { '1-0': 'white', '1/2-1/2': 'draw', '0-1': 'black' };
    const fullMove = fen => parseInt(String(fen || '').split(' ')[5], 10) || 1;
    const boardOf = fen => String(fen || '').split(' ').slice(0, 2).join(' ');
    const logged = () => !!window.twitchAuth?.isLoggedIn;
    const authHeaders = () => ({ 'Content-Type': 'application/json', ...(window.twitchAuth?.authHeaders?.() || {}) });
    const pageVisible = () => document.visibilityState === 'visible'
        && (document.getElementById('page-tournament')?.getClientRects().length ?? 0) > 0;
    let rules = { move: { xp: 8, coins: 2 }, streak: { every: 5, xp: 25, coins: 10 }, winner: { xp: 25, coins: 10 }, winnerDraw: { xp: 40, coins: 20 }, winnerLock: 10 };

    // ───────────── Matchs en direct ─────────────
    let liveGames = [];
    let liveBusy = false;
    let liveAt = 0;

    async function loadLive(force = false) {
        if (liveBusy || (!force && Date.now() - liveAt < 25000)) return;
        liveBusy = true;
        try {
            const r = await fetch('/api/tournament/live');
            if (r.ok) {
                liveGames = (await r.json()).games || [];
                liveAt = Date.now();
                renderLive();
                renderPlayerHits();
            }
        } catch { /* nouvel essai au prochain tour */ }
        liveBusy = false;
    }

    function votesHTML(v) {
        const n = v ? PICKS.reduce((s, p) => s + (v[p] || 0), 0) : 0;
        if (!n) return `<div class="tl-votes is-empty"><span>${esc(T('tlive.noVotes', null, 'Aucun vote'))}</span></div>`;
        const pct = p => Math.round(100 * (v[p] || 0) / n);
        return `<div class="tl-votes" title="${esc(PICKS.map(p => `${T('predict.' + PICK_KEY[p])} ${pct(p)} %`).join(' · '))}">
            <div class="tl-votes__bar">${PICKS.map(p => `<span class="tl-votes__seg tl-votes__seg--${PICK_KEY[p]}" style="flex:${v[p] || 0}"></span>`).join('')}</div>
            <span class="tl-votes__n">${esc(T('predict.votes', { n }, `${n} vote(s)`))}</span></div>`;
    }

    const playerHTML = (p, side) => `<div class="tl-player tl-player--${side}"><span class="tl-player__dot"></span>`
        + `${p.title ? `<span class="player-title">${esc(p.title)}</span> ` : ''}<span class="tl-player__name">${esc(p.name)}</span>`
        + `<span class="tl-player__elo">${esc(p.elo ?? '')}</span></div>`;

    function renderLive() {
        const grid = document.getElementById('tLiveGrid');
        const count = document.getElementById('tLiveCount');
        if (!grid) return;
        if (count) count.textContent = liveGames.length ? T('tlive.count', { n: liveGames.length }, `${liveGames.length}`) : '';
        if (!liveGames.length) {
            grid.innerHTML = `<p class="tl-empty">${esc(T('tlive.empty', null, 'Aucune partie en cours pour l\'instant.'))}</p>`;
            return;
        }
        const followed = stateT.polling && stateT.currentGame ? `${stateT.tournamentSlug}:${stateT.currentGame.id}` : null;
        grid.innerHTML = liveGames.map((g, i) => {
            const locked = fullMove(g.fen) > rules.winnerLock;
            const mine = myWinnerPicks[`${g.room.slug}:${g.id}`];
            const isFollowed = followed === `${g.room.slug}:${g.id}`;
            return `<article class="tl-card${isFollowed ? ' is-followed' : ''}" data-tl="${i}">
                <button type="button" class="tl-card__board" data-tl-follow="${i}" aria-label="${esc(T('tlive.follow', null, 'Suivre'))}">${miniBoardHTML(g.fen)}</button>
                <div class="tl-card__body">
                    <div class="tl-card__event" title="${esc(g.event.name)}${g.room.name && g.room.name !== g.event.name ? ' · ' + esc(g.room.name) : ''}">${esc(g.event.name)}</div>
                    ${playerHTML(g.white, 'w')}${playerHTML(g.black, 'b')}
                    ${votesHTML(g.votes)}
                    <div class="tl-card__actions">
                        <button type="button" class="tl-follow" data-tl-follow="${i}"><i class="fas fa-eye"></i> ${esc(isFollowed ? T('tlive.following', null, 'Suivie') : T('tlive.follow', null, 'Suivre'))}</button>
                        <div class="tl-pick" role="group" aria-label="${esc(T('predict.winnerTitle', null, 'Vainqueur'))}">
                            ${PICKS.map(p => `<button type="button" data-tl-vote="${i}" data-pick="${p}" class="${mine === p ? 'is-on' : ''}" ${locked ? 'disabled' : ''} title="${esc(locked ? T('predict.locked', { n: rules.winnerLock }) : T('predict.' + PICK_KEY[p]))}">${p === '1/2-1/2' ? '½' : p}</button>`).join('')}
                        </div>
                    </div>
                </div>
            </article>`;
        }).join('');
    }

    /** Ouvre la partie comme depuis la liste du tournoi (suivi en direct) */
    async function openLiveGame(g) {
        const input = document.getElementById('tournamentInput');
        if (input) input.value = g.event.slug;
        selectedEventSlug = g.event.slug;
        pendingGameT = String(g.id);
        setEventStepT(g.event.name);
        document.querySelector('#page-tournament .live-page')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        await loadAndRenderTournament(g.event.slug, g.event.index, g.room.slug);
    }

    // ───────────── Recherche par joueur (champ « Filtrer les tournois ») ─────────────
    const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    function renderPlayerHits() {
        const box = document.getElementById('tPlayerHits');
        const q = norm(document.getElementById('eventSearchInput')?.value.trim());
        if (!box) return;
        if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
        const hits = liveGames.map((g, i) => ({ g, i }))
            .filter(({ g }) => norm(g.white.name).includes(q) || norm(g.black.name).includes(q)).slice(0, 8);
        if (!hits.length) { box.hidden = true; box.innerHTML = ''; return; }
        box.hidden = false;
        box.innerHTML = `<div class="tp-hits__title"><span class="tg-live-dot"></span> ${esc(T('tlive.players', null, 'Parties en direct'))}</div>`
            + hits.map(({ g, i }) => `<button type="button" class="tp-hit" data-tl-follow="${i}">
                <span class="tp-hit__names">${esc(g.white.name)} <small>${esc(g.white.elo ?? '')}</small> – ${esc(g.black.name)} <small>${esc(g.black.elo ?? '')}</small></span>
                <span class="tp-hit__event">${esc(g.event.name)}</span></button>`).join('');
    }

    // ───────────── Pronostics sur la partie suivie ─────────────
    const myWinnerPicks = {};          // clé salle:partie -> pick (connu de cette session)
    const pred = { key: null, move: null, winner: null, votes: null, stats: null, sel: null, busy: false };
    const SINCE_KEY = 'cgPredictSince';
    const readSince = () => { try { return Number(localStorage.getItem(SINCE_KEY)) || 0; } catch { return 0; } };
    const writeSince = v => { try { localStorage.setItem(SINCE_KEY, String(v)); } catch { /* navigation privée */ } };

    function current() {
        const g = stateT.polling && stateT.currentGame;
        if (!g || !stateT.tournamentSlug) return null;
        const live = tournamentData?.games?.find(x => x.id === g.id) || g;
        return {
            g: live, room: stateT.tournamentSlug, key: `${stateT.tournamentSlug}:${g.id}`,
            round: tournamentData?.rounds?.find(r => r.id === g.roundId)?.slug || '',
            fen: stateT.lastFEN || live.currentFEN,
            ended: !!(live.result && live.result !== '*'),
        };
    }

    function gainText(gain) {
        if (!gain || (!gain.xp && !gain.coins)) return '';
        return ' · ' + T('predict.gain', { xp: gain.xp || 0, coins: gain.coins || 0 }, `+${gain.xp} XP · +${gain.coins}`);
    }

    function showResults(results) {
        for (const r of results) {
            let html;
            if (r.kind === 'move') html = r.hit
                ? `<strong>${esc(T('predict.hit', { san: r.played }, 'Bien vu !'))}</strong>${esc(gainText(r.gain))}${r.streak > 1 ? ` · ${esc(T('predict.streak', { n: r.streak }, `série ${r.streak}`))}` : ''}`
                : esc(T('predict.miss', { played: r.played, guess: r.guess }, 'Raté'));
            else html = r.hit
                ? `<strong>${esc(T('predict.winnerHit', { names: (r.names || []).join(' – ') }, 'Pronostic gagnant'))}</strong>${esc(gainText(r.gain))}`
                : esc(T('predict.winnerMiss', { names: (r.names || []).join(' – ') }, 'Pronostic perdu'));
            window.AppToast?.show(html, r.hit ? 'success' : 'info', 4000);
            if (r.hit) window.economy?.noteGain(r.gain);
        }
    }

    let stateBusy = false;
    async function pollState() {
        const c = current();
        if (!c || !logged() || stateBusy || !pageVisible()) return;
        stateBusy = true;
        try {
            const since = readSince();
            const q = new URLSearchParams({ room: c.room, game: c.g.id, since: since || Date.now() });
            const r = await fetch(`/api/predict/state?${q}`, { headers: authHeaders() });
            if (r.ok) {
                const d = await r.json();
                if (d.rules) rules = d.rules;
                if (since) showResults(d.results || []);
                const last = Math.max(since, d.now || 0, ...(d.results || []).map(x => x.at));
                writeSince(last);
                if (current()?.key === c.key) {
                    pred.key = c.key;
                    pred.move = d.move && boardOf(d.move.fen) === boardOf(stateT.lastFEN) ? d.move : null;
                    pred.winner = d.winner?.pick || null;
                    if (pred.winner) myWinnerPicks[c.key] = pred.winner;
                    pred.votes = d.votes;
                    pred.stats = d.stats;
                    renderPredict();
                }
            }
        } catch { /* nouvel essai au prochain tour */ }
        stateBusy = false;
    }

    async function postJSON(url, body) {
        const r = await fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw Object.assign(new Error(d.error || `HTTP ${r.status}`), { code: d.code });
        return d;
    }

    const errText = err => err.code === 'moved' ? T('predict.moved', null, 'La position a changé')
        : err.code === 'ended' ? T('predict.ended', null, 'Partie terminée')
        : err.code === 'locked' ? T('predict.locked', { n: rules.winnerLock })
        : err.message;

    async function voteWinner(room, gameId, pick, key) {
        if (!logged()) { askLogin(); return; }
        try {
            const d = await postJSON('/api/predict/winner', { room, game: gameId, pick });
            myWinnerPicks[key] = pick;
            if (pred.key === key) { pred.winner = pick; pred.votes = d.votes; renderPredict(); }
            const lg = liveGames.find(g => `${g.room.slug}:${g.id}` === key);
            if (lg) lg.votes = d.votes;
            renderLive();
            window.AppToast?.show(esc(T('predict.voted', { pick: T('predict.' + PICK_KEY[pick]) }, 'Vote enregistré')), 'success', 2500);
        } catch (err) {
            window.AppToast?.show(esc(errText(err)), 'error', 3000);
        }
    }

    function askLogin() {
        window.AppToast?.show(esc(T('predict.login', null, 'Connecte-toi avec Twitch pour pronostiquer')), 'info', 3500);
    }

    // Clic sur l'échiquier : pièce du camp au trait, puis case d'arrivée
    const sqEl = sq => document.querySelector(`#liveBoardT [data-square="${sq}"]`);
    function clearMarks(cls) { document.querySelectorAll(`#liveBoardT .${cls}`).forEach(e => e.classList.remove(cls)); }
    function paintMarks() {
        clearMarks('tp-from'); clearMarks('tp-dest'); clearMarks('tp-guess');
        if (pred.sel) {
            sqEl(pred.sel.from)?.classList.add('tp-from');
            pred.sel.dests.forEach(sq => sqEl(sq)?.classList.add('tp-dest'));
        }
        if (pred.move && !pred.sel) [pred.move.uci.slice(0, 2), pred.move.uci.slice(2, 4)].forEach(sq => sqEl(sq)?.classList.add('tp-guess'));
    }

    async function onBoardClick(e) {
        const square = e.target.closest('[data-square]')?.dataset.square;
        const c = current();
        if (!square || !c || c.ended || reviewT.game || pred.busy) return;
        if (!logged()) { askLogin(); return; }
        const chess = stateT.chess;
        if (pred.sel && pred.sel.dests.includes(square)) {
            const from = pred.sel.from;
            const piece = chess.get(from);
            const promo = piece?.type === 'p' && (square[1] === '8' || square[1] === '1') ? 'q' : '';
            pred.sel = null;
            pred.busy = true;
            paintMarks();
            try {
                const d = await postJSON('/api/predict/move', { room: c.room, game: c.g.id, round: c.round, slug: c.g.slug, fen: c.fen, uci: from + square + promo });
                pred.key = c.key;
                pred.move = d.move;
                renderPredict();
            } catch (err) {
                window.AppToast?.show(esc(errText(err)), 'error', 3000);
            }
            pred.busy = false;
            paintMarks();
            return;
        }
        const piece = chess.get(square);
        if (piece && piece.color === chess.turn() && square !== pred.sel?.from) {
            const dests = chess.moves({ square, verbose: true }).map(m => m.to);
            pred.sel = dests.length ? { from: square, dests } : null;
        } else pred.sel = null;
        paintMarks();
    }

    function renderPredict() {
        const card = document.getElementById('tPredict');
        if (!card) return;
        const c = current();
        card.hidden = !c;
        document.querySelector('#page-tournament .board-wrapper')?.classList.toggle('tp-armed', !!c && !c.ended && logged());
        if (!c) return;
        if (pred.key !== c.key) { pred.key = c.key; pred.move = null; pred.winner = myWinnerPicks[c.key] || null; pred.votes = null; }
        const body = card.querySelector('.tp-body');
        if (!logged()) {
            body.innerHTML = `<p class="tp-hint">${esc(T('predict.loginText', null, 'Devine le prochain coup et le vainqueur pour gagner de l\'XP et des pions.'))}</p>
                <button type="button" class="btn-primary btn-connect tp-login" data-tp-login><i class="fab fa-twitch"></i> ${esc(T('predict.loginBtn', null, 'Se connecter avec Twitch'))}</button>`;
            return;
        }
        const st = pred.stats;
        const locked = fullMove(c.fen) > rules.winnerLock;
        const moveLine = c.ended ? T('predict.ended', null, 'Partie terminée')
            : pred.move ? T('predict.yourGuess', { san: pred.move.san }, `Ton prono : ${pred.move.san}`)
            : T('predict.noGuess', null, 'Pas encore de prono pour ce coup.');
        body.innerHTML = `
            <div class="tp-section">
                <div class="tp-label"><i class="fas fa-crosshairs"></i> ${esc(T('predict.moveTitle', null, 'Prochain coup'))}</div>
                <p class="tp-guess${pred.move ? ' is-set' : ''}">${esc(moveLine)}</p>
                ${c.ended ? '' : `<p class="tp-hint">${esc(T('predict.moveHint', null, 'Clique une pièce du camp au trait sur l\'échiquier, puis sa case d\'arrivée.'))}</p>`}
            </div>
            <div class="tp-section">
                <div class="tp-label"><i class="fas fa-trophy"></i> ${esc(T('predict.winnerTitle', null, 'Vainqueur'))}</div>
                <div class="tp-picks" role="group">
                    ${PICKS.map(p => `<button type="button" data-tp-pick="${p}" class="${pred.winner === p ? 'is-on' : ''}" ${locked || c.ended ? 'disabled' : ''}>${esc(T('predict.' + PICK_KEY[p]))}</button>`).join('')}
                </div>
                ${votesHTML(pred.votes)}
                <p class="tp-hint">${esc(locked || c.ended ? T('predict.locked', { n: rules.winnerLock }) : T('predict.lockIn', { n: rules.winnerLock }))}</p>
            </div>
            <p class="tp-stats">${st ? esc(T('predict.stats', { hits: st.moveHits, total: st.moveTotal, streak: st.streak, whits: st.winnerHits, wtotal: st.winnerTotal })) : ''}</p>
            <details class="tp-rules"><summary>${esc(T('predict.rulesTitle', null, 'Barème'))}</summary>
                <p>${esc(T('predict.rules', { xp: rules.move.xp, coins: rules.move.coins, every: rules.streak.every, sxp: rules.streak.xp, scoins: rules.streak.coins, wxp: rules.winner.xp, wcoins: rules.winner.coins, dxp: rules.winnerDraw.xp, dcoins: rules.winnerDraw.coins }))}</p></details>`;
        paintMarks();
    }

    // ───────────── Vote du chat Twitch sur le prochain coup ─────────────
    // Décompte local (un vote par spectateur, modifiable) ; résultat affiché dès que le coup est joué.
    const chat = { key: null, fen: null, votes: new Map(), last: null };
    const chatOn = () => !!window.twitch?.isConnected;
    function chatReset(c) { chat.key = c?.key || null; chat.fen = c?.fen || null; chat.votes = new Map(); }
    function chatTally() {
        const counts = new Map();
        for (const v of chat.votes.values()) {
            const e = counts.get(v.uci) || { san: v.san, uci: v.uci, n: 0 };
            e.n++;
            counts.set(v.uci, e);
        }
        return [...counts.values()].sort((a, b) => b.n - a.n);
    }
    function chatVote(ctx, resolve) {
        const c = current();
        if (!c || c.ended || reviewT.game || !stateT.chess) return;
        if (chat.key !== c.key || boardOf(chat.fen) !== boardOf(c.fen)) chatReset(c);
        const m = resolve(stateT.chess);
        if (!m) return;
        chat.votes.set(String(ctx.username || '').toLowerCase(), { uci: m.uci, san: m.san, name: ctx.displayName || ctx.username });
        scheduleChat();
    }
    // Coup joué entre deux positions (un seul coup ; sinon pas de résultat)
    function playedBetween(prevFen, newFen) {
        try {
            const ch = new Chess(prevFen);
            for (const m of ch.moves({ verbose: true })) {
                ch.move(m);
                if (boardOf(ch.fen()) === boardOf(newFen)) return { san: m.san, uci: m.from + m.to + (m.promotion || '') };
                ch.undo();
            }
        } catch { /* position illisible */ }
        return null;
    }
    function chatResolve(key, prevFen, newFen) {
        const voters = chat.key === key && boardOf(chat.fen) === boardOf(prevFen) ? [...chat.votes.values()] : [];
        if (voters.length) {
            const played = playedBetween(prevFen, newFen);
            if (played) {
                const hits = voters.filter(v => v.uci === played.uci);
                chat.last = { key, at: Date.now(), played, total: voters.length, hits: hits.length,
                    names: hits.slice(0, 6).map(v => v.name), top: chatTally().slice(0, 3) };
                window.AppToast?.show(esc(T('predict.chatToast', { hits: hits.length, total: voters.length, san: played.san },
                    `Chat : ${hits.length}/${voters.length}`)), hits.length ? 'success' : 'info', 4000);
            }
        }
        chatReset(current());
    }
    let chatQueued = false;
    function scheduleChat() {
        if (chatQueued) return;
        chatQueued = true;
        requestAnimationFrame(() => { chatQueued = false; renderChat(); });
    }
    const pct = (n, t) => t ? Math.round(n * 100 / t) : 0;
    function renderChat() {
        const el = document.querySelector('#tPredict .tp-chat');
        if (!el) return;
        const c = current();
        const last = c && chat.last?.key === c.key && Date.now() - chat.last.at < 120000 ? chat.last : null;
        const live = !!c && !c.ended && chatOn();
        el.hidden = !(live || last);
        if (el.hidden) return;
        const tally = chat.key === c.key && boardOf(chat.fen) === boardOf(c.fen) ? chatTally() : [];
        const total = tally.reduce((s, e) => s + e.n, 0);
        const bars = (rows, tot, hit) => rows.map(e => `<div class="tp-crow${hit && e.uci === hit ? ' is-hit' : ''}">
                <span class="tp-csan">${esc(e.san)}</span><span class="tp-cbar"><i style="width:${pct(e.n, tot)}%"></i></span><span class="tp-cn">${e.n}</span></div>`).join('');
        el.innerHTML = `
            <div class="tp-label"><i class="fab fa-twitch"></i> ${esc(T('predict.chatTitle', null, 'Vote du chat'))}
                ${live ? `<small>${esc(T('predict.chatVotes', { n: total }, `${total}`))}</small>` : ''}</div>
            ${live ? (tally.length ? `<div class="tp-cbars">${bars(tally.slice(0, 5), total)}</div>`
                : `<p class="tp-hint">${esc(T('predict.chatNone', null, 'Pas encore de vote du chat pour ce coup.'))}</p>`) : ''}
            ${live ? `<p class="tp-hint">${esc(T('predict.chatHint', null, ''))}</p>` : ''}
            ${last ? `<div class="tp-clast">
                <p><strong>${esc(T('predict.chatPlayed', { san: last.played.san }, last.played.san))}</strong> ·
                    ${esc(T('predict.chatScore', { hits: last.hits, total: last.total, pct: pct(last.hits, last.total) }))}</p>
                <div class="tp-cbars">${bars(last.top, last.total, last.played.uci)}</div>
                ${last.names.length ? `<p class="tp-hint">${esc(T('predict.chatWinners', { names: last.names.join(', ') }))}</p>` : ''}
            </div>` : ''}`;
    }
    window.tournamentPredict = { chatVote };

    // ───────────── Journal réservé à la régie ─────────────
    let regie = false;
    async function checkRegie() {
        regie = false;
        if (logged()) {
            try {
                const r = await fetch('/api/regie', { headers: authHeaders() });
                if (r.ok) regie = !!(await r.json()).regie;
            } catch { /* journal masqué */ }
        }
        const card = document.getElementById('tLogCard');
        if (card) card.hidden = !regie;
    }

    // ───────────── Branchements ─────────────
    document.addEventListener('DOMContentLoaded', () => {
        const page = document.getElementById('page-tournament');
        if (!page) return;

        page.addEventListener('click', e => {
            const follow = e.target.closest('[data-tl-follow]');
            if (follow) { const g = liveGames[+follow.dataset.tlFollow]; if (g) openLiveGame(g); return; }
            const vote = e.target.closest('[data-tl-vote]');
            if (vote) {
                const g = liveGames[+vote.dataset.tlVote];
                if (g) voteWinner(g.room.slug, g.id, vote.dataset.pick, `${g.room.slug}:${g.id}`);
                return;
            }
            const pick = e.target.closest('[data-tp-pick]');
            if (pick) { const c = current(); if (c) voteWinner(c.room, c.g.id, pick.dataset.tpPick, c.key); return; }
            if (e.target.closest('[data-tp-login]')) window.twitchAuth?.login();
        });
        document.getElementById('liveBoardT')?.addEventListener('click', onBoardClick);
        document.getElementById('btnRefreshLive')?.addEventListener('click', () => loadLive(true));
        document.getElementById('eventSearchInput')?.addEventListener('input', () => { loadLive(); renderPlayerHits(); });

        // Une seule boucle : visibilité de la carte, marques sur l'échiquier, rafraîchissements
        let lastFen = null, lastKey = null, tick = 0;
        setInterval(() => {
            const c = current();
            document.body.classList.toggle('t-following', !!c);
            if ((c?.key || null) !== lastKey || (stateT.lastFEN !== lastFen)) {
                if (stateT.lastFEN !== lastFen && c?.key === lastKey && lastFen && stateT.lastFEN) chatResolve(lastKey, lastFen, stateT.lastFEN);
                else if ((c?.key || null) !== lastKey) chatReset(c);
                if (stateT.lastFEN !== lastFen && pred.move && boardOf(pred.move.fen) !== boardOf(stateT.lastFEN)) pred.move = null;
                pred.sel = null;
                lastFen = stateT.lastFEN;
                const keyChanged = (c?.key || null) !== lastKey;
                lastKey = c?.key || null;
                renderPredict();
                if (keyChanged) { renderLive(); pollState(); }
                renderChat();
            } else if (c) paintMarks();
            if (tick % 3 === 0) renderChat();
            if (++tick % 5 === 0) pollState();
            if (tick % 30 === 0 && pageVisible()) loadLive();
        }, 1000);
        window.addEventListener('cg:page', e => { if (e.detail?.page === 'tournament') { loadLive(); renderPredict(); checkRegie(); } });
        window.addEventListener('twitchAuthChange', () => { renderPredict(); pollState(); checkRegie(); });
        checkRegie();
        window.addEventListener('languageChanged', () => { renderLive(); renderPredict(); renderPlayerHits(); renderChat(); });
        window.addEventListener('pieceSetChanged', renderLive);
        if (pageVisible()) loadLive();
    });
})();

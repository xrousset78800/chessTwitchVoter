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
    const boardOf = fen => String(fen || '').split(' ').slice(0, 2).join(' ');
    const logged = () => !!window.twitchAuth?.isLoggedIn;
    const authHeaders = () => ({ 'Content-Type': 'application/json', ...(window.twitchAuth?.authHeaders?.() || {}) });
    const pageVisible = () => document.visibilityState === 'visible'
        && (document.getElementById('page-tournament')?.getClientRects().length ?? 0) > 0;
    let rules = { move: { xp: 8, coins: 2 }, streak: { every: 5, xp: 25, coins: 10 }, winner: { xp: 25, coins: 10 }, winnerDraw: { xp: 40, coins: 20 }, oddsMin: 0.2, oddsMax: 2 };
    /** Cote du vote vainqueur (×1,4) : fixée par le serveur d'après l'évaluation Stockfish */
    const fmtOdds = f => '×' + Number(f).toLocaleString(document.documentElement.lang || 'fr', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const PIECE_ICONS = { w: { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' }, b: { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' } };
    const sanLocal = san => (window.Notation?.local ? window.Notation.local(san) : san);
    const NL2 = String.fromCharCode(10, 10);

    // ───────────── Matchs en direct ─────────────
    const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const COMPACT_KEY = 'cgLiveCompact';
    let compact = false;
    try { compact = localStorage.getItem(COMPACT_KEY) === '1'; } catch { /* navigation privée */ }
    function setCompact(on) {
        compact = !!on;
        try { localStorage.setItem(COMPACT_KEY, compact ? '1' : '0'); } catch { /* navigation privée */ }
        const btn = document.getElementById('btnLiveCompact');
        if (btn) {
            btn.setAttribute('aria-pressed', String(compact));
            btn.innerHTML = `<i class="fas ${compact ? 'fa-th-large' : 'fa-list'}"></i>`;
            btn.title = T(compact ? 'tlive.cards' : 'tlive.compact', null, compact ? 'Vue avec échiquiers' : 'Vue compacte');
        }
        renderLive();
    }
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

    // Photos des joueurs (id FIDE → photo Lichess) : déclarées ici, la liste des matchs s'en sert aussi
    const photos = new Map();   // fideId -> { src, credit } | null | 'wait'
    const photoOf = id => { const p = id ? photos.get(String(id)) : null; return p && p !== 'wait' ? p : null; };
    const picHTML = id => {
        if (!id) return '';
        const p = photoOf(id);
        return `<img class="tl-player__pic" data-fide="${esc(id)}" alt=""${p ? ` src="${esc(p.src)}" title="${esc('Photo : ' + p.credit)}"` : ' hidden'}>`;
    };
    const playerHTML = (p, side) => `<div class="tl-player tl-player--${side}"><span class="tl-player__dot"></span>${picHTML(p.fide)}`
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
        const q = norm(document.getElementById('liveSearchInput')?.value.trim());
        const shown = liveGames.map((g, i) => ({ g, i }))
            .filter(({ g }) => !q || [g.white.name, g.black.name, g.event.name, g.room.name].some(x => norm(x).includes(q)));
        grid.classList.toggle('is-compact', compact);
        if (!shown.length) {
            grid.innerHTML = `<p class="tl-empty">${esc(T('tlive.noMatch', null, 'Aucun match ne correspond.'))}</p>`;
            return;
        }
        // Plus de vote à la volée depuis la liste : on vote sur la partie suivie
        grid.innerHTML = shown.map(({ g, i }) => {
            const isFollowed = followed === `${g.room.slug}:${g.id}`;
            const where = g.event.name + (g.room.name && g.room.name !== g.event.name ? ' · ' + g.room.name : '');
            if (compact) {
                return `<article class="tl-card tl-row${isFollowed ? ' is-followed' : ''}" data-tl="${i}" title="${esc(where)}">
                <button type="button" class="tl-row__main" data-tl-follow="${i}">${playerHTML(g.white, 'w')}${playerHTML(g.black, 'b')}</button>
            </article>`;
            }
            return `<article class="tl-card${isFollowed ? ' is-followed' : ''}" data-tl="${i}">
                <button type="button" class="tl-card__board" data-tl-follow="${i}" aria-label="${esc(T('tlive.follow', null, 'Suivre'))}">${miniBoardHTML(g.fen)}</button>
                <div class="tl-card__body">
                    <div class="tl-card__event" title="${esc(where)}">${esc(g.event.name)}</div>
                    ${playerHTML(g.white, 'w')}${playerHTML(g.black, 'b')}
                    <div class="tl-card__actions">
                        <button type="button" class="tl-follow" data-tl-follow="${i}"><i class="fas fa-eye"></i> ${esc(isFollowed ? T('tlive.following', null, 'Suivie') : T('tlive.follow', null, 'Suivre'))}</button>
                    </div>
                </div>
            </article>`;
        }).join('');
        paintPhotos();
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
    const pred = { key: null, move: null, winner: null, f: null, odds: null, votes: null, stats: null, busy: false, confirm: null };
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
            // Coup : pas de message, la liste des votants l'anime déjà (✓ +XP / ✗)
            if (r.kind === 'move') { if (r.hit) window.economy?.noteGain(r.gain); continue; }
            const html = r.hit
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
                    pred.f = d.winner?.f ?? null;
                    pred.odds = d.odds || null;
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
        : err.code === 'locked' ? T('predict.winnerLocked', null, 'Ton pronostic de vainqueur est définitif.')
        : err.code === 'ended' ? T('predict.ended', null, 'Partie terminée')
        : err.message;

    async function voteWinner(room, gameId, pick, key) {
        if (!logged()) { askLogin(); return; }
        try {
            const d = await postJSON('/api/predict/winner', { room, game: gameId, pick });
            myWinnerPicks[key] = pick;
            const f = d.winner?.f;
            if (pred.key === key) { pred.winner = pick; pred.f = f ?? null; if (d.odds) pred.odds = d.odds; pred.votes = d.votes; renderPredict(); }
            const lg = liveGames.find(g => `${g.room.slug}:${g.id}` === key);
            if (lg) { lg.votes = d.votes; if (d.odds) lg.odds = d.odds; }
            renderLive();
            window.AppToast?.show(esc(T('predict.voted', { pick: T('predict.' + PICK_KEY[pick]) }, 'Vote enregistré') + (f ? ` (${fmtOdds(f)})` : '')), 'success', 2500);
        } catch (err) {
            window.AppToast?.show(esc(errText(err)), 'error', 3000);
        }
    }

    function askLogin() {
        window.AppToast?.show(esc(T('predict.login', null, 'Connecte-toi avec Twitch pour pronostiquer')), 'info', 3500);
    }

    // ───────────── Prono de coup : glisser la pièce sur l'échiquier, ou cliquer un coup de la liste ─────────────
    const canGuess = () => { const c = current(); return !!c && !c.ended && !reviewT.game && !window.simT?.active; };
    /** Échiquier (liveTournament.js, onDragStart) : seules les pièces du camp au trait se déplacent */
    function canDrag(piece) {
        if (!canGuess() || pred.busy) return false;
        if (!logged()) { askLogin(); return false; }
        return piece?.[0] === (String(current().fen).split(' ')[1] === 'b' ? 'b' : 'w');
    }
    /** Survol : main ouverte sur les pièces qu'on peut faire glisser (camp au trait, sans ouvrir la connexion) */
    const canGrab = piece => window.simT?.active ? !!window.simCanDragT?.(piece)
        : canGuess() && !pred.busy && piece?.[0] === (String(current().fen).split(' ')[1] === 'b' ? 'b' : 'w');
    document.addEventListener('mouseover', e => {
        const sq = e.target.closest?.('#liveBoardT [data-square]');
        if (!sq) return;
        const piece = sq.querySelector('img[data-piece]')?.dataset.piece;
        sq.classList.toggle('can-grab', !!piece && canGrab(piece));
    });
    // Main fermée pendant qu'on fait glisser la pièce (elle suit la souris hors de l'échiquier)
    document.addEventListener('mousedown', e => {
        if (e.button === 0 && e.target.closest?.('#liveBoardT .can-grab')) document.body.classList.add('is-dragging-piece');
    });
    document.addEventListener('mouseup', () => document.body.classList.remove('is-dragging-piece'));
    /** Échiquier (onDrop) : le coup part comme prono, la pièce revient à sa place */
    function dropMove(from, to) {
        const c = current();
        if (!canGuess() || from === to) return;
        let m = null;
        try { m = new Chess(c.fen).move({ from, to, promotion: 'q' }); } catch { /* coup illégal */ }
        if (m) sendGuess(m.from + m.to + (m.promotion || ''));
    }
    async function sendGuess(uci) {
        const c = current();
        if (!c || c.ended || pred.busy) return;
        if (!logged()) { askLogin(); return; }
        pred.busy = true;
        renderMoves();
        try {
            const me = window.twitchAuth?.user;
            const d = await postJSON('/api/predict/move', { room: c.room, game: c.g.id, round: c.round, slug: c.g.slug, fen: c.fen, uci, name: me?.displayName });
            pred.key = c.key;
            pred.move = d.move;
            if (me?.login) {
                if (voters.key !== c.key || boardOf(voters.fen) !== boardOf(c.fen)) { voters.key = c.key; voters.fen = c.fen; voters.site = []; }
                voters.site = voters.site.filter(v => v.login !== me.login.toLowerCase())
                    .concat({ login: me.login.toLowerCase(), name: me.displayName || me.login, uci: d.move.uci, san: d.move.san, pic: me.avatar });
                renderVoters();
            }
        } catch (err) {
            window.AppToast?.show(esc(errText(err)), 'error', 3000);
        }
        pred.busy = false;
        renderPredict();
    }

    /** Coups disponibles, groupés par pièce comme sur les autres échiquiers ; votes du chat en pastille */
    function renderMoves() {
        const box = document.querySelector('#tPredict .tp-moves');
        if (!box) return;
        const c = current();
        let moves = [];
        if (c && !c.ended && logged()) { try { moves = new Chess(c.fen).moves({ verbose: true }); } catch { moves = []; } }
        const turn = String(c?.fen).split(' ')[1] === 'b' ? 'b' : 'w';
        const counts = {};
        if (c && chat.key === c.key && boardOf(chat.fen) === boardOf(c.fen)) for (const e of chatTally()) counts[e.uci] = e.n;
        const mine = pred.move && boardOf(pred.move.fen) === boardOf(c?.fen) ? pred.move.uci : null;
        const locked = pred.busy || !!reviewT.game;
        const sig = JSON.stringify([c?.fen, mine, locked, counts, document.documentElement.lang]);
        if (box.dataset.sig === sig) return;
        box.dataset.sig = sig;
        const groups = { P: [], N: [], B: [], R: [], Q: [], K: [], O: [] };
        for (const m of moves) {
            const castle = m.flags.includes('k') || m.flags.includes('q');
            groups[castle ? 'O' : m.piece.toUpperCase()].push({ uci: m.from + m.to + (m.promotion || ''), san: m.san.replace(/[+#]/g, '') });
        }
        box.innerHTML = Object.entries(groups).filter(([, l]) => l.length).map(([piece, l]) => `
            <ul class="moves-group"><span class="piece-icon">${piece === 'O' ? '⬚' : PIECE_ICONS[turn][piece]}</span>${
                l.map(m => `<li><button type="button" data-tp-move="${esc(m.uci)}" class="${mine === m.uci ? 'is-mine' : ''}" ${locked ? 'disabled' : ''}>${esc(sanLocal(m.san))}${counts[m.uci] ? `<b>${counts[m.uci]}</b>` : ''}</button></li>`).join('')
            }</ul>`).join('');
    }
    /** Survol d'un coup de la liste : flèche d'aperçu sur l'échiquier */
    function hoverMove(uci) {
        const c = current();
        let m = null;
        if (uci && c) { try { m = new Chess(c.fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' }); } catch { m = null; } }
        if (window.simT?.active) m = null;
        stateT.annotations?.setHover?.(m);
    }

    function renderPredict() {
        const card = document.getElementById('tPredict');
        if (!card) return;
        const c = current();
        card.hidden = !c;
        if (!c) return;
        if (pred.key !== c.key) { pred.key = c.key; pred.move = null; pred.winner = myWinnerPicks[c.key] || null; pred.f = null; pred.odds = null; pred.votes = null; pred.confirm = null; }
        if (pred.winner || c.ended) pred.confirm = null;
        const body = card.querySelector('.tp-body');
        if (!logged()) {
            body.innerHTML = `<p class="tp-hint">${esc(T('predict.loginText', null, 'Devine le prochain coup et le vainqueur pour gagner de l\'XP et des pions.'))}</p>
                <button type="button" class="btn-primary btn-connect tp-login" data-tp-login><i class="fab fa-twitch"></i> ${esc(T('predict.loginBtn', null, 'Se connecter avec Twitch'))}</button>`;
            return;
        }
        // Compact : le vainqueur sur une ligne, les explications en infobulle, la liste des coups prend le reste
        const st = pred.stats;
        const stat = card.querySelector('.tp-stat');
        if (stat) {
            stat.innerHTML = st ? `${st.moveHits}/${st.moveTotal}${st.streak ? ` · <i class="fas fa-fire"></i> ${st.streak}` : ''}` : '';
            stat.title = st ? T('predict.stats', { hits: st.moveHits, total: st.moveTotal, streak: st.streak, whits: st.winnerHits, wtotal: st.winnerTotal }) : '';
        }
        const rulesText = T('predict.rules', { xp: rules.move.xp, coins: rules.move.coins, every: rules.streak.every, sxp: rules.streak.xp, scoins: rules.streak.coins, wxp: rules.winner.xp, wcoins: rules.winner.coins, dxp: rules.winnerDraw.xp, dcoins: rules.winnerDraw.coins, omin: fmtOdds(rules.oddsMin ?? 0.2), omax: fmtOdds(rules.oddsMax ?? 2) });
        const winTip = T('predict.winnerTitle', null, 'Vainqueur') + ' — ' + T('predict.oddsHint') + (pred.winner && pred.f ? ' ' + T('predict.yourOdds', { odds: fmtOdds(pred.f) }) : '')
            + ' ' + T(pred.winner ? 'predict.winnerLocked' : 'predict.winnerFinal', null, '');
        const cp = pred.confirm;
        const confirmHTML = !cp ? '' : `<div class="tp-confirm" role="dialog">
                <p><strong>${esc(T('predict.confirmTitle', { pick: T('predict.' + PICK_KEY[cp]) }, 'Confirmer : ' + cp))}${pred.odds ? ` (${fmtOdds(pred.odds[cp])})` : ''}</strong><br>${esc(T('predict.confirmText', null, 'Un vote pour le vainqueur est définitif : tu ne pourras plus le changer pour ce match.'))}</p>
                <div class="tp-confirm__btns"><button type="button" class="btn btn--sm" data-tp-cancel>${esc(T('predict.cancel', null, 'Annuler'))}</button>
                <button type="button" class="btn btn--sm btn--primary" data-tp-confirm>${esc(T('predict.confirmBtn', null, 'Valider'))}</button></div></div>`;
        body.innerHTML = `
            <div class="tp-picks tp-win" role="group" title="${esc(winTip)}">
                <i class="fas fa-trophy"></i>
                ${PICKS.map(p => `<button type="button" data-tp-pick="${p}" class="${pred.winner === p ? 'is-on' : ''}${cp === p ? ' is-pending' : ''}" title="${esc(T('predict.' + PICK_KEY[p]))}" ${c.ended || pred.winner ? 'disabled' : ''}>${pred.winner === p ? '<i class="fas fa-lock"></i> ' : ''}${p === '1/2-1/2' ? '½' : p}${pred.odds ? `<small>${fmtOdds(pred.odds[p])}</small>` : ''}</button>`).join('')}
            </div>
            ${confirmHTML}
            <div class="tp-winbars"></div>
            <div class="tp-guessrow">
                <i class="fas fa-crosshairs"></i>
                <span>${esc(c.ended ? T('predict.ended', null, 'Partie terminée') : T('predict.moveTitle', null, 'Prochain coup'))}</span>
                ${pred.move && !c.ended ? `<b class="tp-mine" title="${esc(T('predict.yourGuess', { san: pred.move.san }))}">${esc(sanLocal(pred.move.san))}</b>` : ''}
                <i class="fas fa-circle-info tp-info" tabindex="0" title="${esc(T('predict.moveHint', null, '') + NL2 + rulesText)}"></i>
            </div>
            ${c.ended ? '' : '<div class="tp-moves"></div>'}`;
        renderMoves();
        renderWinBars();
    }

    // ───────────── Vote du chat sur le vainqueur : !1-0, !1/2, !0-1 (ou blancs / nulle / noirs) ─────────────
    // Un vote par spectateur et par partie, modifiable jusqu'à la fin ; décompte gardé sur cet écran.
    const CW_KEY = 'cgChatWinner';
    const chatWin = new Map();              // clé salle:partie -> Map(login -> { pick, name, bot })
    try {
        for (const [k, list] of Object.entries(JSON.parse(localStorage.getItem(CW_KEY)) || {})) chatWin.set(k, new Map(list));
    } catch { /* navigation privée */ }
    function saveChatWin() {
        try {
            const o = {};
            for (const [k, m] of [...chatWin.entries()].slice(-20)) {
                const l = [...m].filter(([, v]) => !v.bot);
                if (l.length) o[k] = l;
            }
            localStorage.setItem(CW_KEY, JSON.stringify(o));
        } catch { /* navigation privée */ }
    }
    const WIN_WORDS = {
        '1-0': ['1-0', 'blancs', 'blanc', 'white', 'weiss', 'weiß', 'blancas', 'bianco', 'bianchi', 'wit', 'biale', 'białe', 'brancas', 'белые', 'beyaz'],
        '1/2-1/2': ['1/2', '1/2-1/2', '½', '½-½', 'nulle', 'nul', 'draw', 'remis', 'remise', 'tablas', 'empate', 'patta', 'ничья', 'berabere'],
        '0-1': ['0-1', 'noirs', 'noir', 'black', 'schwarz', 'negras', 'nero', 'neri', 'zwart', 'czarne', 'pretas', 'черные', 'чёрные', 'siyah'],
    };
    const WIN_OF = new Map(Object.entries(WIN_WORDS).flatMap(([p, l]) => l.map(w => [w, p])));
    /** « !blancs », « !1-0 », « 1-0 » seul… -> résultat, sinon null */
    function parseWinner(text) {
        const t = String(text || '').trim().toLowerCase();
        const m = t.match(/^!\s*(\S+)$/);
        if (m) return WIN_OF.get(m[1]) || null;
        return ['1-0', '0-1', '1/2', '½', '1/2-1/2'].includes(t) ? WIN_OF.get(t) : null;
    }
    /** app.js (twitch.onMessage, page Tournoi) : true si le message était un vote vainqueur */
    function chatWinner(msg) {
        const pick = parseWinner(msg?.message);
        if (!pick) return false;
        const c = current();
        if (!c || c.ended || reviewT.game) return true;
        const login = String(msg.username || '').toLowerCase();
        if (!login) return true;
        if (!chatWin.has(c.key)) chatWin.set(c.key, new Map());
        if (chatWin.get(c.key).has(login)) return true;     // vote définitif : le premier compte
        chatWin.get(c.key).set(login, { pick, name: msg.displayName || login });
        saveChatWin();
        renderWinBars();
        return true;
    }
    function chatWinTally(key) {
        const t = { '1-0': 0, '1/2-1/2': 0, '0-1': 0 };
        for (const v of chatWin.get(key)?.values() || []) t[v.pick]++;
        return t;
    }
    /** Barre horizontale : part de chaque résultat, pourcentage dans le segment quand il y a la place */
    function winBarHTML(v, tipN) {
        const n = PICKS.reduce((s, p) => s + (v?.[p] || 0), 0);
        const pct = p => Math.round(100 * (v[p] || 0) / n);
        const segs = n ? PICKS.filter(p => v[p]).map(p => {
            const tip = `${T('predict.' + PICK_KEY[p])} : ${pct(p)} % (${v[p]})`;
            return `<span class="tp-wbar__seg tp-wbar__seg--${PICK_KEY[p]}" style="flex:${v[p]}" title="${esc(tip)}">${pct(p) >= 14 ? pct(p) + ' %' : ''}</span>`;
        }).join('') : `<span class="tp-wbar__empty">${esc(T('tlive.noVotes', null, 'Aucun vote'))}</span>`;
        return `<div class="tp-wbar"><div class="tp-wbar__bar">${segs}</div><span class="tp-wbar__n" title="${esc(tipN)}">${esc(T('predict.votes', { n }, n + ' vote(s)'))}</span></div>`;
    }
    function renderWinBars() {
        const box = document.querySelector('#tPredict .tp-winbars');
        if (!box) return;
        const c = current();
        if (!c) { box.innerHTML = ''; return; }
        const cv = chatWinTally(c.key);
        const showChat = chatOn() || PICKS.some(p => cv[p]);
        const hint = showChat && !c.ended
            ? `<div class="tp-wbar__hint">${esc(T('predict.chatWinHint', { cmds: '!1-0 · !1/2 · !0-1' }, 'Le chat pronostique avec !1-0 · !1/2 · !0-1'))}</div>` : '';
        const html = `<div class="tp-wbars__title"><span>${esc(T('predict.winBars', null, 'Pronostics en cours'))}</span>
                <span class="tp-wbars__legend">${PICKS.map(p => `<i class="tp-wbar__dot tp-wbar__seg--${PICK_KEY[p]}"></i>${esc(T('predict.' + PICK_KEY[p]))}`).join(' ')}</span></div>`
            + winBarHTML(Object.fromEntries(PICKS.map(p => [p, (pred.votes?.[p] || 0) + (cv[p] || 0)])),
                `${T('predict.siteVotes', null, 'Site')} : ${PICKS.reduce((s, p) => s + (pred.votes?.[p] || 0), 0)} · ${T('predict.chatVotes', null, 'Chat')} : ${PICKS.reduce((s, p) => s + cv[p], 0)}`)
            + hint;
        if (box._html !== html) { box.innerHTML = html; box._html = html; }
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
    /** Coup joué : le résultat du chat s'affiche dans la liste des votants (votersResolve), on repart à zéro */
    function chatResolve() {
        chatReset(current());
    }
    let chatQueued = false;
    function scheduleChat() {
        if (chatQueued) return;
        chatQueued = true;
        requestAnimationFrame(() => { chatQueued = false; renderChat(); });
    }
    function renderChat() {
        renderMoves();
        renderVoters();
    }

    // ───────────── Votants du prochain coup (site + chat) : photo, pseudo, coup ─────────────
    const voters = { key: null, fen: null, site: [], flash: null, timer: null, busy: false };
    const pics = new Map();                     // login -> URL de la photo
    const picTries = new Map();
    const picQueue = new Set();
    let picTimer = null;
    function picOf(v) {
        if (v.src === 'bot') return null;
        if (v.pic && /^https:\/\//.test(v.pic)) { pics.set(v.login, v.pic); return v.pic; }
        if (pics.has(v.login)) return pics.get(v.login);
        if ((picTries.get(v.login) || 0) < 3 && !picQueue.has(v.login)) {
            picQueue.add(v.login);
            picTimer ||= setTimeout(fetchPics, 800);
        }
        return null;
    }
    async function fetchPics() {
        picTimer = null;
        const list = [...picQueue].slice(0, 50);
        list.forEach(l => { picQueue.delete(l); picTries.set(l, (picTries.get(l) || 0) + 1); });
        if (!list.length) return;
        try {
            const r = await fetch('/api/twitch/avatars?l=' + encodeURIComponent(list.join(',')));
            if (!r.ok) return;
            let any = false;
            for (const [l, u] of Object.entries((await r.json()).pics || {})) if (u && /^https:\/\//.test(u)) { pics.set(l, u); any = true; }
            if (any) renderVoters();
        } catch { /* initiales à la place */ }
    }
    async function loadGuesses() {
        const c = current();
        if (!c || c.ended || voters.busy || !pageVisible()) return;
        voters.busy = true;
        try {
            const q = new URLSearchParams({ room: c.room, game: c.g.id, fen: c.fen });
            const r = await fetch(`/api/predict/guesses?${q}`);
            const now = current();
            if (r.ok && now?.key === c.key && boardOf(now.fen) === boardOf(c.fen)) {
                voters.key = c.key; voters.fen = c.fen;
                voters.site = (await r.json()).guesses || [];
                renderVoters();
            }
        } catch { /* nouvel essai au prochain tour */ }
        voters.busy = false;
    }
    /** Votants d'une position : comptes du site, puis spectateurs du chat (un compte du site l'emporte) */
    function votersOf(key, fen) {
        const out = new Map();
        if (chat.key === key && boardOf(chat.fen) === boardOf(fen)) {
            for (const [login, v] of chat.votes) out.set(login, { login, name: v.name, uci: v.uci, san: v.san, src: v.bot ? 'bot' : 'chat' });
        }
        if (voters.key === key && boardOf(voters.fen) === boardOf(fen)) {
            for (const v of voters.site) out.set(v.login, { ...v, src: 'site' });
        }
        return [...out.values()];
    }
    /** Coup joué : qui a vu juste (animation), puis la liste repart à zéro pour la nouvelle position */
    function votersResolve(key, prevFen, newFen) {
        const list = votersOf(key, prevFen);
        voters.site = []; voters.fen = newFen;
        if (!list.length) return;
        const played = playedBetween(prevFen, newFen);
        if (!played) return;
        list.forEach(v => { v.hit = v.uci === played.uci; v.gain = v.hit && v.src === 'site' ? rules.move.xp : 0; });
        list.sort((a, b) => b.hit - a.hit);
        voters.flash = { key, at: Date.now(), played, list, hits: list.filter(v => v.hit).length };
        clearTimeout(voters.timer);
        voters.timer = setTimeout(() => { voters.flash = null; renderVoters(); }, 5000);
        renderVoters();
    }
    function renderVoters() {
        const el = document.getElementById('tVoters');
        if (!el) return;
        const c = current();
        el.hidden = !c;
        if (!c) return;
        const flash = voters.flash?.key === c.key ? voters.flash : null;
        const list = flash ? flash.list : votersOf(c.key, c.fen);
        const me = window.twitchAuth?.user?.login?.toLowerCase();
        const sig = JSON.stringify([flash?.at, c.ended, chatOn(), list.map(v => [v.login, v.uci, picOf(v)]), document.documentElement.lang]);
        if (el.dataset.sig === sig) return;
        el.dataset.sig = sig;
        el.querySelector('.tv-count').textContent = list.length ? String(list.length) : '';
        const face = v => {
            if (v.src === 'bot') return '<span class="tv-pic is-bot"><i class="fas fa-robot"></i></span>';
            const url = picOf(v);
            return url ? `<img class="tv-pic" src="${esc(url)}" alt="" loading="lazy">`
                : `<span class="tv-pic">${esc(String(v.name || v.login || '?')[0].toUpperCase())}</span>`;
        };
        const src = v => v.src === 'chat' ? `<i class="fab fa-twitch tv-src" title="${esc(T('voters.chat', null, 'Chat Twitch'))}"></i>`
            : v.src === 'bot' ? `<i class="fas fa-robot tv-src is-bot" title="${esc(T('voters.bot', null, 'Bot de test'))}"></i>` : '';
        // Coup joué : chaque ligne reçoit sa marque animée (✓ et gain pour les gagnants, mis en avant ; ✗ pour les autres)
        const mark = v => !flash ? '' : v.hit
            ? `<span class="tv-mark is-hit"><i class="fas fa-check"></i>${v.gain ? `<b class="tv-gain">+${v.gain} XP</b>` : ''}</span>`
            : '<span class="tv-mark is-miss"><i class="fas fa-xmark"></i></span>';
        const row = (v, i) => `<li class="tv-item${v.login === me ? ' is-me' : ''}${flash ? (v.hit ? ' is-hit' : ' is-miss') : ''}" style="--i:${i}">
                ${face(v)}<span class="tv-name">${esc(v.name || v.login)}</span>${src(v)}
                <span class="tv-move">${esc(sanLocal(v.san))}</span>${mark(v)}</li>`;
        el.querySelector('.tv-body').innerHTML = `
            ${list.length ? `<ul class="tv-list${flash ? ' is-flash' : ''}">${list.map(row).join('')}</ul>`
                : `<p class="tp-hint">${esc(c.ended ? T('predict.ended', null, 'Partie terminée') : T('voters.none', null, 'Pas encore de prono pour ce coup.'))}</p>`}
            ${!list.length && !flash && !c.ended && chatOn() ? `<p class="tp-hint">${esc(T('predict.chatHint', null, ''))}</p>` : ''}`;
    }

    // ───────────── Bots de test (régie) : votes simulés, sur cet écran seulement ─────────────
    // Panneau « Régie · bots » en bas à gauche de la page Tournoi : nombre, rythme, suivisme,
    // une vague tout de suite ou on vide. Rien n'est envoyé au serveur ni au chat.
    const BOT_KEY = 'cgTourBots';
    const BOT_A = ['Pion', 'Tour', 'Cavalier', 'Fou', 'Dame', 'Roque', 'Gambit', 'Zugzwang', 'Fianchetto', 'Mat', 'Echec', 'Sicilienne'];
    const BOT_B = ['Fou', 'Rapide', 'Noir', 'Blanc', 'Malin', 'Perdu', 'Royal', 'Volant', 'Zen', 'Furieux'];
    const BOT_NAMES = BOT_A.flatMap(x => BOT_B.map(y => x + y)).sort(() => Math.random() - 0.5);
    const BOT_COUNTS = [3, 8, 15, 30, 60];
    const BOT_PACE = { fast: 2500, normal: 7000, slow: 15000 };
    const BOT_FOLLOW = [0, 0.35, 0.7];
    const bots = { on: false, n: 8, pace: 'normal', follow: 0.35, open: true, key: null, fen: null, timers: [] };
    try { Object.assign(bots, JSON.parse(localStorage.getItem(BOT_KEY + '2')) || {}, { key: null, fen: null, timers: [] }); } catch { /* navigation privée */ }
    try { if (localStorage.getItem(BOT_KEY) === '1') bots.on = true; } catch { /* navigation privée */ }
    const saveBots = () => { try { localStorage.setItem(BOT_KEY + '2', JSON.stringify({ on: bots.on, n: bots.n, pace: bots.pace, follow: bots.follow, open: bots.open })); localStorage.removeItem(BOT_KEY); } catch { /* navigation privée */ } };
    function botsStop() { bots.timers.forEach(clearTimeout); bots.timers = []; bots.key = bots.fen = null; }
    function botsClear() {
        for (const [login, v] of chat.votes) if (v.bot) chat.votes.delete(login);
        for (const m of chatWin.values()) for (const [login, v] of m) if (v.bot) m.delete(login);
        renderWinBars();
        scheduleChat();
    }
    function setBots(on) {
        bots.on = on;
        saveBots();
        botsStop();
        if (!on) botsClear();
        else botsTick(current());
        paintBotsBtn();
    }
    function paintBotsBtn() {
        const b = document.querySelector('[data-tv-bots]');
        if (b) { b.hidden = !regie; b.setAttribute('aria-pressed', String(bots.on && regie)); }
        paintBotsPanel();
    }
    /** Panneau de la régie (créé à la demande, visible sur la page Tournoi seulement) */
    function paintBotsPanel() {
        let el = document.getElementById('tBotsPanel');
        if (!regie) { if (el) el.hidden = true; return; }
        if (!el) {
            el = document.createElement('div');
            el.id = 'tBotsPanel';
            el.className = 'test-tools t-bots';
            document.body.appendChild(el);
            el.addEventListener('click', e => {
                const act = e.target.closest('[data-tb]')?.dataset.tb;
                if (act === 'toggle') { bots.open = !bots.open; saveBots(); paintBotsPanel(); }
                else if (act === 'on') setBots(!bots.on);
                else if (act === 'wave') botsWave(true);
                else if (act === 'clear') { botsStop(); botsClear(); paintBotsPanel(); }
            });
            el.addEventListener('change', e => {
                const s = e.target.closest('select[data-tb]');
                if (!s) return;
                if (s.dataset.tb === 'n') bots.n = +s.value;
                if (s.dataset.tb === 'pace') bots.pace = s.value;
                if (s.dataset.tb === 'follow') bots.follow = +s.value;
                saveBots();
                if (bots.on) botsWave(true);
            });
        }
        el.hidden = false;
        el.classList.toggle('is-collapsed', !bots.open);
        const c = current();
        const mine = [...chat.votes.values()].filter(v => v.bot).length;
        const opt = (v, l, cur) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`;
        const head = `<button type="button" class="test-tools__title test-tools__toggle" data-tb="toggle"><i class="fas fa-robot"></i> ${esc(T('voters.botsPanel', null, 'Régie · bots'))}${bots.on ? ` (${mine})` : ''} <span>${bots.open ? '▾' : '▸'}</span></button>`;
        if (!bots.open) { if (el._html !== head) { el.innerHTML = head; el._html = head; } return; }
        const html = head + `
            <div class="test-tools__row">
                <button type="button" class="btn btn--sm ${bots.on ? 'btn--primary' : ''}" data-tb="on" aria-pressed="${bots.on}">${esc(bots.on ? T('voters.botsOn', null, 'Bots actifs') : T('voters.botsOff', null, 'Bots arrêtés'))}</button>
                <button type="button" class="btn btn--sm" data-tb="wave" ${!c || c.ended || reviewT.game ? 'disabled' : ''}>${esc(T('voters.botsWave', null, 'Vague maintenant'))}</button>
                <button type="button" class="btn btn--sm" data-tb="clear" ${mine ? '' : 'disabled'}>${esc(T('voters.botsClear', null, 'Vider'))}</button>
            </div>
            <div class="test-tools__row">
                <label>${esc(T('voters.botsCount', null, 'Bots'))} <select data-tb="n">${BOT_COUNTS.map(v => opt(v, v, bots.n)).join('')}</select></label>
                <label>${esc(T('voters.botsPace', null, 'Rythme'))} <select data-tb="pace">${opt('fast', T('voters.paceFast', null, 'rapide'), bots.pace)}${opt('normal', T('voters.paceNormal', null, 'normal'), bots.pace)}${opt('slow', T('voters.paceSlow', null, 'lent'), bots.pace)}</select></label>
                <label>${esc(T('voters.botsFollow', null, 'Suivisme'))} <select data-tb="follow">${BOT_FOLLOW.map(v => opt(v, Math.round(v * 100) + ' %', bots.follow)).join('')}</select></label>
            </div>
            <div class="test-tools__info">${esc(!c || reviewT.game ? T('voters.botsNoGame', null, 'Suis une partie en direct pour faire voter les bots.')
                : T('voters.botsInfo', { n: mine }, '{n} votes de bots sur ce coup · sur ton écran seulement'))}</div>`;
        if (el._html !== html) { el.innerHTML = html; el._html = html; }
    }
    /** Coup d'un bot : souvent une prise ou un échec, parfois le coup déjà choisi par d'autres (suivisme) */
    function botPick(fen) {
        const ch = new Chess(fen);
        const moves = ch.moves({ verbose: true });
        if (!moves.length) return null;
        const voted = [...chat.votes.values()];
        if (voted.length && Math.random() < bots.follow) {
            const v = voted[Math.floor(Math.random() * voted.length)];
            const m = moves.find(x => x.from + x.to + (x.promotion || '') === v.uci);
            if (m) return m;
        }
        const w = moves.map(m => (m.captured ? 4 : 1) * (/[+#]/.test(m.san) ? 3 : 1) * (m.piece === 'k' ? 0.3 : 1));
        let r = Math.random() * w.reduce((a, b) => a + b, 0);
        for (let i = 0; i < moves.length; i++) { r -= w[i]; if (r <= 0) return moves[i]; }
        return moves[moves.length - 1];
    }
    /** Vainqueur d'un bot : plus probable quand la cote est basse */
    function botWinPick() {
        const w = PICKS.map(p => pred.odds?.[p] ? 1 / pred.odds[p] : (p === '1/2-1/2' ? 0.6 : 1));
        let r = Math.random() * w.reduce((a, b) => a + b, 0);
        for (let i = 0; i < PICKS.length; i++) { r -= w[i]; if (r <= 0) return PICKS[i]; }
        return PICKS[0];
    }
    /** Fait voter les bots sur le coup en cours (now : tous dans la seconde, pour voir la liste se remplir) */
    function botsWave(now) {
        const c = current();
        botsStop();
        if (!c || c.ended || reviewT.game || !c.fen) { paintBotsPanel(); return; }
        bots.key = c.key; bots.fen = c.fen;
        const names = BOT_NAMES.slice(0, bots.n);
        const span = now ? 1200 : BOT_PACE[bots.pace] || 7000;
        names.forEach(name => bots.timers.push(setTimeout(() => {
            const cur = current();
            if (cur?.key !== c.key || boardOf(cur.fen) !== boardOf(c.fen)) return;
            if (chat.key !== cur.key || boardOf(chat.fen) !== boardOf(cur.fen)) chatReset(cur);
            const m = botPick(cur.fen);
            if (!m) return;
            chat.votes.set('bot_' + name.toLowerCase(), { uci: m.from + m.to + (m.promotion || ''), san: m.san, name, bot: true });
            const id = 'bot_' + name.toLowerCase();
            if (!chatWin.has(cur.key)) chatWin.set(cur.key, new Map());
            const cw = chatWin.get(cur.key);
            if (!cw.has(id)) cw.set(id, { pick: botWinPick(), name, bot: true });
            renderWinBars();
            scheduleChat();
            paintBotsPanel();
        }, 300 + Math.random() * span)));
        paintBotsPanel();
    }
    function botsTick(c) {
        if (!regie) return;
        if (!bots.on || !c || c.ended || reviewT.game || !c.fen) { if (bots.key) botsStop(); paintBotsPanel(); return; }
        if (bots.key === c.key && boardOf(bots.fen) === boardOf(c.fen)) return;
        botsWave(false);
    }

    // ───────────── Photos des joueurs (id FIDE → photo Lichess), entre la couleur et le nom ─────────────
    let photoQueue = new Set(), photoTimer = null;
    async function fetchPhotos() {
        photoTimer = null;
        const ids = [...photoQueue].slice(0, 20);
        photoQueue = new Set();
        try {
            const r = await fetch('/api/fide/photos?ids=' + ids.join(','));
            const j = r.ok ? await r.json() : { photos: {} };
            ids.forEach(id => photos.set(id, j.photos?.[id] || null));
        } catch { ids.forEach(id => photos.delete(id)); }
        paintPhotos();
        if (photoQueue.size) photoTimer ||= setTimeout(fetchPhotos, 50);
    }
    /** Met une photo (ou rien) sur une image ; demande celles qu'on n'a pas encore */
    function setPhoto(img, id) {
        id = String(id || '');
        if (id && !photos.has(id)) { photos.set(id, 'wait'); photoQueue.add(id); photoTimer ||= setTimeout(fetchPhotos, 100); }
        const p = photoOf(id);
        const src = p ? p.src : '';
        if (img.getAttribute('src') !== src) { if (src) img.src = src; else img.removeAttribute('src'); }
        img.title = p?.credit ? `Photo : ${p.credit}` : '';
        img.hidden = !src;
    }
    function paintPhotos() {
        const live = reviewT.game || (stateT.currentGame && (tournamentData?.games?.find(x => x.id === stateT.currentGame.id) || stateT.currentGame));
        for (const side of ['white', 'black']) {
            const id = live?.[side]?.fideId;
            for (const elId of side === 'white' ? ['photoWhiteT', 'tBarPhotoWhite'] : ['photoBlackT', 'tBarPhotoBlack']) {
                const img = document.getElementById(elId);
                if (img) setPhoto(img, id);
            }
        }
        document.querySelectorAll('#tLiveGrid img[data-fide]').forEach(img => setPhoto(img, img.dataset.fide));
    }

    // ───────────── Dernier coup surligné sur l'échiquier (aussi à l'ouverture d'une partie) ─────────────
    const lastMv = { key: null, fen: null, from: null, to: null, loading: false };
    function setLastMove(key, fen, uci) {
        lastMv.key = key; lastMv.fen = fen;
        lastMv.from = uci ? uci.slice(0, 2) : null; lastMv.to = uci ? uci.slice(2, 4) : null;
        paintLastMove();
    }
    /** Coups de la partie : le dernier, s'il mène bien à la position affichée */
    async function loadLastMove(c) {
        if (lastMv.loading || typeof fetchGameMovesT !== 'function') return;
        lastMv.loading = true;
        try {
            const moves = await fetchGameMovesT(c.g);
            const ch = new Chess();
            let uci = null;
            for (const cbn of moves) {
                const coords = String(cbn).split('_')[0];
                ch.move({ from: coords.slice(0, 2), to: coords.slice(2, 4), promotion: coords[4] || 'q' });
                uci = coords;
            }
            const now = current();
            if (now?.key === c.key && boardOf(ch.fen()) === boardOf(now.fen)) setLastMove(c.key, now.fen, uci);
        } catch { /* pas de surlignage */ }
        lastMv.loading = false;
    }
    function trackLastMove(c, prevFen) {
        if (!c) { setLastMove(null, null, null); return; }
        if (lastMv.key === c.key && boardOf(lastMv.fen) === boardOf(c.fen)) return;
        const played = prevFen && lastMv.key === c.key ? playedBetween(prevFen, c.fen) : null;
        if (played) setLastMove(c.key, c.fen, played.uci);
        else { setLastMove(c.key, c.fen, null); loadLastMove(c); }
    }
    /** Remet les cases en couleur si l'échiquier a été redessiné (hors revue d'une partie terminée) */
    function paintLastMove() {
        if (reviewT.game) return;
        const want = [lastMv.from, lastMv.to].filter(Boolean);
        document.querySelectorAll('#liveBoardT .highlight-last-move-live').forEach(el => {
            if (!want.includes(el.dataset.square)) el.classList.remove('highlight-last-move-live');
        });
        for (const sq of want) document.querySelector(`#liveBoardT [data-square="${sq}"]`)?.classList.add('highlight-last-move-live');
    }

    window.tournamentPredict = { chatVote, chatWinner, canDrag, dropMove };

    // ───────────── Colonne de gauche : tournois en cours / matchs en direct ─────────────
    const SIDE_KEY = 'cgTourSide';
    function setSide(side, save) {
        const col = document.getElementById('tSideCol');
        if (!col) return;
        if (side !== 'events') side = 'live';
        col.querySelectorAll('[data-tside]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tside === side)));
        const ev = document.getElementById('tEventsCard'), lv = document.getElementById('tLiveGames');
        if (ev) ev.hidden = side !== 'events';
        if (lv) lv.hidden = side !== 'live';
        if (save) { try { localStorage.setItem(SIDE_KEY, side); } catch { /* navigation privée */ } }
        if (side === 'live') loadLive();
    }

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
        paintBotsBtn();
    }

    // ───────────── Branchements ─────────────
    document.addEventListener('DOMContentLoaded', () => {
        const page = document.getElementById('page-tournament');
        if (!page) return;

        page.addEventListener('click', e => {
            const follow = e.target.closest('[data-tl-follow]');
            if (follow) { const g = liveGames[+follow.dataset.tlFollow]; if (g) openLiveGame(g); return; }
            const side = e.target.closest('[data-tside]');
            if (side) { setSide(side.dataset.tside, true); return; }
            const mv = e.target.closest('[data-tp-move]');
            if (mv) { if (!mv.disabled) sendGuess(mv.dataset.tpMove); return; }
            const pick = e.target.closest('[data-tp-pick]');
            if (pick) {
                if (!logged()) { askLogin(); return; }
                if (pred.winner) return;
                pred.confirm = pred.confirm === pick.dataset.tpPick ? null : pick.dataset.tpPick;
                renderPredict();
                return;
            }
            if (e.target.closest('[data-tp-cancel]')) { pred.confirm = null; renderPredict(); return; }
            if (e.target.closest('[data-tp-confirm]')) {
                const c = current(), p = pred.confirm;
                pred.confirm = null;
                if (c && p) voteWinner(c.room, c.g.id, p, c.key); else renderPredict();
                return;
            }
            if (e.target.closest('[data-tv-bots]')) { setBots(!bots.on); return; }
            if (e.target.closest('[data-tp-login]')) window.twitchAuth?.login();
        });
        // Survol d'un coup de la liste : flèche d'aperçu
        let hovered = null;
        page.addEventListener('pointerover', e => {
            const uci = e.target.closest('[data-tp-move]:not(:disabled)')?.dataset.tpMove || null;
            if (uci !== hovered) { hovered = uci; hoverMove(uci); }
        });
        let side = 'live';
        try { side = localStorage.getItem(SIDE_KEY) || 'live'; } catch { /* navigation privée */ }
        setSide(side, false);
        document.getElementById('btnRefreshLive')?.addEventListener('click', () => loadLive(true));
        document.getElementById('liveSearchInput')?.addEventListener('input', () => { loadLive(); renderLive(); });
        document.getElementById('btnLiveCompact')?.addEventListener('click', () => setCompact(!compact));
        setCompact(compact);
        document.getElementById('eventSearchInput')?.addEventListener('input', () => { loadLive(); renderPlayerHits(); });

        // Une seule boucle : visibilité de la carte, marques sur l'échiquier, rafraîchissements
        let lastFen = null, lastKey = null, tick = 0;
        setInterval(() => {
            const c = current();
            document.body.classList.toggle('t-following', !!c);
            trackLastMove(c, c?.key === lastKey ? lastFen : null);
            paintLastMove();
            paintPhotos();
            if ((c?.key || null) !== lastKey || (stateT.lastFEN !== lastFen)) {
                if (stateT.lastFEN !== lastFen && c?.key === lastKey && lastFen && stateT.lastFEN) {
                    votersResolve(lastKey, lastFen, stateT.lastFEN);
                    chatResolve(lastKey, lastFen, stateT.lastFEN);
                } else if ((c?.key || null) !== lastKey) { chatReset(c); voters.flash = null; voters.site = []; }
                if (stateT.lastFEN !== lastFen && pred.move && boardOf(pred.move.fen) !== boardOf(stateT.lastFEN)) pred.move = null;
                lastFen = stateT.lastFEN;
                const keyChanged = (c?.key || null) !== lastKey;
                lastKey = c?.key || null;
                renderPredict();
                if (keyChanged) { renderLive(); pollState(); }
                loadGuesses();
                renderChat();
            }
            if (tick % 3 === 0) renderChat();
            if (tick % 4 === 0) loadGuesses();
            if (++tick % 5 === 0) pollState();
            if (tick % 30 === 0 && pageVisible()) loadLive();
            botsTick(current());
        }, 1000);
        window.addEventListener('cg:page', e => { if (e.detail?.page === 'tournament') { loadLive(); renderPredict(); checkRegie(); } });
        window.addEventListener('twitchAuthChange', () => { renderPredict(); pollState(); checkRegie(); });
        checkRegie();
        window.addEventListener('languageChanged', () => { renderLive(); renderPredict(); renderPlayerHits(); renderChat(); });
        window.addEventListener('pieceSetChanged', renderLive);
        if (pageVisible()) loadLive();
    });
})();

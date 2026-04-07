const PROXY_BASE_T = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? '' : 'https://chesstwitchvoter.onrender.com';

let tournamentData = null;
let activeRoundId = null;

const stateT = { 
    chess: null, board: null, polling: false, pollTimer: null, 
    currentGame: null, tournamentSlug: null, lastFEN: null,
    clockInterval: null, clockWhite: 0, clockBlack: 0  // ← nouveau
};

function logT(msg, type = 'info') {
    const el = document.getElementById('liveLogT');
    if (!el) return;
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.textContent = `[${new Date().toLocaleTimeString('fr-FR')}] ${msg}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
}

function initTournamentBoard() {
    stateT.chess = new Chess();
    stateT.board = Chessboard('liveBoardT', {
        position: 'start',
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
        draggable: false,
    });
    window.addEventListener('resize', () => stateT.board?.resize());
}

async function loadTournament(input) {
    let slug = input.trim();
    const match = slug.match(/chess\.com\/events\/([^\/]+)/);
    if (match) slug = match[1];
    stateT.tournamentSlug = slug; // ← ajout
    const r = await fetch(`${PROXY_BASE_T}/proxy/chess-event/${slug}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
}

function formatElapsed(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m${s.toString().padStart(2,'0')}` : `${s}s`;
}

function renderTournament(data) {
    tournamentData = data;
    const panel = document.getElementById('tournamentPanel');
    const header = document.getElementById('tournamentHeader');
    const roundsEl = document.getElementById('tournamentRounds');

    panel.style.display = 'block';

    const tc = parseInt(data.room.timeControl);
    const liveCount = data.games.filter(g => g.result === '*').length;
    header.textContent = `${data.room.name} · ${tc >= 60 ? tc/60+'min' : tc+'s'} · ${liveCount} en cours`;

    roundsEl.innerHTML = '';
    const activeRound = data.rounds.find(r => r.startAt && !r.endAt)
                     ?? data.rounds.filter(r => r.startAt).at(-1);
    activeRoundId = activeRound?.id ?? null;

    data.rounds.forEach(r => {
        if (!r.startAt) return;
        const btn = document.createElement('button');
        btn.className = 'round-btn' + (r.id === activeRoundId ? ' is-active' : '');
        btn.textContent = `R${r.slug}`;
        btn.dataset.roundId = r.id;
        btn.addEventListener('click', () => {
            activeRoundId = r.id;
            document.querySelectorAll('.round-btn').forEach(b => b.classList.remove('is-active'));
            btn.classList.add('is-active');
            renderGames(data.games, r.id);
        });
        roundsEl.appendChild(btn);
    });

    renderGames(data.games, activeRoundId);
}

function renderGames(games, roundId) {
    const el = document.getElementById('tournamentGames');
    const filtered = games
        .filter(g => g.roundId === roundId)
        .sort((a, b) => (a.result === '*' ? 0 : 1) - (b.result === '*' ? 0 : 1) || a.board - b.board);

    if (filtered.length === 0) {
        el.innerHTML = '<div style="font-size:0.75rem;color:var(--text-muted,#55556a);">Aucune partie</div>';
        return;
    }

    el.innerHTML = '';
    const now = Date.now();

    filtered.forEach(g => {
        const isLive = g.result === '*';
        const elapsed = g.startAt ? Math.floor((now - new Date(g.startAt)) / 1000) : null;
        const wTitle = g.whiteTitle ? `<span class="player-title">${g.whiteTitle}</span> ` : '';
        const bTitle = g.blackTitle ? `<span class="player-title">${g.blackTitle}</span> ` : '';
        const wName = g.white?.preferredShortName?.trim() || g.slug.split('-')[0];
        const bName = g.black?.preferredShortName?.trim() || g.slug.split('-')[1];

        const row = document.createElement('div');
        row.className = 'tournament-game-row' + (isLive ? ' is-live' : ' is-finished');
        row.innerHTML = `
            <div class="tg-players">
                <span class="tg-white">${wTitle}${wName} <span class="tg-elo">${g.whiteElo ?? ''}</span></span>
                <span class="tg-sep">vs</span>
                <span class="tg-black">${bTitle}${bName} <span class="tg-elo">${g.blackElo ?? ''}</span></span>
            </div>
            <div class="tg-meta">
                ${isLive
                    ? `<span class="tg-live-dot"></span><span class="tg-elapsed">${elapsed !== null ? formatElapsed(elapsed) : '—'}</span>`
                    : `<span class="tg-result">${g.result}</span>`
                }
            </div>`;

        if (isLive && g.currentFEN) {
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                stateT.chess.reset();
                stateT.board.position(g.currentFEN ?? 'start');
                document.getElementById('fenDisplayT').textContent = `FEN : ${g.currentFEN ?? '—'}`;
                document.getElementById('playerWhiteT').textContent = wName;
                document.getElementById('ratingWhiteT').textContent = g.whiteElo ? `(${g.whiteElo})` : '';
                document.getElementById('playerBlackT').textContent = bName;
                document.getElementById('ratingBlackT').textContent = g.blackElo ? `(${g.blackElo})` : '';
                logT(`${wName} vs ${bName} — suivi démarré`, 'ok');
                startGamePolling(g);  // ← remplace l'ancien log statique
            });
        }

        el.appendChild(row);
    });
}

async function startGamePolling(game) {
    stopGamePolling();
    stopClockT();  // ← reset
    stateT.currentGame = game;
    stateT.lastFEN = null;
    stateT.polling = true;
    logT(`Suivi de ${game.white?.preferredShortName} vs ${game.black?.preferredShortName}`, 'info');
    await pollGame();
}

function stopGamePolling() {
    stateT.polling = false;
    clearTimeout(stateT.pollTimer);
    stopClockT();  // ← reset
    stateT.currentGame = null;
}

async function pollGame() {
    if (!stateT.polling || !stateT.currentGame) return;
    const g = stateT.currentGame;
    try {
        const r = await fetch(`${PROXY_BASE_T}/proxy/chess-event/${stateT.tournamentSlug}`);
        if (r.ok) {
            const data = await r.json();


            
            const updatedGame = data.games.find(game => game.slug === g.slug);
            console.log('🎯 updatedGame keys:', updatedGame ? Object.keys(updatedGame) : 'null');
            console.log('🎯 updatedGame full:', JSON.stringify(updatedGame)?.slice(0, 1500));
            console.log('🎯 chess.history() length:', stateT.chess.history().length);





            if (updatedGame?.currentFEN && updatedGame.currentFEN !== stateT.lastFEN) {
                const prevFEN = stateT.lastFEN;
                stateT.lastFEN = updatedGame.currentFEN;

                // Highlight : trouver le coup joué entre prevFEN et le nouveau FEN
                if (prevFEN) {
                    const prevObj = Chessboard.fenToObj(prevFEN);
                    const newObj  = Chessboard.fenToObj(updatedGame.currentFEN);
                    
                    // Cases qui ont disparu = "from", cases qui sont apparues = "to"
                    const disappeared = Object.keys(prevObj).filter(sq => !newObj[sq] || newObj[sq] !== prevObj[sq]);
                    const appeared    = Object.keys(newObj).filter(sq => !prevObj[sq] || newObj[sq] !== prevObj[sq]);
                    
                    // Le "to" est la case qui a reçu une pièce (appeared), le "from" celle qui s'est vidée
                    const toSq   = appeared.find(sq => !prevObj[sq]);
                    const fromSq = disappeared.find(sq => !newObj[sq]);
                    
                    if (fromSq && toSq) highlightLastMoveT(fromSq, toSq);
                }

                stateT.chess.load(updatedGame.currentFEN);
                stateT.board.position(updatedGame.currentFEN);
                updateTurnIndicatorT();

                // Chrono — resync depuis les données Chess.com si dispo, sinon simulation
                if (updatedGame.whiteClock != null) {
                    startClockT(updatedGame.whiteClock, updatedGame.blackClock);
                }

                // Phantom
                if (window.phantomChessboard?.isConnected) {
                    await window.phantomChessboard.syncPosition(updatedGame.currentFEN);
                    logT('Phantom synchronisé', 'ok');
                }
            }
            renderGames(data.games, activeRoundId);
        }
    } catch (err) {
        logT(`Poll erreur : ${err.message}`, 'error');
    }
    stateT.pollTimer = setTimeout(pollGame, 5000);
}

function highlightLastMoveT(from, to) {
    document.querySelectorAll('.highlight-last-move-live')
        .forEach(el => el.classList.remove('highlight-last-move-live'));
    const fromSq = document.querySelector(`#liveBoardT [data-square="${from}"]`);
    const toSq   = document.querySelector(`#liveBoardT [data-square="${to}"]`);
    if (fromSq) fromSq.classList.add('highlight-last-move-live');
    if (toSq)   toSq.classList.add('highlight-last-move-live');
}

function updateTurnIndicatorT() {
    const turn = stateT.chess?.turn();
    document.getElementById('playerWhiteT')?.closest('.player-row')
        ?.classList.toggle('is-turn', turn === 'w');
    document.getElementById('playerBlackT')?.closest('.player-row')
        ?.classList.toggle('is-turn', turn === 'b');
}

function startClockT(whiteMs, blackMs) {
    stopClockT();
    stateT.clockWhite = whiteMs;
    stateT.clockBlack = blackMs;
    stateT.clockInterval = setInterval(() => {
        const turn = stateT.chess?.turn();
        if (turn === 'w') stateT.clockWhite = Math.max(0, stateT.clockWhite - 1000);
        else              stateT.clockBlack = Math.max(0, stateT.clockBlack - 1000);
        renderClocksT();
    }, 1000);
    renderClocksT();
}

function stopClockT() {
    clearInterval(stateT.clockInterval);
    stateT.clockInterval = null;
}

function renderClocksT() {
    const fmt = ms => {
        const total = Math.floor(ms / 1000);
        const m = Math.floor(total / 60);
        const s = total % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    };
    document.getElementById('clockWhiteT').textContent = fmt(stateT.clockWhite);
    document.getElementById('clockBlackT').textContent = fmt(stateT.clockBlack);
}


// ── Liste des tournois en cours ──
let allEvents = [];

async function fetchEventsList() {
    const el = document.getElementById('eventsList');
    if (el) el.innerHTML = '<span style="color:var(--text-muted,#55556a); font-size:0.8rem;">Chargement…</span>';
    try {
        const r = await fetch(`${PROXY_BASE_T}/proxy/chess-events-list`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
    } catch (err) {
        if (el) el.innerHTML = `<span style="color:#f87171; font-size:0.8rem;">Erreur : ${err.message}</span>`;
        return [];
    }
}

// Suffixes courants pour les index events (parent → sub-rooms)
const SLUG_SUFFIXES = ['-open', '-women', '-blitz', '-rapid', '-classic', '-standard', '-bullet'];

async function loadAndRenderTournament(slug) {
    try {
        logT(`Chargement de "${slug}"…`, 'info');
        let data;
        try {
            data = await loadTournament(slug);
        } catch (err404) {
            if (!err404.message.includes('404') && !err404.message.includes('HTTP 4')) throw err404;
            // Slug d'index (événement parent) → essai avec suffixes courants
            logT(`Slug introuvable, recherche de sub-rooms…`, 'warn');
            let found = false;
            for (const suffix of SLUG_SUFFIXES) {
                try {
                    data = await loadTournament(slug + suffix);
                    slug = slug + suffix;
                    const input = document.getElementById('tournamentInput');
                    if (input) input.value = slug;
                    logT(`Sub-room trouvée : "${slug}"`, 'ok');
                    found = true;
                    break;
                } catch { /* continuer */ }
            }
            if (!found) {
                logT(`Aucune sub-room trouvée. Essayez un slug plus précis (ex: ${slug}-open).`, 'error');
                return;
            }
        }
        renderTournament(data);
        logT(`${data.games.length} parties chargées`, 'ok');
    } catch (err) {
        logT(`Erreur : ${err.message}`, 'error');
    }
}

function renderEventsList(events, filter = '') {
    const el = document.getElementById('eventsList');
    if (!el) return;

    const shown = filter
        ? events.filter(e => e.name.toLowerCase().includes(filter.toLowerCase()))
        : events;

    if (shown.length === 0) {
        el.innerHTML = '<span style="color:var(--text-muted,#55556a); font-size:0.8rem;">Aucun tournoi trouvé</span>';
        return;
    }

    el.innerHTML = '';
    const fmtDate = d => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    const typeLabel = { 'swiss': 'Suisse', 'round-robin': 'Toutes rondes', 'team-round-robin': 'Équipes', 'event': 'Événement' };

    shown.forEach(event => {
        const row = document.createElement('div');
        row.style.cssText = [
            'padding:6px 8px', 'border-radius:6px', 'cursor:pointer',
            'background:rgba(139,92,246,0.05)', 'border:1px solid rgba(139,92,246,0.15)',
            'transition:background 0.15s', 'display:flex', 'flex-direction:column', 'gap:2px'
        ].join(';');

        const label = typeLabel[event.eventType] ?? event.eventType ?? 'Tournoi';
        const players = event.playerCount > 0 ? `<span>· ${event.playerCount} joueurs</span>` : '';

        row.innerHTML = `
            <div style="font-size:0.82rem; font-weight:600; color:var(--text-primary,#e2e8f0);
                        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${event.name}">
                ${event.name}
            </div>
            <div style="font-size:0.7rem; color:var(--text-muted,#55556a); display:flex; gap:6px; flex-wrap:wrap;">
                <span>${label}</span>
                <span>· ${fmtDate(event.startAt)} → ${fmtDate(event.endAt)}</span>
                ${players}
            </div>`;

        row.addEventListener('mouseenter', () => row.style.background = 'rgba(139,92,246,0.15)');
        row.addEventListener('mouseleave', () => row.style.background = 'rgba(139,92,246,0.05)');
        row.addEventListener('click', () => {
            const input = document.getElementById('tournamentInput');
            if (input) input.value = event.slug;
            loadAndRenderTournament(event.slug);
        });

        el.appendChild(row);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btnLoadTournament');
    if (!btn) return;

    // Chargement initial de la liste
    fetchEventsList().then(events => {
        allEvents = events;
        renderEventsList(events);
    });

    // Filtre texte en temps réel
    document.getElementById('eventSearchInput')?.addEventListener('input', function () {
        renderEventsList(allEvents, this.value);
    });

    // Bouton refresh
    document.getElementById('btnRefreshEvents')?.addEventListener('click', async () => {
        const icon = document.querySelector('#btnRefreshEvents i');
        if (icon) icon.style.animation = 'spin 0.6s linear infinite';
        allEvents = await fetchEventsList();
        renderEventsList(allEvents, document.getElementById('eventSearchInput')?.value || '');
        if (icon) icon.style.animation = '';
    });

    // Auto-load depuis ?event=slug ou #/tournament?event=slug
    const hash = window.location.hash;
    const hashParams = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
    const eventSlug = hashParams.get('event');
    if (eventSlug) {
        const input = document.getElementById('tournamentInput');
        if (input) input.value = eventSlug;
        loadAndRenderTournament(eventSlug);
    }

    btn.addEventListener('click', async () => {
        const slug = document.getElementById('tournamentInput')?.value.trim();
        if (!slug) return;
        loadAndRenderTournament(slug);
    });

    // Phantom
    document.getElementById('btnPhantomT')?.addEventListener('click', async () => {
        if (!window.phantomChessboard) { logT('Module Phantom non chargé', 'error'); return; }
        const connected = await window.phantomChessboard.connect();
        logT(connected ? 'Phantom connecté' : 'Connexion échouée', connected ? 'ok' : 'error');
    });

    document.getElementById('phantomSpeedT')?.addEventListener('input', function() {
        document.getElementById('speedValT').textContent = this.value;
    });
    document.getElementById('phantomSpeedT')?.addEventListener('change', async function() {
        if (window.phantomChessboard?.isConnected) {
            await window.phantomChessboard.setSpeed(parseInt(this.value));
            logT(`Vitesse réglée à ${this.value}/5`, 'ok');
        }
    });
    
    document.getElementById('btnSyncT')?.addEventListener('click', async () => {
        if (!window.phantomChessboard?.isConnected) { logT('Phantom non connecté', 'warn'); return; }
        if (stateT.chess) await window.phantomChessboard.syncPosition(stateT.chess.fen());
        logT('Synchronisation envoyée', 'ok');
    });

    document.getElementById('btnResetT')?.addEventListener('click', async () => {
        stopGamePolling();
        stateT.chess.reset();
        stateT.board.position('start');
        stateT.lastFEN = null;
        document.querySelectorAll('.highlight-last-move-live')
            .forEach(el => el.classList.remove('highlight-last-move-live'));
        document.getElementById('fenDisplayT').textContent = 'FEN : —';
        document.getElementById('playerWhiteT').textContent = '—';
        document.getElementById('playerBlackT').textContent = '—';
        document.getElementById('clockWhiteT').textContent = '—';
        document.getElementById('clockBlackT').textContent = '—';
        const badgeT = document.getElementById('statusBadgeT');
        if (badgeT) badgeT.className = 'live-badge idle';
        const statusTextT = document.getElementById('statusTextT');
        if (statusTextT) statusTextT.textContent = 'En attente';
        if (window.phantomChessboard?.isConnected) {
            window.phantomChessboard.sendGameStart();
            await window.phantomChessboard.syncPosition(stateT.chess.fen());
            logT('Échiquier réinitialisé et synchronisé', 'ok');
        } else {
            logT('Échiquier réinitialisé', 'ok');
        }
    });

    document.getElementById('btnCalibrateT')?.addEventListener('click', async () => {
        if (!window.phantomChessboard?.isConnected) { logT('Phantom non connecté', 'warn'); return; }
        await window.phantomChessboard.calibrate();
        logT('Calibration lancée', 'ok');
    });

    setInterval(() => {
        const el = document.getElementById('phantomStatusT');
        if (!el) return;
        if (window.phantomChessboard?.isConnected) {
            el.className = 'phantom-status connected';
            el.innerHTML = '<i class="fas fa-check-circle"></i> Connecté';
        } else {
            el.className = 'phantom-status disconnected';
            el.innerHTML = '<i class="fas fa-times-circle"></i> Déconnecté';
        }
    }, 2000);
});
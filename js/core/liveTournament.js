const PROXY_BASE_T = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? '' : 'https://chesstwitchvoter.onrender.com';

let tournamentData = null;
let activeRoundId = null;

const stateT = { chess: null, board: null, polling: false, pollTimer: null, currentGame: null };

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
    stateT.currentGame = game;
    stateT.polling = true;
    stateT.chess.reset();
    logT(`Suivi de ${game.white?.preferredShortName} vs ${game.black?.preferredShortName}`, 'info');
    await pollGame();
}

function stopGamePolling() {
    stateT.polling = false;
    clearTimeout(stateT.pollTimer);
    stateT.currentGame = null;
}

async function pollGame() {
    if (!stateT.polling || !stateT.currentGame) return;
    const g = stateT.currentGame;
    const round = tournamentData.rounds.find(r => r.id === g.roundId);
    const roundSlug = String(round?.slug ?? '01').padStart(2, '0');
    const r = await fetch(`${PROXY_BASE_T}/proxy/chess-event-game/${stateT.tournamentSlug}/${roundSlug}/${g.slug}`);

        if (r.ok) {
            const data = await r.json();
            if (data.fen) {
                stateT.chess.load(data.fen);
                stateT.board.position(data.fen);
                document.getElementById('fenDisplayT').textContent = `FEN : ${data.fen}`;
            }
        }
    } catch (err) {
        logT(`Poll erreur : ${err.message}`, 'error');
    }
    stateT.pollTimer = setTimeout(pollGame, 5000);
}

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btnLoadTournament');
    if (!btn) return;

    //initTournamentBoard();

    btn.addEventListener('click', async () => {
        const slug = document.getElementById('tournamentInput').value.trim();
        if (!slug) return;
        try {
            logT(`Chargement du tournoi…`, 'info');
            const data = await loadTournament(slug);
            renderTournament(data);
            logT(`${data.games.length} parties chargées`, 'ok');
        } catch (err) {
            logT(`Erreur : ${err.message}`, 'error');
        }
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
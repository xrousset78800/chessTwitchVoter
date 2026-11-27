/**
 * GAME ENGINE MODULE
 * Logique centrale du jeu d'échecs avec votes
 * Compatible avec Chess.js 0.10.x (ancienne API)
 *
 * ⚠️ MODIFIÉ: Support natif du mode problèmes via window.problemsManager
 */

import timer from './timer.js';
import voting from './voting.js';
import VotingWheel from '../components/wheel.js';
import WheelBand from '../components/wheelBand.js';
import { paletteColors } from '../components/votePalettes.js';
import { secretVotes } from '../components/voteAnonymity.js';
import { renderPodium, renderHistory, VoteTicker, paintMoveChips, morphPodiumToWheel, clearWinner } from '../components/voteViews.js';
import { fmtMove } from '../utils/moveMatch.js';

class GameEngine {
    constructor() {
        // État du jeu
        this.chess = null;           // Instance Chess.js
        this.board = null;           // Instance Chessboard.js
        this.isRunning = false;
        this.currentTurn = 'w';      // 'w' ou 'b'

        // Configuration
        this.config = {
            timerEnabled: false,
            timerDuration: 25,
            wheelDuration: 6,
            pauseAfterEnd: 15,
            majorityMode: true,
            votesPerViewer: 1
        };

        // Mode de jeu
        this.mode = 'sandbox';       // sandbox, problems, oneVsAll, oneVsOne, chatVsChat
        this.modeHandler = null;     // Handler spécifique au mode
        this.session = null;         // Partie à joueurs inscrits : { humanColor: 'w' | 'b' | null }
        this.vsBot = null;           // Contre Stockfish : { color: camp de Stockfish ('w' | 'b'), elo }
        this.engineKey = null;       // Position où Stockfish réfléchit (coup ignoré si elle a changé)

        // Historique
        this.moveHistory = [];

        // Callbacks
        this.onMove = null;
        this.onGameEnd = null;
        this.onTurnChange = null;


        // Sons
        this.sounds = {
            move: new Audio('mp3/move.mp3'),
            capture: new Audio('mp3/take.mp3'),
            check: new Audio('mp3/check.mp3'),
            mate: new Audio('mp3/end.wav')
        };
    }

    /**
     * Initialise le moteur de jeu
     */
    init(options = {}) {
        console.log('🎮 Initialisation du GameEngine...');

        // Appliquer la config
        Object.assign(this.config, options);

        // Créer l'instance Chess.js
        this.chess = new Chess();

        // Créer l'échiquier
        const boardConfig = {
            draggable: true,
            position: 'start',
            pieceTheme: p => window.pieceUrl(p),
            onDragStart: this.onDragStart.bind(this),
            onDrop: this.onDrop.bind(this),
            onSnapEnd: this.onSnapEnd.bind(this)
        };

        this.board = Chessboard('myBoard', boardConfig);
        window.BoardAnnotations?.attach('myBoard', { draggable: true });
        // Survol : la pièce qu'on peut jouer se soulève (mêmes règles que le glisser)
        document.getElementById('myBoard')?.addEventListener('mouseover', (e) => {
            const sq = e.target.closest?.('[data-square]');
            if (!sq) return;
            const piece = sq.querySelector('img[data-piece]')?.dataset.piece;
            sq.classList.toggle('can-grab', !!piece && this.onDragStart(sq.dataset.square, piece) !== false);
        });

        // Initialiser le timer avec les callbacks
        timer.init({
            duration: this.config.timerDuration,
            onTick: (remaining) => this.onTimerTick(remaining),
            onComplete: () => this.onTimerComplete()
        });

        // Initialiser le système de vote
        voting.init({
            votesPerViewer: this.config.votesPerViewer,
            majorityMode: this.config.majorityMode,
            onVoteAdded: (vote, results) => this.onVoteAdded(vote, results)
        });

        this.setWheelStyle(this.wheelStyle);

        window.addEventListener('phantomMoveStart', () => {
            if (this.config.timerEnabled && timer.isRunning) {
                console.log('⏸️ Pause timer - Phantom en mouvement');
                timer.pause();
            }
        });

        window.addEventListener('phantomMoveComplete', () => {
            if (this.config.timerEnabled && timer.isRunning && timer.isPaused) {
                console.log('▶️ Reprise timer - Phantom terminé');
                timer.resume();
            }
        });

        // Créer le panneau des coups disponibles
        this.createMovesPanel();

        // Resize handler
        window.addEventListener('resize', () => this.board?.resize());

        console.log('✅ GameEngine initialisé');
        return this;
    }

    // ========== DRAG & DROP ==========

    /**
     * Appelé au début d'un drag
     */
    onDragStart(source, piece, position, orientation) {
        // Ne pas autoriser si partie terminée
        if (this.chess.game_over()) return false;
        // Pendant le tirage : flèches au clic droit oui, déplacement de pièce non
        if (document.body.classList.contains('randomWheel')) return false;

        // ========== MODE PROBLÈMES ==========
        if (window.problemsManager?.isActive) {
            // Vérifier que c'est le tour du joueur (index impair)
            if (window.problemsManager.attemptIndex % 2 !== 1) return false;

            // Vérifier la couleur de la pièce
            const turn = this.chess.turn();
            if ((turn === 'w' && piece.search(/^b/) !== -1) ||
                (turn === 'b' && piece.search(/^w/) !== -1)) {
                return false;
            }

            return true;
        }

        // ========== MODE NORMAL ==========
        // Contre Stockfish : pas de pièce à toucher pendant son tour
        if (this.engineToMove()) return false;
        // Ne pas autoriser de bouger les pièces adverses
        const turn = this.chess.turn();
        if ((turn === 'w' && piece.search(/^b/) !== -1) ||
            (turn === 'b' && piece.search(/^w/) !== -1)) {
            return false;
        }

        return this.canHumanPlay();
    }

    /**
     * Partie à joueurs inscrits : seul le streamer touche l'échiquier, à son tour.
     * Toujours true hors de ces parties.
     */
    dropIsVote() {
        const pm = window.problemsManager;
        return !!pm?.isActive && !!(pm.config?.timerEnabled ?? this.config.timerEnabled);
    }

    /** Contre Stockfish : c'est à lui de jouer */
    engineToMove() {
        return !!this.vsBot && this.isRunning && !this.chess.game_over() && this.chess.turn() === this.vsBot.color;
    }

    /**
     * Coup de Stockfish (Worker de la page, au niveau choisi). Pas de vote ni de chrono pendant ce temps ;
     * au moins ~1,2 s pour que le coup ne tombe pas instantanément. Sans moteur : coup au hasard.
     */
    async engineTurn() {
        timer.stop();
        voting.reset();
        voting.close();
        if (this.votingWheel) this.votingWheel.clear();
        const BE = window.BotEngine;
        const level = BE?.levelLabel(this.vsBot.elo) || String(this.vsBot.elo);
        const track = document.getElementById('vote-ticker-track');
        if (track) {
            const t = window.i18n?.t('gameMode.vsBot.thinking') || 'Stockfish réfléchit…';
            track.innerHTML = `<span class="vote-ticker__item engine-thinking"><i class="fas fa-robot"></i> Stockfish ${level} · ${t}</span>`;
        }
        const fen = this.chess.fen();
        const key = this.engineKey = `${fen}|${this.moveHistory.length}`;
        const started = Date.now();
        let uci = null;
        try {
            const legal = BE.legalUci(this.chess);
            const engine = BE.browserEngine();
            uci = engine ? await engine.botMove(fen, this.vsBot.elo, legal) : legal[Math.floor(Math.random() * legal.length)];
        } catch (e) {
            console.warn('Stockfish :', e);
        }
        const wait = 1200 - (Date.now() - started);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        // Partie arrêtée, relancée ou position changée pendant la réflexion
        if (this.engineKey !== key || !this.engineToMove() || `${this.chess.fen()}|${this.moveHistory.length}` !== key) return;
        this.engineKey = null;
        const san = BE?.uciToSan(this.chess, uci) || this.chess.moves()[0];
        if (san) { this.engineMoving = true; try { this.executeMove(san); } finally { this.engineMoving = false; } }
    }

    canHumanPlay() {
        if (!this.session) return true;
        return this.isRunning && !this.streamerDraw && this.session.humanColor === this.chess.turn();
    }

    /**
     * Appelé quand une pièce est droppée
     * ⚠️ MODIFIÉ: Délègue au problemsManager si mode problèmes actif
     */
    onDrop(source, target) {
        // ========== MODE PROBLÈMES ==========
        if (window.problemsManager?.isActive) {
            console.log('🧩 [GameEngine.onDrop] Mode problèmes actif');
            console.log('🧩 [GameEngine.onDrop] Coup tenté:', source, '→', target);

            // Construire le coup UCI
            const moveUCI = source + target;

            // Vote en cours : le coup posé compte comme un vote, il n'est pas joué
            if (this.dropIsVote()) {
                // Vote du streamer (son pseudo) : même limite de votes que le chat, plus de votes « anonymes » à l'infini
                window.problemsManager.receiveVote({ move: moveUCI, ...this.streamerVoter() }, 'en');
                return 'snapback';
            }

            // Déléguer la validation au problemsManager
            const result = window.problemsManager.validateAndPlayMove(moveUCI);

            console.log('🧩 [GameEngine.onDrop] Résultat:', result);

            // Si coup invalide ou incorrect → snapback
            if (!result.valid || !result.correct) {
                return 'snapback';
            }

            // Coup correct - le problemsManager a déjà mis à jour le board
            // Ne rien retourner (pas de snapback)
            return;
        }

        // ========== MODE NORMAL ==========
        if (this.engineToMove()) return 'snapback';
        // Vote en cours (timer actif, hors partie à inscrits) : le coup posé par le streamer
        // compte comme un vote, comme un clic dans la liste des coups ; il n'est pas joué
        if (!this.session && this.config.timerEnabled) {
            const probe = new Chess(this.chess.fen()).move({ from: source, to: target, promotion: 'q' });
            if (probe && voting.isOpen) this.voteAsStreamer(probe.san);
            return 'snapback';
        }

        // Tenter le coup
        const move = this.chess.move({
            from: source,
            to: target,
            promotion: 'q'
        });

        if (move === null) return 'snapback';

        // En mode avec timer/vote, on devrait passer par le système de vote
        // Pour l'instant, on exécute directement (mode drag & drop)
        this.moveHistory.push(move);
        this.highlightLastMove(move.from, move.to);
        this.playMoveSound(move);
        this.updateHistoryUI(move);
        this.syncPhantom();

        if (this.checkGameEnd()) return;

        this.currentTurn = this.chess.turn();
        this.startTurn();
    }

    /**
     * Appelé après l'animation de snap
     */
    onSnapEnd() {
        this.board.position(this.chess.fen());
    }

    // ========== CONFIGURATION ==========

    /**
     * Met à jour la configuration
     */
    setConfig(config) {
        Object.assign(this.config, config);

        // Mettre à jour les sous-modules
        timer.setDuration(this.config.timerDuration);
        voting.setMode({
            votesPerViewer: this.config.votesPerViewer,
            majorityMode: this.config.majorityMode
        });
    }

    /**
     * Retourne le FEN actuel
     */
    getFen() {
        return this.chess.fen();
    }

    /**
     * Charge une position FEN
     */
    loadFen(fen) {
        const valid = this.chess.load(fen);
        if (valid) {
            this.board.position(fen);
            this.moveHistory = [];
            this.currentTurn = this.chess.turn();
            this.updateAvailableMoves();
        }
        return valid;
    }

    /**
     * Retourne l'échiquier
     */
    flip() {
        this.board.flip();
    }

    /**
     * Annule le dernier coup
     */
    undo() {
        const move = this.chess.undo();
        if (move) {
            this.board.position(this.chess.fen());
            this.moveHistory.pop();
            this.updateHistoryUI();
            this.updateAvailableMoves();
            this.syncPhantom();
        }
        return move;
    }

    /**
     * Réinitialise l'échiquier
     */
    reset() {
        // Moteur pas encore initialisé (partie lancée avant toute visite de Nouveau) : rien à remettre
        if (!this.chess || !this.board) return;
        this.chess.reset();
        this.board.position('start', false); // sans animation : pas de pièces qui volent au-dessus de la page qu'on quitte
        this.moveHistory = [];
        this.currentTurn = 'w';
        this.isRunning = false;
        this.updateAvailableMoves();
        this.updateHistoryUI();
    }

    // ========== SONS ==========

    playMoveSound(move) {
        try {
            if (this.chess.in_checkmate?.() || this.chess.game_over?.()) {
                this.sounds.mate?.play();
            } else if (this.chess.in_check?.()) {
                this.sounds.check?.play();
            } else if (move.captured) {
                this.sounds.capture?.play();
            } else {
                this.sounds.move?.play();
            }
        } catch (e) {
            // Ignorer les erreurs de son
        }
    }

    // ========== SYNCHRONISATION PHANTOM ==========

    syncPhantom() {
        if (window.phantomChessboard?.isConnected && this.config.phantomAutoSync !== false) {
            window.phantomChessboard.syncPosition(this.chess.fen());
        }
    }

    // ========== GAME STATE ==========

    checkGameEnd() {
        if (this.chess.game_over()) {
            let result = '';
            if (this.chess.in_checkmate()) {
                result = window.tt(this.chess.turn() === 'w' ? 'ui.result.blackWins' : 'ui.result.whiteWins');
            } else if (this.chess.in_stalemate()) {
                result = window.tt('ui.result.stalemate');
            } else if (this.chess.insufficient_material()) {
                result = window.tt('ui.result.material');
            } else if (this.chess.in_threefold_repetition()) {
                result = window.tt('ui.result.repetition');
            } else if (Number(this.chess.fen().split(' ')[4]) >= 100) {
                result = window.tt('ui.result.fifty');
            } else {
                result = window.tt('ui.result.draw');
            }

            console.log('🏁 Fin de partie:', result);

            if (this.onGameEnd) {
                this.onGameEnd(result);
            }

            this.isRunning = false;
            return true;
        }
        return false;
    }

    // ========== TIMER ==========

startTurn() {
    this.streamerDraw = false;   // nouveau tour (ou nouvelle partie) : plus de tirage en cours
    clearTimeout(this.previewTimer);
    this.annotations?.setOverlay(null);
    VoteTicker.clear();
    // Mode problèmes : le timer est géré par problemsManager
    if (window.problemsManager?.isActive) {
        this.updateAvailableMoves();
        if (this.onTurnChange) this.onTurnChange(this.currentTurn);
        return;
    }

    // Contre Stockfish : son tour, pas de vote
    if (this.engineToMove()) {
        this.engineTurn();
        this.updateAvailableMoves();
        if (this.onTurnChange) this.onTurnChange(this.currentTurn);
        return;
    }

    // Tour du streamer : pas de vote, il joue sur l'échiquier avec le même temps que le chat
    // (coup au hasard à la fin du chrono, voir onTimerComplete)
    if (this.session && this.canHumanPlay()) {
        timer.stop();
        if (this.config.timerEnabled) timer.start(this.config.timerDuration);
        voting.reset();
        if (this.votingWheel) this.votingWheel.clear();
        this.updateAvailableMoves();
        if (this.onTurnChange) this.onTurnChange(this.currentTurn);
        return;
    }

    // Multi : la page qui n'a pas le trait attend le coup de l'autre chaîne.
    // Son timer jouerait sinon un coup au hasard pour le camp adverse.
    if (!this.isMyTurnInMulti()) {
        timer.stop();
        voting.reset();
        if (this.votingWheel) this.votingWheel.clear();
        window.multiplayerManager.updateTurnIndicator();
        this.updateAvailableMoves();
        if (this.onTurnChange) this.onTurnChange(this.currentTurn);
        return;
    }

    if (this.config.timerEnabled) {
        voting.reset();
        voting.setMode({ votesPerViewer: this.config.votesPerViewer });
        voting.open();
        timer.start(this.config.timerDuration);
        if (this.votingWheel) this.votingWheel.clear();
    }

    // Mettre à jour l'indicateur de tour multi
    if (window.multiplayerManager?.gameId) {
        window.multiplayerManager.updateTurnIndicator();
    }

    this.updateAvailableMoves();
    if (this.onTurnChange) this.onTurnChange(this.currentTurn);
}

    onTimerTick(remaining) {
        // Peut être utilisé pour des animations
    }

onTimerComplete() {
    console.log('⏱️ Timer terminé !');

    // Mode problèmes : ne pas traiter ici, c'est le problemsManager qui gère
    if (window.problemsManager?.isActive) {
        console.log('⏱️ Timer ignoré (mode problèmes actif)');
        return;
    }

    // Tour du streamer écoulé sans coup : même tirage que le chat sans vote
    // (roue ou bande, podium en majorité). L'échiquier est verrouillé pendant le tirage.
    if (this.session && this.canHumanPlay()) {
        this.streamerDraw = true;
        window.AppToast?.info?.(window.i18n?.t('lobby.streamerTimeout') || '⏱️');
        voting.close();
        this.playRandomMove();
        return;
    }

    voting.close();
    this.processVoteResult();
}

    // ========== VOTES ==========

onVoteAdded(vote, results) {
    console.log('🗳️ Vote ajouté:', vote.player, '→', vote.move);

    // Log dans la sidebar
    if (window.VoteLog) window.VoteLog.add(vote.player || 'chat', vote.move);

    const sortedResults = voting.getSortedResults();
    this.updateVotesUI(sortedResults);

    if (this.votingWheel) {
        this.syncWheelFromVoting();
    }

    this.highlightMostVoted();
}

/**
 * Synchronise VotingWheel avec les données de VotingSystem
 */
syncWheelFromVoting() {
    if (!this.votingWheel) return;

    // Clear la roue
    this.votingWheel.votes.clear();

    // Reconstruire depuis voting.votes (le tableau brut)
    const allVotes = voting.getAllVotes();

    allVotes.forEach((vote, index) => {
        if (!this.votingWheel.votes.has(vote.move)) {
            this.votingWheel.votes.set(vote.move, { count: 0, voters: new Map() });
        }

        const voteData = this.votingWheel.votes.get(vote.move);
        voteData.count++;

        // Tracker le voter (pour l'affichage, pas pour bloquer)
        const voterCount = voteData.voters.get(vote.player) || 0;
        voteData.voters.set(vote.player, voterCount + 1);
    });

    // Redessiner
    this.votingWheel.draw();
    this.votingWheel.updateVoteList();
}
highlightMostVoted() {
    // Vote secret : ni flèche ni coup en surbrillance pendant le tour
    const results = secretVotes() ? [] : voting.getSortedResults();
    this.showLeadArrow(results);

    // Retirer l'ancienne surbrillance
    document.querySelectorAll('.moves-group li').forEach(li => {
        li.classList.remove('most-voted');
    });
    if (results.length === 0) return;

    const topMove = results[0].move;

    // Ajouter la surbrillance au coup le plus voté
    document.querySelectorAll('.moves-group button').forEach(btn => {
        if (btn.textContent === topMove || btn.textContent === topMove.replace('#', '').replace('+', '')) {
            btn.parentElement.classList.add('most-voted');
        }
    });
}
    /** Annotations de l'échiquier principal (flèches, dernier coup) */
    get annotations() {
        return window.BoardAnnotations?.get('myBoard') || null;
    }

    /** Coup voté (SAN ou e2e4) -> coup légal détaillé de la position actuelle */
    resolveMove(str) {
        if (!str || !this.chess) return null;
        const clean = String(str).replace(/[+#!?]/g, '');
        return this.chess.moves({ verbose: true }).find(m =>
            m.san === str || m.san.replace(/[+#]/g, '') === clean || m.from + m.to + (m.promotion || '') === clean
        ) || null;
    }

    /** Pendant le vote : une flèche par coup voté, avec son nombre de votes (les coups en tête ressortent) */
    showLeadArrow(results) {
        const ann = this.annotations;
        if (!ann) return;
        const moves = secretVotes() ? [] : (results || []).filter(r => r.count > 0)
            .map(r => { const m = this.resolveMove(r.move); return m && { ...m, n: r.count }; }).filter(Boolean);
        ann.setOverlay(moves.length ? { kind: 'lead', moves } : null);
    }

    /**
     * Juste avant de jouer le coup gagnant : grosse flèche + « Cf3 · 42 % » pendant ~1,3 s
     * (sauf si la position change entre-temps : coup réseau, nouvelle partie…)
     */
    previewWinner(moveStr, percentage, play) {
        // Score du vote, affiché sous le coup dans l'historique (🎲 : tirage au sort)
        this.pendingVote = { move: moveStr, v: percentage == null ? 'r' : percentage };
        const ann = this.annotations;
        const m = this.resolveMove(moveStr);
        if (!ann || !m) { play(); return; }
        const label = percentage == null ? `🎲 ${fmtMove(m.san)}` : `${fmtMove(m.san)} · ${percentage} %`;
        ann.setOverlay({ kind: 'win', from: m.from, to: m.to, label });
        const fen = this.chess.fen();
        clearTimeout(this.previewTimer);
        this.previewTimer = setTimeout(() => {
            if (this.chess.fen() !== fen) { ann.setOverlay(null); return; }
            play();
        }, 1300);
    }

    processVoteResult() {
        // ========== MODE MULTI : jouer seulement si c'est notre tour ==========
        if (window.multiplayerManager?.gameId && window.playerColor) {
            const turn = this.chess.turn(); // 'w' ou 'b'
            const isMyTurn = (window.playerColor === 'white' && turn === 'w') ||
                             (window.playerColor === 'black' && turn === 'b');
            if (!isMyTurn) {
                voting.reset();
                console.log('⏳ Multi : timer expiré mais pas notre tour — on attend le coup adverse');
                return;
            }
        }

        const results = voting.getSortedResults();

        // ========== CAS 1: AUCUN VOTE → COUP ALÉATOIRE ==========
        if (!results || results.length === 0) {
            console.warn('⚠️ Aucun vote reçu');
            this.playRandomMove();
            return;
        }

        // ========== CAS 2: MODE MAJORITÉ → EXÉCUTION DIRECTE ==========
        if (this.config.majorityMode) {
            const winner = voting.selectByMajority();
            const pct = results.find(r => r.move === winner)?.percentage ?? null;
            this.previewWinner(winner, pct, () => this.executeMove(winner));
            return;
        }

        // ========== CAS 3: MODE ROUE → ANIMATION ==========
        console.log('🎡 Mode roue - Animation...');
        this.showWheelAnimation(results);
    }

    /**
     * Joue un coup aléatoire (quand pas de votes)
     */
playRandomMove() {
    const moves = this.chess.moves();

    if (moves.length === 0) {
        console.log('❌ Pas de coups disponibles');
        return;
    }

    console.log('🎲 Aucun vote - Tirage au sort parmi', moves.length, 'coups');

    // Tirer au sort le gagnant
    const randomMove = moves[Math.floor(Math.random() * moves.length)];

    // Mode majorité : coup aléatoire direct (pas d'animation)
    if (this.config.majorityMode) {
        console.log('🎲 Coup aléatoire (direct):', randomMove);
        this.previewWinner(randomMove, null, () => this.executeMove(randomMove));
        return;
    }

    // Mode roue : créer des "faux votes" pour tous les coups disponibles
    console.log('🎡 Mode roue - Animation avec tous les coups...');

    const colorPalette = [
        '#8b5cf6', '#3b82f6', '#06b6d4', '#10b981',
        '#f59e0b', '#ef4444', '#ec4899', '#6366f1',
        '#14b8a6', '#f97316', '#84cc16', '#a855f7'
    ];

    // Créer un résultat avec tous les coups (1 vote chacun = chances égales)
    const randomResults = moves.map((move, i) => ({
        move: move,
        count: 1,
        color: colorPalette[i % colorPalette.length],
        percentage: Math.round(100 / moves.length)
    }));


    // Remplir la roue avec tous les coups
    if (this.votingWheel) {
        this.votingWheel.clear();
        moves.forEach((move, i) => {
            // Ajouter chaque coup une fois
            this.votingWheel.votes.set(move, { count: 1, voters: new Map([['random', 1]]) });
        });
        this.votingWheel.draw();
    }

    // Activer le visuel
    document.body.classList.add('randomWheel');

    // Lancer l'animation
    this.showWheelAnimation(randomResults);
}

/** Affichage du tirage choisi par ce navigateur : 'band' (par défaut) ou 'classic' */
get wheelStyle() {
    try {
        return localStorage.getItem('wheelStyle') === 'classic' ? 'classic' : 'band';
    } catch {
        return 'band';
    }
}

/**
 * Change l'affichage du tirage en gardant les votes en cours
 * @returns {boolean} - false si un tirage est en train de se dérouler
 */
setWheelStyle(style) {
    const area = document.getElementById('wheel-area');
    if (!area || this.votingWheel?.isSpinning) return false;

    try {
        localStorage.setItem('wheelStyle', style);
    } catch {}

    const votes = this.votingWheel?.votes;
    area.classList.toggle('wheel-area--band', style === 'band');
    // La bande reste sous l'échiquier ; la roue classique prend la place du podium
    const slot = document.getElementById('votes-panel');
    const docked = style === 'classic' && !!slot;
    area.classList.toggle('wheel-area--docked', docked);
    slot?.classList.toggle('votes-slot--wheel', docked);
    if (docked) {
        if (area.parentElement !== slot) slot.appendChild(area);
    } else {
        const ticker = document.getElementById('vote-ticker');
        if (ticker && area.previousElementSibling !== ticker) ticker.after(area);
    }
    this.votingWheel = style === 'band' ? new WheelBand('wheel-area') : new VotingWheel('wheel-area');
    // Le coup tiré s'affiche en grand dans l'encart du podium, pas sur la roue ni sur la bande
    this.votingWheel.showResultInside = false;
    if (votes) {
        this.votingWheel.votes = votes;
        this.votingWheel.draw();
    }
    return true;
}

showWheel() {
    const wheelArea = document.getElementById('wheel-area');
    if (wheelArea) {
        wheelArea.classList.add('is-visible');
    }
    // Roue classique : fondu enchaîné du podium vers la roue
    const slot = document.getElementById('votes-panel');
    if (wheelArea?.classList.contains('wheel-area--docked') && slot && !slot.classList.contains('is-drawing')) {
        morphPodiumToWheel(slot, wheelArea.querySelector('.wheel-container'));
        slot.classList.add('is-drawing');
    }
}

/**
 * Masque la roue
 */
hideWheel() {
    const wheelArea = document.getElementById('wheel-area');
    if (wheelArea) {
        wheelArea.classList.remove('is-visible', 'is-spinning');
    }
    const slot = document.getElementById('votes-panel');
    slot?.classList.remove('is-drawing');
    clearWinner(slot);
}

        /**
     * Affiche l'animation de la roue et exécute le coup qu'elle tire au sort
     * @param {Array} results - [{move, count, color, percentage}, ...]
     */
showWheelAnimation(results) {
    // 0 : pas d'animation, le coup tiré s'affiche aussitôt
    const wheelDuration = (Number.isFinite(Number(this.config.wheelDuration)) ? Number(this.config.wheelDuration) : 6) * 1000;

    this.updateVotesUI(results);

    // Aucune animation : pas de roue ni de bande, le coup tiré s'affiche (flèche 🎲) puis il est joué
    if (wheelDuration <= 0) {
        const winner = this.selectRandomWeighted(results);
        if (!winner) return;
        const random = results.length > 1 && results.every(r => r.count === 1);
        const pct = random ? null : (results.find(r => r.move === winner)?.percentage ?? null);
        this.previewWinner(winner, pct, () => this.executeMove(winner));
        return;
    }

    if (this.votingWheel) {
        // Synchroniser la roue
        this.votingWheel.clear();
        results.forEach((result) => {
            this.votingWheel.votes.set(result.move, {
                count: result.count,
                voters: new Map([['system', result.count]])
            });
        });
        this.votingWheel.draw();
        console.log('🎡 Roue synchronisée avec', results.length, 'coups');
        // clear() a vidé le podium : on le redessine pour que le fondu parte des vraies marches
        this.updateVotesUI(results);

        this.showWheel();
        document.getElementById('wheel-area')?.classList.add('is-spinning');
        console.log('🎡 Lancement de l\'animation de roue, durée:', wheelDuration, 'ms');
        document.body.classList.add('randomWheel');

        const random = document.body.classList.contains('randomWheel') && results.every(r => r.count === 1) && results.length > 1;
        this.votingWheel.onSpinEnd = (winner) => {
            console.log('🎯 Roue terminée, gagnant:', winner);
            const pct = random ? null : (results.find(r => r.move === winner)?.percentage ?? null);
            this.previewWinner(winner, pct, () => {
                document.body.classList.remove('randomWheel');
                this.executeMove(winner);
                this.hideWheel();
            });
        };

        // La roue tire elle-même le gagnant, chaque coup pèse son nombre de votes
        this.votingWheel.spin(wheelDuration);
        return;
    }

    // Fallback
    setTimeout(() => {
        document.body.classList.remove('randomWheel');
        this.executeMove(this.selectRandomWeighted(results));
    }, wheelDuration);
}



    selectRandomWeighted(results) {
        if (!results || results.length === 0) {
            return null;
        }

        // Calculer le total des votes
        const totalVotes = results.reduce((sum, r) => sum + (r.count || 1), 0);
        let random = Math.random() * totalVotes;

        for (const result of results) {
            random -= (result.count || 1);
            if (random <= 0) {
                return result.move;
            }
        }

        return results[0].move;
    }

    highlightLastMove(from, to) {
        const ann = this.annotations;
        if (ann) {
            ann.setLastMove(from, to);
            return;
        }
        // Retirer les anciens highlights
        document.querySelectorAll('.highlight-last-move')
            .forEach(el => el.classList.remove('highlight-last-move'));

        // Ajouter le highlight sur les cases from et to
        const fromSquare = document.querySelector(`[data-square="${from}"]`);
        const toSquare = document.querySelector(`[data-square="${to}"]`);

        if (fromSquare) fromSquare.classList.add('highlight-last-move');
        if (toSquare) toSquare.classList.add('highlight-last-move');
    }

    executeMove(moveStr, fromNetwork = false) {
        const move = this.chess.move(moveStr);

        if (move) {
            // Partie à inscrits : le coup clôt le tour, chrono du streamer compris
            if (this.session) { timer.stop(); this.streamerDraw = false; }
            // Stats viewers : qui a voté pour ce coup, et qui avait proposé le coup joué
            if (!fromNetwork) {
                const twitchVotes = voting.getAllVotes().filter(v => v.twitch);
                if (twitchVotes.length) {
                    window.ViewerStats?.recordTurn('game',
                        twitchVotes.map(v => ({ login: v.player, name: v.name, move: v.move })),
                        (m) => m === move.san);
                }
            }
            const fen = this.chess.fen();

            if (fromNetwork) {
                // Pas d'animation pour les coups réseau → highlight immédiat et fiable
                this.board.position(fen, false);
                this.highlightLastMove(move.from, move.to);
            } else {
                // Animation locale → re-appliquer le highlight après la fin de l'animation
                this.board.position(fen);
                // Double requestAnimationFrame : passe après le repaint de l'animation chessboard
                const from = move.from, to = move.to;
                requestAnimationFrame(() => requestAnimationFrame(() => this.highlightLastMove(from, to)));
            }

            if (this.pendingVote && this.pendingVote.move === moveStr) move.vote = this.pendingVote.v;
            this.pendingVote = null;
            this.moveHistory.push(move);
            // Succès « coups remarquables » : coups du chat / du streamer, pas ceux de Stockfish ni de l'adversaire Multi
            if (!fromNetwork && !this.engineMoving) {
                window.dispatchEvent(new CustomEvent('cg:move', { detail: { move, chess: this.chess } }));
            }
            this.playMoveSound(move);
            this.updateHistoryUI(move);
            this.syncPhantom();

            // Envoyer au serveur si mode multi et coup local
            if (!fromNetwork && window.multiplayerManager?.gameId) {
                window.multiplayerManager.sendMove(moveStr);
            }

            // Mettre à jour l'indicateur de tour multi
            if (window.multiplayerManager?.gameId) {
                window.multiplayerManager.updateTurnIndicator();
            }

            if (!this.checkGameEnd()) {
                this.currentTurn = this.chess.turn();
                this.startTurn();
            }
        } else {
            console.error('❌ Coup invalide:', moveStr);
        }
    }

    // ========== UI UPDATES ==========

    updateHistoryUI() {
        const historyEl = document.getElementById('history-list');
        if (!historyEl) return;
        const moves = (this.moveHistory || []).filter(m => m?.san).map(m => ({ san: m.san, v: m.vote ?? null }));
        renderHistory(historyEl, moves, this.moveHistory?.[0]?.color === 'b' ? 'b' : 'w');
    }

updateVotesUI(results) {
    const votesList = document.getElementById('vote-list') || document.querySelector('.vote-list');
    if (!votesList) return;
    // Roue de hasard (tous les coups à 1) : le podium garde les vrais votes
    if (document.body.classList.contains('randomWheel')) return;
    const votes = (results || []).map(r => ({ move: r.move, count: r.count || 0 }));
    const secret = secretVotes();
    renderPodium(votesList, document.getElementById('vote-total'), votes,
        { turn: this.chess?.turn(), colors: paletteColors(), secret });
    paintMoveChips(document.getElementById('moves-panel'), secret ? [] : votes, paletteColors());
}

/**
 * Retourne une couleur pour un index de vote (palette choisie dans les options du tirage)
 */
getVoteColor(index) {
    const colors = paletteColors();
    return colors[index % colors.length];
}

updateAvailableMoves() {
    const moves = this.chess.moves();
    const turn = this.chess.turn(); // 'w' ou 'b'

    // Icônes par couleur
    const pieceIcons = {
        w: { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' },
        b: { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' }
    };

    // Grouper les coups par pièce
    const groups = { P: [], N: [], B: [], R: [], Q: [], K: [], O: [] };

    moves.forEach(move => {
        const cleanMove = move.replace('#', '').replace('+', '');
        const firstChar = move.charAt(0);

        if (move.startsWith('O-') || move.startsWith('0-')) {
            groups.O.push(cleanMove);
        } else if (['K', 'Q', 'R', 'B', 'N'].includes(firstChar)) {
            groups[firstChar].push(cleanMove);
        } else {
            groups.P.push(cleanMove);
        }
    });

    // En mode multi, griser le panel si ce n'est pas notre tour
    const movesPanel = document.getElementById('moves-panel');
    const isLocked = !this.isMyTurnInMulti();
    if (movesPanel) {
        movesPanel.classList.toggle('is-locked', isLocked);
        movesPanel.title = isLocked ? 'Tour de l\'adversaire — attendez...' : '';
    }

    // Survol d'un coup : flèche d'aperçu (retirée quand la liste change)
    this.annotations?.setHover?.(null);
    const hoverOn = (move) => {
        if (movesPanel?.classList.contains('is-locked')) return;
        this.annotations?.setHover?.(this.resolveMove(move));
    };
    const hoverOff = () => this.annotations?.setHover?.(null);

    // Mettre à jour chaque liste avec l'icône de la bonne couleur
    ['P', 'N', 'B', 'R', 'Q', 'K', 'O'].forEach(piece => {
        const list = document.getElementById(`availableList${piece}`);
        if (!list) return;

        // Garder l'icône existante
        const icon = list.querySelector('.piece-icon');
        list.innerHTML = '';

        // Recréer l'icône avec la bonne couleur
        if (piece !== 'O') {
            const iconSpan = document.createElement('span');
            iconSpan.className = 'piece-icon';
            if (window.pieceIcon) iconSpan.innerHTML = window.pieceIcon(turn + piece);
            else iconSpan.textContent = pieceIcons[turn][piece];
            list.appendChild(iconSpan);
        } else if (icon) {
            list.appendChild(icon);
        }

        // Ajouter les coups
        if (groups[piece]) {
            groups[piece].forEach(move => {
                const li = document.createElement('li');
                const btn = document.createElement('button');
                btn.textContent = fmtMove(move);
                btn.dataset.move = move;
                btn.onclick = () => { hoverOff(); this.onMoveClick(move); };
                btn.onpointerenter = () => hoverOn(move);
                btn.onpointerleave = hoverOff;
                li.appendChild(btn);
                list.appendChild(li);
            });
        }
    });

    // Exemples à taper, pris parmi les coups légaux de la position
    const ex = document.getElementById('moves-example');
    if (ex) {
        // Coups « naturels » d'abord (e4, Nf3…), sinon un coup du milieu de la liste
        const pick = (list, prefs) => prefs.find(m => list.includes(m)) || list[Math.floor(list.length / 2)];
        const pieces = ['N', 'B', 'Q', 'R', 'K', 'O'].flatMap(p => groups[p]);
        const a = pick(groups.P, ['e4', 'd4', 'e5', 'd5', 'c4', 'c5']) || moves[0];
        const b = pick(pieces, ['Nf3', 'Nf6', 'Nc3', 'Nc6', 'O-O']);
        // Dans la notation du chat (Qxf8 -> Dxf8 en français)
        const code = m => `<code>${String(fmtMove(m)).replace(/[<>&]/g, '')}</code>`;
        ex.innerHTML = a ? `${window.i18n?.t('moves.example') || ''} ${code(a)}${b && b !== a ? ` ${window.i18n?.t('moves.or') || '/'} ${code(b)}` : ''}` : '';
    }
    paintMoveChips(movesPanel, (voting.getSortedResults?.() || []).map(r => ({ move: r.move, count: r.count || 0 })), paletteColors());
}

/**
 * Retourne true si, en mode multi, c'est le tour de cette instance.
 * Toujours true hors mode multi.
 */
isMyTurnInMulti() {
    if (!window.multiplayerManager?.gameId || !window.playerColor) return true;
    const turn = this.chess.turn(); // 'w' ou 'b'
    return (window.playerColor === 'white' && turn === 'w') ||
           (window.playerColor === 'black' && turn === 'b');
}

/** Le streamer : son login Twitch (connecté, sinon la chaîne), pour partager le quota de son vote dans le chat */
streamerVoter() {
    const login = String(window.twitchAuth?.user?.login || window.twitch?.channel || 'streamer').toLowerCase();
    return { username: login, displayName: window.twitchAuth?.user?.display_name || window.twitchAuth?.user?.displayName || login };
}

/** Coup cliqué ou posé pendant le vote : compte comme le vote du streamer (même limite que le chat) */
voteAsStreamer(move) {
    const me = this.streamerVoter();
    return voting.addVote(me.username, move, { twitch: true, name: me.displayName });
}

onMoveClick(move) {
    // Mode multi : bloquer complètement si ce n'est pas notre tour
    if (!this.isMyTurnInMulti()) {
        console.log('🚫 Multi : clic ignoré — pas votre tour');
        return;
    }

    // Mode problèmes (chessVoterApp) avec timer : passer par addMoveToPoll
    if (typeof gameMode !== 'undefined' && gameMode === 'probMode') {
        if (typeof timerMode !== 'undefined' && timerMode && typeof voteOpen !== 'undefined' && voteOpen) {
            if (typeof addMoveToPoll === 'function') {
                addMoveToPoll('local', move);
            }
        } else if (typeof voteOpen !== 'undefined' && voteOpen) {
            // Sans timer : jouer directement via chessVoterApp
            if (typeof executeMove === 'function') executeMove(move);
        }
        return;
    }

    // Mode problemsManager (gameEngine natif) avec timer
    if (window.problemsManager?.isActive) {
        if (this.config.timerEnabled) {
            // bouton : SAN international, pas la langue du chat ; vote du streamer, même quota que le chat
            window.problemsManager.receiveVote({ move, ...this.streamerVoter() }, 'en');
        } else {
            window.problemsManager.validateAndPlayMove(move);
        }
        return;
    }

    // Partie à joueurs inscrits : le clic ne vote pas, seul le streamer joue à son tour
    if (this.session) {
        if (this.canHumanPlay()) this.executeMove(move);
        return;
    }

    // Mode normal avec timer : voter
    if (this.config.timerEnabled) {
        if (voting.isOpen) this.voteAsStreamer(move);
        return;
    }

    // Sans timer : jouer directement (pas pendant le tour de Stockfish)
    if (this.engineToMove()) return;
    this.executeMove(move);
    this.updateAvailableMoves();
}

    // ========== VOTING INDICATOR ==========

    updateVotingIndicator() {
        const indicator = document.getElementById('voting-indicator');
        if (!indicator) return;

        // ... (garder le code existant si présent)
    }

    // ========== PANEL ==========

    createMovesPanel() {
        return;
    }

    // ========== TIMER MANUEL ==========

    startTimerManually() {
        console.log('⏱️ Démarrage manuel du timer');
        this.config.timerEnabled = true;
        voting.open();
        timer.start(this.config.timerDuration);

        const startBtn = document.getElementById('btn-start-timer');
        const stopBtn = document.getElementById('btn-stop-timer');
        if (startBtn) startBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'inline-flex';
    }

    stopTimerManually() {
        console.log('⏱️ Arrêt manuel du timer');
        timer.stop();
        voting.close();

        const startBtn = document.getElementById('btn-start-timer');
        const stopBtn = document.getElementById('btn-stop-timer');
        if (startBtn) startBtn.style.display = 'inline-flex';
        if (stopBtn) stopBtn.style.display = 'none';

        if (voting.getTotalVotes() > 0) {
            this.processVoteResult();
        }
    }

    // ========== START GAME ==========

    startGame() {
        console.log('🎮 Démarrage d\'une nouvelle partie...');

        this.chess.reset();
        this.board.position('start');
        this.moveHistory = [];
        this.currentTurn = 'w';
        this.isRunning = true;
        const ticker = document.getElementById('vote-ticker');
        if (ticker) ticker.hidden = false;

        this.updateAvailableMoves();
        this.startTurn();

        console.log('✅ Partie démarrée');
    }
}

// Votes du chat : bandeau sous l'échiquier (ancien panneau « Chat votes »)
window.VoteLog = {
    add(username, move) { VoteTicker.add(username, move); },
    clear() { VoteTicker.clear(); }
};

// Instance singleton
const gameEngine = new GameEngine();

// Export
export { GameEngine, gameEngine };
export default gameEngine;
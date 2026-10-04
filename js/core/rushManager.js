/**
 * PHANTOM TWITCHESS - Puzzle Rush
 *
 * Session "rush" construite au-dessus de problemsManager :
 *  - le chat enchaîne des puzzles de difficulté croissante
 *  - 3 erreurs (mauvais coup OU aucun vote dans le temps) → fin du run
 *  - le score (puzzles résolus) est envoyé au serveur si l'utilisateur est
 *    connecté à Twitch ; le record de la chaîne s'affiche dans Parcourir
 *
 * problemsManager garde la main sur l'échiquier et la validation des coups ;
 * RushManager choisit le puzzle suivant (nextProblemProvider) et compte.
 */

import problemsManager from './problemManager.js';
import twitchAuth from './twitchAuth.js';

const API_RECORDS = '/api/rush/records';

class RushManager {
    constructor() {
        this.active   = false;
        this.ended    = false;

        this.config = {
            startRating: 600,    // rating du 1er puzzle
            ratingStep:  60,     // +rating par puzzle résolu
            ratingSpread: 120,   // tolérance autour du rating cible
            maxStrikes:  3
        };

        this.score      = 0;
        this.strikes    = 0;
        this.maxRating  = 0;
        this.startedAt  = null;
        this.endedAt    = null;
        this.used       = new Set();
        this.lastLoadAt = 0;

        this.channelRecord = null;  // record connu de la chaîne (depuis le serveur)
        this.lastResult    = null;  // { score, maxRating, durationMs, isNewRecord, saved, error }

        // Callbacks UI
        this.onUpdate = null;  // (state) à chaque changement de score/vies
        this.onEnd    = null;  // (result) à la fin du run

        // Callbacks problemsManager d'origine (rendus à la fin)
        this._origCallbacks = null;
    }

    // ========== ÉTAT ==========

    get targetRating() {
        return this.config.startRating + this.score * this.config.ratingStep;
    }

    get livesLeft() {
        return Math.max(0, this.config.maxStrikes - this.strikes);
    }

    getState() {
        return {
            active:       this.active,
            ended:        this.ended,
            score:        this.score,
            strikes:      this.strikes,
            livesLeft:    this.livesLeft,
            maxStrikes:   this.config.maxStrikes,
            targetRating: this.targetRating,
            maxRating:    this.maxRating,
            startedAt:    this.startedAt,
            record:       this.channelRecord
        };
    }

    // ========== RUN ==========

    /**
     * Démarre un run. problemsManager doit être initialisé (chess/board, CSV chargé).
     */
    start(config = {}) {
        Object.assign(this.config, config);

        this.active    = true;
        this.ended     = false;
        this.score     = 0;
        this.strikes   = 0;
        this.maxRating = 0;
        this.startedAt = Date.now();
        this.endedAt   = null;
        this.used.clear();
        this.lastResult = null;

        this._hook();
        this._emitUpdate();

        problemsManager.loadRandomProblem();
        console.log('🔥 Puzzle Rush démarré, rating de départ', this.config.startRating);
    }

    /** Arrête le run sans enregistrer (changement de mode, reset) */
    stop() {
        if (!this.active && !this.ended) return;
        this.active = false;
        this.ended  = false;
        this._unhook();
        problemsManager.reset();
        this._emitUpdate();
    }

    // ========== BRANCHEMENT SUR problemsManager ==========

    _hook() {
        if (this._origCallbacks) return;

        this._origCallbacks = {
            onProblemSolved: problemsManager.onProblemSolved,
            onProblemFailed: problemsManager.onProblemFailed,
            onNoVote:        problemsManager.onNoVote,
            provider:        problemsManager.nextProblemProvider
        };

        problemsManager.nextProblemProvider = () => this._nextProblem();

        problemsManager.onProblemSolved = (problem) => {
            this._origCallbacks.onProblemSolved?.(problem);
            if (!this.active) return;
            this.score++;
            this.maxRating = Math.max(this.maxRating, problem.rating || 0);
            this._emitUpdate();
        };

        problemsManager.onProblemFailed = (problem) => {
            this._origCallbacks.onProblemFailed?.(problem);
            if (!this.active) return;
            this._strike();
        };

        // Timer écoulé sans aucun vote : compte comme une erreur
        problemsManager.onNoVote = () => {
            if (!this.active) {
                this._origCallbacks.onNoVote?.();
                return;
            }
            console.log('🔥 Aucun vote dans le temps → erreur');
            window.AppToast?.warning('⏱️ Aucun vote dans le temps : erreur !');
            problemsManager.failCurrentProblem('Aucun vote dans le temps');
        };
    }

    _unhook() {
        if (!this._origCallbacks) return;
        problemsManager.onProblemSolved     = this._origCallbacks.onProblemSolved;
        problemsManager.onProblemFailed     = this._origCallbacks.onProblemFailed;
        problemsManager.onNoVote            = this._origCallbacks.onNoVote;
        problemsManager.nextProblemProvider = this._origCallbacks.provider;
        this._origCallbacks = null;
    }

    _strike() {
        this.strikes++;
        this._emitUpdate();
        if (this.strikes >= this.config.maxStrikes) {
            this._finish();
        }
    }

    // ========== CHOIX DU PUZZLE ==========

    /**
     * Appelé par problemsManager.loadRandomProblem(). Retourne le puzzle à
     * charger, ou null si le run est terminé.
     */
    _nextProblem() {
        if (!this.active) return null;

        // Deux appels quasi simultanés (timer de pause + skip) → un seul puzzle
        const now = Date.now();
        if (now - this.lastLoadAt < 1000) return false;
        this.lastLoadAt = now;

        const problem = this._pickNearRating(this.targetRating);
        if (!problem) {
            console.warn('🔥 Plus de puzzle disponible');
            this._finish();
            return null;
        }
        this.used.add(problem[0]);
        return problem;
    }

    _pickNearRating(target) {
        const all = problemsManager.problems;
        if (!all.length) return null;

        let spread = this.config.ratingSpread;
        for (let i = 0; i < 6; i++) {
            const candidates = all.filter(p => {
                const r = parseInt(p[3]) || 0;
                return Math.abs(r - target) <= spread && !this.used.has(p[0]);
            });
            if (candidates.length >= 5) {
                return candidates[Math.floor(Math.random() * candidates.length)];
            }
            spread *= 2;
        }

        // Au-delà du rating max du CSV : prendre les plus durs restants
        const remaining = all.filter(p => !this.used.has(p[0]));
        if (!remaining.length) return null;
        remaining.sort((a, b) => (parseInt(b[3]) || 0) - (parseInt(a[3]) || 0));
        const top = remaining.slice(0, 50);
        return top[Math.floor(Math.random() * top.length)];
    }

    // ========== FIN DE RUN ==========

    async _finish() {
        if (!this.active) return;
        this.active  = false;
        this.ended   = true;
        this.endedAt = Date.now();

        // startPauseTimer() est appelé juste après le callback d'échec :
        // on coupe le compte à rebours "Raté! 5s" au tick suivant.
        setTimeout(() => {
            problemsManager.cancelPauseTimer();
            problemsManager.hideTimerMessage();
        }, 0);

        const result = {
            score:      this.score,
            maxRating:  this.maxRating,
            durationMs: this.endedAt - this.startedAt,
            isNewRecord: false,
            saved:      false,
            error:      null,
            record:     this.channelRecord
        };

        const previousBest = this.channelRecord?.best?.score ?? -1;
        result.isNewRecord = this.score > previousBest;

        console.log(`🔥 Run terminé : ${this.score} puzzle(s), rating max ${this.maxRating}`);
        this._emitUpdate();

        if (twitchAuth.isLoggedIn && this.score > 0) {
            try {
                const saved = await this.submitScore(result);
                result.saved  = true;
                result.record = saved.record;
                result.isNewRecord = saved.isNewRecord;
                this.channelRecord = saved.record;
            } catch (e) {
                result.error = e.message;
                console.warn('🔥 Enregistrement du score impossible:', e.message);
            }
        }

        this.lastResult = result;
        if (this.onEnd) this.onEnd(result);
    }

    // ========== SERVEUR ==========

    async submitScore(result) {
        const user = twitchAuth.user;
        const r = await fetch(API_RECORDS, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...twitchAuth.authHeaders()
            },
            body: JSON.stringify({
                score:       result.score,
                maxRating:   result.maxRating,
                durationMs:  result.durationMs,
                displayName: user?.displayName,
                avatar:      user?.avatar
            })
        });
        if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${r.status}`);
        }
        return r.json();
    }

    /** Récupère le record de la chaîne connectée (pour le HUD) */
    async fetchChannelRecord() {
        const login = twitchAuth.user?.login;
        if (!login) { this.channelRecord = null; return null; }
        try {
            const r = await fetch(`${API_RECORDS}/${encodeURIComponent(login)}`);
            if (r.status === 404) { this.channelRecord = null; return null; }
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            this.channelRecord = await r.json();
        } catch (e) {
            console.warn('🔥 Record indisponible:', e.message);
        }
        this._emitUpdate();
        return this.channelRecord;
    }

    static async fetchLeaderboard(limit = 50) {
        const r = await fetch(`${API_RECORDS}?limit=${limit}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        return data.records || [];
    }

    // ========== UTILS ==========

    _emitUpdate() {
        if (this.onUpdate) this.onUpdate(this.getState());
    }
}

// ========== INSTANCE GLOBALE ==========
window.rushManager = new RushManager();

export { RushManager };
export default window.rushManager;

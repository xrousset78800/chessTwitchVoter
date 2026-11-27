/**
 * PHANTOM TWITCHESS - Puzzles en solo (page Jouer › Seul)
 *
 * Série sans fin au-dessus de problemsManager, sans minuteur ni vote : on joue à la souris.
 *  - difficulté adaptative : un « niveau » qui monte quand on résout, baisse quand on rate
 *    (gardé dans le navigateur d'une séance à l'autre) ;
 *  - série en cours, meilleure série, taux de réussite de la séance ;
 *  - thèmes facultatifs (filtres de problemsManager) ;
 *  - connecté avec Twitch : chaque puzzle résolu rapporte des pions (/api/economy/solo-puzzle,
 *    dans le plafond du jour).
 *
 * Comme RushManager, il prend la main sur nextProblemProvider et les callbacks de problemsManager
 * le temps de la séance, puis les rend.
 */

import problemsManager from './problemManager.js';
import twitchAuth from './twitchAuth.js';

const KEY = 'solo_puzzles';
const START_RATING = 800;
const UP = 40, DOWN = 50, MIN = 400, MAX = 3000, SPREAD = 100;

class SoloPuzzles {
    constructor() {
        this.active = false;
        this.rating = START_RATING;
        this.bestStreak = 0;
        this.sessionBest = 0;
        this.streak = 0;
        this.solved = 0;
        this.failed = 0;
        this.last = null;          // { ok, san } : résultat du dernier puzzle (affiché dans le bandeau)
        this.used = new Set();
        this.lastLoadAt = 0;
        this._orig = null;
        this.onUpdate = null;      // (state) à chaque changement
        this._load();
    }

    _load() {
        try {
            const s = JSON.parse(localStorage.getItem(KEY) || '{}');
            if (Number.isFinite(s.rating)) this.rating = Math.min(MAX, Math.max(MIN, s.rating));
            if (Number.isFinite(s.best)) this.bestStreak = s.best;
        } catch { }
    }

    _save() {
        try { localStorage.setItem(KEY, JSON.stringify({ rating: this.rating, best: this.bestStreak })); } catch { }
    }

    /** Fourchette des puzzles proposés autour du niveau (celle que _next() essaie d'abord) */
    range() {
        const lo = Math.max(MIN, this.rating - SPREAD), hi = Math.min(MAX, this.rating + SPREAD);
        return `${lo}–${hi}`;
    }

    getState() {
        const total = this.solved + this.failed;
        return {
            active: this.active, rating: this.rating, streak: this.streak, bestStreak: this.bestStreak,
            solved: this.solved, failed: this.failed, rate: total ? Math.round(this.solved / total * 100) : null,
            last: this.last, range: this.range()
        };
    }

    start() {
        this._load();
        this.active = true;
        this.streak = 0;
        this.sessionBest = 0;
        this.solved = 0;
        this.failed = 0;
        this.last = null;
        this.used.clear();
        this.lastLoadAt = 0;
        this._hook();
        this._emit();
        problemsManager.loadRandomProblem();
    }

    stop() {
        if (!this.active) return;
        this.active = false;
        this._unhook();
        this._emit();
    }

    _hook() {
        if (this._orig) return;
        const pm = problemsManager;
        this._orig = { solved: pm.onProblemSolved, failed: pm.onProblemFailed, wrong: pm.onWrongMove, provider: pm.nextProblemProvider };
        pm.nextProblemProvider = () => this._next();
        pm.onProblemSolved = (p) => {
            this._orig.solved?.(p);
            if (!this.active) return;
            this.solved++;
            this.streak++;
            this.bestStreak = Math.max(this.bestStreak, this.streak);
            this.sessionBest = Math.max(this.sessionBest, this.streak);
            this.rating = Math.min(MAX, this.rating + UP);
            this.last = { ok: true };
            this._save();
            this._emit();
            this._earn();
        };
        pm.onWrongMove = (san, uci) => {
            this._orig.wrong?.(san, uci);
            if (this.active) this.last = { ok: false, san };
        };
        pm.onProblemFailed = (p) => {
            this._orig.failed?.(p);
            if (!this.active) return;
            this.failed++;
            this.streak = 0;
            this.rating = Math.max(MIN, this.rating - DOWN);
            if (!this.last || this.last.ok) this.last = { ok: false };
            this._save();
            this._emit();
        };
    }

    _unhook() {
        if (!this._orig) return;
        const pm = problemsManager;
        pm.onProblemSolved = this._orig.solved;
        pm.onProblemFailed = this._orig.failed;
        pm.onWrongMove = this._orig.wrong;
        pm.nextProblemProvider = this._orig.provider;
        this._orig = null;
    }

    /** Prochain puzzle : proche du niveau, dans les thèmes choisis, jamais deux fois dans la séance */
    _next() {
        if (!this.active) return null;
        const now = Date.now();
        if (now - this.lastLoadAt < 800) return false;
        this.lastLoadAt = now;
        this.last = null;
        this._emit();
        const pool = problemsManager.getFilteredProblems();
        if (!pool.length) return null;
        let spread = SPREAD;
        for (let i = 0; i < 6; i++) {
            const c = pool.filter(p => Math.abs((parseInt(p[3]) || 0) - this.rating) <= spread && !this.used.has(p[0]));
            if (c.length >= 5 || (i === 5 && c.length)) return this._take(c[Math.floor(Math.random() * c.length)]);
            spread *= 2;
        }
        const rest = pool.filter(p => !this.used.has(p[0]));
        if (!rest.length) { this.used.clear(); return this._take(pool[Math.floor(Math.random() * pool.length)]); }
        return this._take(rest[Math.floor(Math.random() * rest.length)]);
    }

    _take(p) {
        this.used.add(p[0]);
        return p;
    }

    async _earn() {
        if (!twitchAuth.isLoggedIn) return;
        try {
            const r = await fetch('/api/economy/solo-puzzle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...twitchAuth.authHeaders() },
                body: '{}'
            });
            if (!r.ok) return;
            const data = await r.json();
            window.economy?.noteGain(data.gain, 'puzzle');
        } catch { }
    }

    _emit() {
        this.onUpdate?.(this.getState());
    }
}

window.soloPuzzles = new SoloPuzzles();
export default window.soloPuzzles;

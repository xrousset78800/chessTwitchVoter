import { fillVoteTimer } from '../components/voteTimer.js';

/**
 * TIMER MODULE
 * Gestion du countdown pour les tours de jeu
 */

class Timer {
    constructor() {
        this.duration = 25;          // Durée initiale en secondes
        this.remaining = 0;          // Temps restant
        this.intervalId = null;      // ID de l'interval
        this.isRunning = false;
        this.isPaused = false;       // Nouveau: état de pause

        // Callbacks
        this.onTick = null;          // Appelé chaque seconde
        this.onComplete = null;      // Appelé quand le timer atteint 0
        this.onPause = null;         // Appelé quand le timer est mis en pause
        this.onResume = null;        // Appelé quand le timer reprend

        // Éléments DOM
        this.countdownEl = null;
        this.timerValueEl = null;
    }

    /**
     * Initialise le timer avec les éléments DOM
     */
    init(options = {}) {
        this.duration = options.duration || 25;
        this.countdownEl = document.getElementById('countdown');
        this.timerValueEl = document.getElementById('timer-value');

        if (options.onTick) this.onTick = options.onTick;
        if (options.onComplete) this.onComplete = options.onComplete;
        if (options.onPause) this.onPause = options.onPause;
        if (options.onResume) this.onResume = options.onResume;

        console.log('⏱️ Timer initialisé:', this.duration, 'secondes');
        return this;
    }

    /**
     * Démarre le timer
     */
    start(duration = null) {
        // Nettoyer l'ancien timer si existant
        this.stop();

        if (duration !== null) {
            this.duration = duration;
        }

        this.remaining = this.duration;
        this.isRunning = true;
        this.isPaused = false;

        // Mettre à jour l'affichage initial
        this.updateDisplay();

        // Afficher le timer
        document.body.classList.add('showTimer');
        document.body.classList.toggle('wheel-soon', this.remaining <= 1);

        // Configurer les variables CSS pour l'animation
        if (this.countdownEl) {
            this.countdownEl.style.setProperty('--q', this.duration);
            this.countdownEl.style.setProperty('--t', this.duration);
        }

        // Démarrer l'interval
        this.intervalId = setInterval(() => this.tick(), 1000);
        if (window.AppState) (AppState._timerIds = AppState._timerIds || []).push(this.intervalId);

        console.log('▶️ Timer démarré:', this.duration, 'secondes');
    }

    /**
     * Appelé chaque seconde
     */
    tick() {
        // Ne pas décrémenter si en pause
        if (this.isPaused) return;

        this.remaining--;

        // Mettre à jour l'affichage
        this.updateDisplay();

        // Roue : elle n'apparaît que dans la dernière seconde du vote
        document.body.classList.toggle('wheel-soon', this.remaining <= 1);

        // Callback onTick
        if (this.onTick) {
            this.onTick(this.remaining);
        }

        // Timer terminé
        if (this.remaining <= 0) {
            this.complete();
        }
    }

    /**
     * Timer terminé
     */
    complete() {
        this.stop();

        console.log('⏱️ Timer terminé!');

        // Callback onComplete
        if (this.onComplete) {
            this.onComplete();
        }
    }

    /**
     * Arrête le timer
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            if (window.AppState) AppState._timerIds = AppState._timerIds?.filter(id => id !== this.intervalId) ?? []; // ← AJOUTER
            this.intervalId = null;
        }

        this.isRunning = false;
        this.isPaused = false;
        document.body.classList.remove('showTimer', 'wheel-soon');

        // Retirer la classe urgence et pause
        if (this.countdownEl) {
            this.countdownEl.classList.remove('timer-critical');
            this.countdownEl.classList.remove('timer-paused');
        }
    }

    /**
     * Met en pause le timer
     */
    pause() {
        if (!this.isRunning || this.isPaused) return;

        this.isPaused = true;

        // Ajouter une indication visuelle de pause
        if (this.countdownEl) {
            this.countdownEl.classList.add('timer-paused');
        }

        // Callback
        if (this.onPause) {
            this.onPause(this.remaining);
        }

        console.log('⏸️ Timer en pause:', this.remaining, 'secondes restantes');
    }

    /**
     * Reprend le timer
     */
    resume() {
        if (!this.isRunning || !this.isPaused) return;

        this.isPaused = false;

        // Retirer l'indication visuelle de pause
        if (this.countdownEl) {
            this.countdownEl.classList.remove('timer-paused');
        }

        // Callback
        if (this.onResume) {
            this.onResume(this.remaining);
        }

        console.log('▶️ Timer repris:', this.remaining, 'secondes restantes');
    }

    /**
     * Met à jour l'affichage du timer
     */
    updateDisplay() {
        const seconds = this.remaining;
        window.setRingTimer?.(seconds, this.isPaused, this.duration);

        // Affichage textuel (MM:SS)
        if (this.timerValueEl) {
            const minutes = Math.floor(seconds / 60);
            const secs = seconds % 60;
            this.timerValueEl.textContent = `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

            // Ajouter indicateur de pause
            if (this.isPaused) {
                this.timerValueEl.textContent += ' ⏸';
            }
        }

        // Affichage circulaire (variables CSS)
        if (this.countdownEl) {
            this.countdownEl.style.setProperty('--t', seconds);
            this.countdownEl.style.setProperty('--s', seconds);

            // Animation urgence pour les dernières secondes (sauf si en pause)
            if (seconds <= 5 && !this.isPaused) {
                this.countdownEl.classList.add('timer-critical');
            } else {
                this.countdownEl.classList.remove('timer-critical');
            }
        }
    }

    /**
     * Change la durée du timer (pour le prochain start)
     */
    setDuration(duration) {
        this.duration = duration;
    }

    /**
     * Retourne le temps restant
     */
    getRemaining() {
        return this.remaining;
    }

    /**
     * Retourne si le timer est en pause
     */
    getIsPaused() {
        return this.isPaused;
    }
}

// Instance singleton
const timer = new Timer();
window.timer = timer;

(function() {
    'use strict';

    // Attendre que le DOM soit prêt
    document.addEventListener('DOMContentLoaded', function() {
        initBoardTimer();
    });

    function initBoardTimer() {
        // Trouver le conteneur de l'échiquier
        const boardWrapper = document.querySelector('.board-wrapper') ||
                            document.getElementById('board_wrapper');

        if (!boardWrapper) {
            console.warn('⚠️ Board wrapper non trouvé, réessai dans 500ms');
            setTimeout(initBoardTimer, 500);
            return;
        }

        // Vérifier si le timer n'existe pas déjà
        if (document.querySelector('.vote-timer--board')) {
            console.log('✅ Timer container déjà présent');
            return;
        }

        // Barre du minuteur, en tête du bloc de vote (à défaut sous l'échiquier)
        const timerContainer = document.createElement('div');
        timerContainer.className = 'vote-timer vote-timer--board';
        timerContainer.innerHTML = `
            <div class="vote-timer__row" id="countdown"><div class="vote-timer__bar"><div class="vote-timer__fill"></div></div><span class="vote-timer__num" id="countdown-num"></span><span class="vote-timer__label" id="countdown-label"></span></div>
            <div id="timer-value">--:--</div>
            <button class="timer-pause-btn" id="timer-pause-btn" style="display: none;">
                <i class="fas fa-pause"></i>
                <span>Pause</span>
            </button>
            <div class="timer-instant" role="note">
                <span class="timer-instant__title">⚡ <span data-i18n="timerOff.badge">${window.i18n?.t('timerOff.badge') || 'Vote instantané'}</span></span>
                <span class="timer-instant__hint" data-i18n="timerOff.badgeHint">${window.i18n?.t('timerOff.badgeHint') || 'Le premier vote est joué'}</span>
            </div>
        `;

        const votes = document.getElementById('votes-panel');
        if (votes) votes.before(timerContainer);
        else boardWrapper.after(timerContainer);

        // Initialiser le bouton pause/reprise
        initPauseButton();
    }

    function initPauseButton() {
        const pauseBtn = document.getElementById('timer-pause-btn');
        if (!pauseBtn) return;

        pauseBtn.addEventListener('click', function() {
            // Accéder au timer global si disponible
            if (typeof timer !== 'undefined') {
                if (timer.isPaused) {
                    timer.resume();
                    updatePauseButton(false);
                } else {
                    timer.pause();
                    updatePauseButton(true);
                }
            } else {
                console.warn('⚠️ Timer global non disponible');
            }
        });

        // Écouter les changements d'état du timer
        document.addEventListener('timerStateChanged', function(e) {
            if (e.detail && e.detail.isRunning) {
                pauseBtn.style.display = 'flex';
                updatePauseButton(e.detail.isPaused);
            } else {
                pauseBtn.style.display = 'none';
            }
        });
    }

    function updatePauseButton(isPaused) {
        const pauseBtn = document.getElementById('timer-pause-btn');
        if (!pauseBtn) return;

        const icon = pauseBtn.querySelector('i');
        const text = pauseBtn.querySelector('span');

        if (isPaused) {
            icon.className = 'fas fa-play';
            text.textContent = 'Reprendre';
            pauseBtn.style.background = 'rgba(255, 152, 0, 0.2)';
            pauseBtn.style.borderColor = 'rgba(255, 152, 0, 0.4)';
        } else {
            icon.className = 'fas fa-pause';
            text.textContent = 'Pause';
            pauseBtn.style.background = 'rgba(255, 255, 255, 0.1)';
            pauseBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        }
    }

    /** Secondes à côté de la barre ; « votez ! » sous 5 s. La barre vise la seconde suivante */
    window.setRingTimer = function(seconds, paused, total) {
        const num = document.getElementById('countdown-num');
        const label = document.getElementById('countdown-label');
        if (!num || !label) return;
        const s = Math.max(0, Math.round(Number(seconds) || 0));
        num.textContent = s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(s);
        const tr = (k, f) => { const v = window.i18n?.t(k); return v && v !== k ? v : f; };
        label.textContent = paused ? tr('timerRing.paused', 'pause')
            : s <= 5 ? tr('timerRing.hurry', 'votez !') : tr('timerRing.seconds', 'secondes');
        const q = Math.max(1, Number(total) || 0);
        if (total) fillVoteTimer(num.closest('.vote-timer'), 1 - (paused ? s : Math.max(0, s - 1)) / q, paused ? 0 : 1);
    };

    // Exposer une fonction pour mettre à jour l'affichage du timer
    window.updateBoardTimerDisplay = function(seconds) {
        const timerValue = document.getElementById('timer-value');
        const countdown = document.getElementById('countdown');

        if (!timerValue || !countdown) return;

        // Formater l'affichage MM:SS
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        timerValue.textContent = `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        window.setRingTimer?.(seconds, false);

        // Mettre à jour les variables CSS pour le cercle
        countdown.style.setProperty('--t', seconds);
        countdown.style.setProperty('--s', seconds);

        // Ajouter la classe urgence pour les dernières secondes
        if (seconds <= 5) {
            countdown.classList.add('timer-critical');
        } else {
            countdown.classList.remove('timer-critical');
        }
    };

})();
// Export
export { Timer, timer };
export default timer;
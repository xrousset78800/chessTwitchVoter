/**
 * VOTING.JS - Système de vote pour les coups
 */

export class VotingSystem {
    constructor(app) {
        this.app = app;
        this.votes = new Map(); // Map<move, Set<voter>>
        this.voters = new Map(); // Map<voter, move>
        this.totalVotes = 0;
        this.votingActive = false;
        this.votingStartTime = null;
        this.votingDuration = 30000; // 30 secondes par défaut
        this.votingTimer = null;
        this.possibleMoves = [];
        this.moveColors = {};
    }

    /**
     * Initialise le système de vote
     */
    async initialize() {
        this.votingDuration = (this.app.config.get('votingTime') || 30) * 1000;
        this.setupUI();
        this.attachEvents();
    }

    /**
     * Configure l'interface de vote
     */
    setupUI() {
        // Créer le conteneur de votes si nécessaire
        if (!document.getElementById('votingContainer')) {
            const container = document.createElement('div');
            container.id = 'votingContainer';
            container.className = 'voting-container';
            container.innerHTML = `
                <div class="voting-header">
                    <h3 class="voting-title">Votes</h3>
                    <div class="voting-timer" id="votingTimer"></div>
                </div>
                <div class="voting-options" id="votingOptions"></div>
                <div class="voting-stats" id="votingStats">
                    <span>Total: <span id="totalVotes">0</span> votes</span>
                </div>
            `;
            
            const sidebar = document.querySelector('.game-sidebar');
            if (sidebar) {
                sidebar.appendChild(container);
            }
        }
    }

    /**
     * Attache les événements
     */
    attachEvents() {
        // Écouter les messages custom pour les votes
        window.addEventListener('twitchess:vote', (e) => {
            this.addVote(e.detail.voter, e.detail.move);
        });
    }

    /**
     * Démarre un nouveau vote
     */
    startVoting() {
        if (this.votingActive) return;
        
        this.votingActive = true;
        this.votingStartTime = Date.now();
        this.votes.clear();
        this.voters.clear();
        this.totalVotes = 0;
        
        // Obtenir les coups possibles
        this.possibleMoves = this.app.modules.chess.engine.movesVerbose();
        this.assignMoveColors();
        
        // Afficher les options
        this.displayVotingOptions();
        
        // Démarrer le timer
        this.startVotingTimer();
        
        console.log('Vote démarré avec', this.possibleMoves.length, 'options');
    }

    /**
     * Assigne des couleurs aux coups
     */
    assignMoveColors() {
        const colors = [
            '#ff6b6b', '#4ecdc4', '#45b7d1', '#f7dc6f',
            '#b19cd9', '#ff9ff3', '#54a0ff', '#48dbfb',
            '#fd79a8', '#a29bfe', '#6c5ce7', '#ffeaa7'
        ];
        
        this.moveColors = {};
        this.possibleMoves.forEach((move, index) => {
            const notation = move.san || `${move.from}${move.to}`;
            this.moveColors[notation] = colors[index % colors.length];
        });
    }

    /**
     * Affiche les options de vote
     */
    displayVotingOptions() {
        const container = document.getElementById('votingOptions');
        if (!container) return;
        
        container.innerHTML = '';
        
        this.possibleMoves.forEach((move, index) => {
            const notation = move.san || `${move.from}${move.to}`;
            const voteCount = this.votes.get(notation)?.size || 0;
            const percentage = this.totalVotes > 0 ? (voteCount / this.totalVotes * 100) : 0;
            
            const option = document.createElement('div');
            option.className = 'vote-option';
            option.dataset.move = notation;
            option.innerHTML = `
                <div class="vote-progress" style="width: ${percentage}%; background: ${this.moveColors[notation]}"></div>
                <div class="vote-option-content">
                    <span class="vote-move">
                        <span class="vote-move-number">${index + 1}.</span>
                        ${notation}
                    </span>
                    <span class="vote-count">${voteCount}</span>
                </div>
            `;
            
            // Clic pour voter (mode test)
            if (this.app.config.get('debugMode')) {
                option.addEventListener('click', () => {
                    this.addVote('debug_user', notation);
                });
            }
            
            container.appendChild(option);
        });
        
        this.updateVoteDisplay();
    }

    /**
     * Ajoute un vote
     */
    addVote(voter, move) {
        if (!this.votingActive) return false;
        
        // Vérifier si le coup est valide
        const isValid = this.possibleMoves.some(m => 
            m.san === move || `${m.from}${m.to}` === move
        );
        
        if (!isValid) {
            console.log('Vote invalide:', move);
            return false;
        }
        
        // Retirer l'ancien vote si existant
        const previousVote = this.voters.get(voter);
        if (previousVote) {
            const votes = this.votes.get(previousVote);
            if (votes) {
                votes.delete(voter);
                if (votes.size === 0) {
                    this.votes.delete(previousVote);
                }
            }
            this.totalVotes--;
        }
        
        // Ajouter le nouveau vote
        if (!this.votes.has(move)) {
            this.votes.set(move, new Set());
        }
        this.votes.get(move).add(voter);
        this.voters.set(voter, move);
        this.totalVotes++;
        
        // Mettre à jour l'affichage
        this.updateVoteDisplay();
        
        // Émettre l'événement
        this.app.emit('voteReceived', { voter, move, total: this.totalVotes });
        
        return true;
    }

    /**
     * Parse un vote depuis un message
     */
    parseVote(message) {
        // Formats acceptés: "e4", "1", "!vote e4", "!v 1"
        const trimmed = message.trim().toLowerCase();
        
        // Commande !vote
        if (trimmed.startsWith('!vote ') || trimmed.startsWith('!v ')) {
            const parts = trimmed.split(' ');
            return parts[1];
        }
        
        // Numéro de coup
        if (/^\d+$/.test(trimmed)) {
            const index = parseInt(trimmed) - 1;
            if (index >= 0 && index < this.possibleMoves.length) {
                return this.possibleMoves[index].san;
            }
        }
        
        // Notation directe
        if (/^[a-h][1-8][a-h][1-8]/.test(trimmed) || /^[NBRQK]?[a-h]?[1-8]?x?[a-h][1-8]/.test(trimmed)) {
            return trimmed;
        }
        
        return null;
    }

    /**
     * Met à jour l'affichage des votes
     */
    updateVoteDisplay() {
        // Mettre à jour chaque option
        this.possibleMoves.forEach((move) => {
            const notation = move.san || `${move.from}${move.to}`;
            const voteCount = this.votes.get(notation)?.size || 0;
            const percentage = this.totalVotes > 0 ? (voteCount / this.totalVotes * 100) : 0;
            
            const option = document.querySelector(`.vote-option[data-move="${notation}"]`);
            if (option) {
                const progress = option.querySelector('.vote-progress');
                const count = option.querySelector('.vote-count');
                
                if (progress) progress.style.width = `${percentage}%`;
                if (count) count.textContent = voteCount;
                
                // Marquer le plus voté
                if (voteCount > 0 && voteCount === this.getMaxVotes()) {
                    option.classList.add('most-voted');
                } else {
                    option.classList.remove('most-voted');
                }
            }
        });
        
        // Mettre à jour le total
        const totalElement = document.getElementById('totalVotes');
        if (totalElement) {
            totalElement.textContent = this.totalVotes;
        }
        
        // Mettre à jour le graphique si présent
        this.updateChart();
    }

    /**
     * Démarre le timer de vote
     */
    startVotingTimer() {
        const timerElement = document.getElementById('votingTimer');
        if (!timerElement) return;
        
        if (this.votingTimer) {
            clearInterval(this.votingTimer);
        }
        
        const endTime = this.votingStartTime + this.votingDuration;
        
        this.votingTimer = setInterval(() => {
            const now = Date.now();
            const remaining = Math.max(0, endTime - now);
            
            if (remaining === 0) {
                this.endVoting();
            } else {
                const seconds = Math.ceil(remaining / 1000);
                timerElement.textContent = `${seconds}s`;
                
                // Urgence dans les dernières secondes
                if (seconds <= 5) {
                    timerElement.classList.add('urgent');
                }
            }
        }, 100);
    }

    /**
     * Termine le vote
     */
    endVoting() {
        if (!this.votingActive) return;
        
        this.votingActive = false;
        
        if (this.votingTimer) {
            clearInterval(this.votingTimer);
            this.votingTimer = null;
        }
        
        // Obtenir le coup gagnant
        const bestMove = this.getBestMove();
        
        console.log('Vote terminé. Coup gagnant:', bestMove);
        
        // Émettre l'événement
        this.app.emit('voteEnded', {
            winner: bestMove,
            votes: Array.from(this.votes.entries()),
            totalVotes: this.totalVotes
        });
        
        return bestMove;
    }

    /**
     * Obtient le coup le plus voté
     */
    getBestMove() {
        let bestMove = null;
        let maxVotes = 0;
        
        for (const [move, voters] of this.votes.entries()) {
            if (voters.size > maxVotes) {
                maxVotes = voters.size;
                bestMove = move;
            }
        }
        
        // Si aucun vote, retourner un coup aléatoire
        if (!bestMove && this.possibleMoves.length > 0) {
            const randomIndex = Math.floor(Math.random() * this.possibleMoves.length);
            bestMove = this.possibleMoves[randomIndex].san;
        }
        
        return bestMove;
    }

    /**
     * Obtient le nombre max de votes
     */
    getMaxVotes() {
        let max = 0;
        for (const voters of this.votes.values()) {
            max = Math.max(max, voters.size);
        }
        return max;
    }

    /**
     * Met à jour le graphique Chart.js
     */
    updateChart() {
        if (!window.pollChart) return;
        
        const labels = [];
        const data = [];
        const colors = [];
        
        this.possibleMoves.forEach((move) => {
            const notation = move.san || `${move.from}${move.to}`;
            const voteCount = this.votes.get(notation)?.size || 0;
            
            labels.push(notation);
            data.push(voteCount);
            colors.push(this.moveColors[notation]);
        });
        
        window.pollChart.data.labels = labels;
        window.pollChart.data.datasets[0].data = data;
        window.pollChart.data.datasets[0].backgroundColor = colors;
        window.pollChart.update();
    }

    /**
     * Démarre un nouveau vote pour le prochain coup
     */
    startNewVote() {
        // Petit délai avant de redémarrer
        setTimeout(() => {
            this.startVoting();
        }, 1000);
    }

    /**
     * Met en pause le vote
     */
    pause() {
        if (this.votingTimer) {
            clearInterval(this.votingTimer);
            this.votingTimer = null;
        }
    }

    /**
     * Reprend le vote
     */
    resume() {
        if (this.votingActive && !this.votingTimer) {
            this.startVotingTimer();
        }
    }

    /**
     * Réinitialise le système
     */
    reset() {
        this.votingActive = false;
        this.votes.clear();
        this.voters.clear();
        this.totalVotes = 0;
        
        if (this.votingTimer) {
            clearInterval(this.votingTimer);
            this.votingTimer = null;
        }
        
        const container = document.getElementById('votingOptions');
        if (container) {
            container.innerHTML = '';
        }
    }

    /**
     * Obtient les statistiques
     */
    getStatistics() {
        return {
            totalVotes: this.totalVotes,
            uniqueVoters: this.voters.size,
            movesWithVotes: this.votes.size,
            distribution: Array.from(this.votes.entries()).map(([move, voters]) => ({
                move,
                votes: voters.size,
                percentage: (voters.size / this.totalVotes * 100).toFixed(1)
            })).sort((a, b) => b.votes - a.votes)
        };
    }
}
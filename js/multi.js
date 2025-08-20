// js/multi.js - Gestionnaire principal de la configuration

class MultiplayerManager {
    constructor() {
        this.currentStep = 1;
        this.selectedMode = null;
        this.configuration = {
            mode: null,
            modeConfig: {},
            timer: {
                enabled: false,
                voteTime: 30,
                wheelAnimationTime: 3,
                uniqueVote: false,
                majorityMode: true
            },
            restrictions: {
                followersOnly: false,
                subsOnly: false
            },
            visual: {
                soundEnabled: true,
                animationsEnabled: true,
                showBackground: true,
                epilepsyMode: false
            },
            twitch: {
                defaultChannel: ''
            }
        };
        this.config = {
            // CHANGEZ CECI selon votre configuration
            serverUrl: this.getServerUrl(),
            basePath: '/chessTwitchVoter/',
            hasMultiplayerServer: true // Mettez à true si vous avez un serveur
        };        
        this.socket = null;
        this.gameId = null;
        
        this.init();
    }
    getServerUrl() {
        // Détection automatique de l'environnement
        if (window.location.hostname === 'localhost') {
            return 'http://localhost:3000';
        } else if (window.location.hostname === 'xouindaplace.fr') {
            // Si vous avez un serveur, mettez son URL ici
            // Exemples :
            // return 'https://chess-voter-server.glitch.me';
            // return 'https://your-server.railway.app';
            // return 'wss://your-vps.com:3000';
            return null; // Pas de serveur pour l'instant
        }
        return null;
    }
    init() {
        this.setupEventListeners();
        this.loadSavedConfig();
        this.showStep(1);
    }

    initializeSocket(streamerName) {
        if (!this.config.serverUrl) {
            console.warn('Pas de serveur configuré - Mode local uniquement');
            this.showToast('Mode local uniquement (pas de serveur multijoueur)', 'warning');
            return;
        }
        
        try {
            this.socket = io(this.config.serverUrl, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000
            });
            
            this.socket.on('connect', () => {
                console.log('✅ Connecté au serveur multijoueur');
                // ... reste du code
            });
            
            this.socket.on('connect_error', (error) => {
                console.error('❌ Erreur de connexion:', error);
                this.showToast('Impossible de se connecter au serveur multijoueur', 'error');
            });
            
        } catch (error) {
            console.error('Erreur lors de l\'initialisation du socket:', error);
            this.showToast('Serveur multijoueur non disponible', 'error');
        }
    }    
    
    setupEventListeners() {
        // Mode selection
        document.querySelectorAll('.mode-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (!card.classList.contains('disabled')) {
                    this.selectMode(card.dataset.mode);
                }
            });
        });
        
        // Navigation buttons
        document.getElementById('prevBtn')?.addEventListener('click', () => this.previousStep());
        document.getElementById('nextBtn')?.addEventListener('click', () => this.nextStep());
        document.getElementById('launchBtn')?.addEventListener('click', () => this.launchGame());
        
        // Timer mode toggle
        document.getElementById('timerMode')?.addEventListener('change', (e) => {
            this.configuration.timer.enabled = e.target.checked;
            this.toggleTimerOptions(e.target.checked);
        });
        
        // Copy buttons
        document.querySelectorAll('.btn-copy').forEach(btn => {
            btn.addEventListener('click', () => this.copyToClipboard(btn.dataset.target));
        });
        
        // Multiplayer role selection
        document.querySelectorAll('.role-card').forEach(card => {
            card.addEventListener('click', () => this.selectMultiplayerRole(card.dataset.role));
        });
        
        // Create/Join game buttons
        document.getElementById('createGameBtn')?.addEventListener('click', () => this.createGame());
        document.getElementById('joinGameBtn')?.addEventListener('click', () => this.joinGame());
        
        // Theme selection for problems mode
        document.getElementById('selectAllThemes')?.addEventListener('click', () => this.selectAllThemes());
        document.getElementById('clearThemes')?.addEventListener('click', () => this.clearThemes());
    }
    
    selectMode(mode) {
        // Update UI
        document.querySelectorAll('.mode-card').forEach(card => {
            card.classList.remove('selected');
        });
        document.querySelector(`.mode-card[data-mode="${mode}"]`).classList.add('selected');
        
        // Store selection
        this.selectedMode = mode;
        this.configuration.mode = mode;
        
        // Show next button
        document.getElementById('nextBtn').style.display = 'inline-flex';
    }
    
    showStep(step) {
        this.currentStep = step;
        
        // Hide all steps
        document.querySelectorAll('.config-step').forEach(s => {
            s.classList.remove('active');
        });
        
        // Show current step
        if (step === 1) {
            document.getElementById('modeSelection').classList.add('active');
            document.getElementById('prevBtn').style.display = 'none';
            document.getElementById('nextBtn').style.display = this.selectedMode ? 'inline-flex' : 'none';
            document.getElementById('launchBtn').style.display = 'none';
        } else if (step === 2) {
            document.getElementById('modeConfig').classList.add('active');
            this.showModeConfig(this.selectedMode);
            document.getElementById('prevBtn').style.display = 'inline-flex';
            document.getElementById('nextBtn').style.display = 'inline-flex';
            document.getElementById('launchBtn').style.display = 'none';
            
            // Update title
            const titles = {
                'sandbox': 'Configuration Sandbox',
                'problems': 'Configuration Problèmes',
                '1vAll': 'Configuration Seul contre Tous',
                '1v1': 'Configuration Duel',
                'viewersVsViewers': 'Configuration Viewers vs Viewers',
                'multiplayer': 'Configuration Multiplayer Online'
            };
            document.getElementById('modeConfigTitle').textContent = titles[this.selectedMode] || 'Configuration';
        } else if (step === 3) {
            document.getElementById('commonOptions').classList.add('active');
            document.getElementById('prevBtn').style.display = 'inline-flex';
            document.getElementById('nextBtn').style.display = 'none';
            document.getElementById('launchBtn').style.display = 'inline-flex';
        }
    }
    
    showModeConfig(mode) {
        // Hide all config panels
        document.querySelectorAll('.mode-config-panel').forEach(panel => {
            panel.classList.remove('active');
        });
        
        // Show specific config
        const configPanel = document.getElementById(`config-${mode}`);
        if (configPanel) {
            configPanel.classList.add('active');
        }
        
        // Load problems if needed
        if (mode === 'problems') {
            this.loadProblems();
        }
    }
    
    nextStep() {
        if (this.currentStep < 3) {
            // Validate current step
            if (this.validateStep(this.currentStep)) {
                this.saveStepConfig(this.currentStep);
                this.showStep(this.currentStep + 1);
            }
        }
    }
    
    previousStep() {
        if (this.currentStep > 1) {
            this.showStep(this.currentStep - 1);
        }
    }
    
    validateStep(step) {
        if (step === 1) {
            if (!this.selectedMode) {
                this.showToast('Veuillez sélectionner un mode de jeu', 'error');
                return false;
            }
        } else if (step === 2) {
            // Validate mode-specific config
            return this.validateModeConfig();
        }
        return true;
    }
    
    validateModeConfig() {
        const mode = this.selectedMode;
        
        if (mode === '1vAll') {
            const playerName = document.getElementById('soloPlayerName').value.trim();
            if (!playerName) {
                this.showToast('Veuillez entrer le nom du joueur solo', 'error');
                return false;
            }
            this.configuration.modeConfig.soloPlayer = playerName;
        } else if (mode === '1v1') {
            const player1 = document.getElementById('player1Name').value.trim();
            const player2 = document.getElementById('player2Name').value.trim();
            if (!player1 || !player2) {
                this.showToast('Veuillez entrer les noms des deux joueurs', 'error');
                return false;
            }
            this.configuration.modeConfig.player1 = player1;
            this.configuration.modeConfig.player2 = player2;
        } else if (mode === 'multiplayer') {
            // Multiplayer validation handled separately
            const role = document.querySelector('.role-card.selected')?.dataset.role;
            if (!role) {
                this.showToast('Veuillez choisir entre créer ou rejoindre une partie', 'error');
                return false;
            }
        }
        
        return true;
    }
    
    saveStepConfig(step) {
        if (step === 2) {
            // Save mode-specific configuration
            this.saveModeConfig();
        } else if (step === 3) {
            // Save common options
            this.saveCommonOptions();
        }
    }
    
    saveModeConfig() {
        const mode = this.selectedMode;
        
        if (mode === 'problems') {
            const selectedThemes = [];
            document.querySelectorAll('.theme-item.selected').forEach(item => {
                selectedThemes.push(item.dataset.theme);
            });
            this.configuration.modeConfig.themes = selectedThemes;
        }
    }
    
    saveCommonOptions() {
        // Timer options
        this.configuration.timer.enabled = document.getElementById('timerMode').checked;
        this.configuration.timer.voteTime = parseInt(document.getElementById('voteTime').value) || 30;
        this.configuration.timer.wheelAnimationTime = parseInt(document.getElementById('wheelAnimationTime').value) || 3;
        this.configuration.timer.uniqueVote = document.getElementById('uniqueVote').checked;
        this.configuration.timer.majorityMode = document.getElementById('majorityMode').checked;
        
        // Restrictions
        this.configuration.restrictions.followersOnly = document.getElementById('followersOnly').checked;
        this.configuration.restrictions.subsOnly = document.getElementById('subsOnly').checked;
        
        // Visual
        this.configuration.visual.soundEnabled = document.getElementById('soundEnabled').checked;
        this.configuration.visual.animationsEnabled = document.getElementById('animationsEnabled').checked;
        this.configuration.visual.showBackground = document.getElementById('showBackground').checked;
        this.configuration.visual.epilepsyMode = document.getElementById('epilepsyMode').checked;
        
        // Twitch
        this.configuration.twitch.defaultChannel = document.getElementById('defaultChannel').value.trim();
        
        // Save to localStorage
        localStorage.setItem('chessVoterConfig', JSON.stringify(this.configuration));
    }
    
    loadSavedConfig() {
        const saved = localStorage.getItem('chessVoterConfig');
        if (saved) {
            try {
                const config = JSON.parse(saved);
                // Apply saved config to form
                this.applySavedConfig(config);
            } catch (e) {
                console.error('Error loading saved config:', e);
            }
        }
    }
    
    applySavedConfig(config) {
        // Apply default channel
        if (config.twitch?.defaultChannel) {
            document.getElementById('defaultChannel').value = config.twitch.defaultChannel;
        }
        
        // Apply timer settings
        if (config.timer) {
            document.getElementById('timerMode').checked = config.timer.enabled;
            document.getElementById('voteTime').value = config.timer.voteTime;
            document.getElementById('wheelAnimationTime').value = config.timer.wheelAnimationTime;
            document.getElementById('uniqueVote').checked = config.timer.uniqueVote;
            document.getElementById('majorityMode').checked = config.timer.majorityMode;
            this.toggleTimerOptions(config.timer.enabled);
        }
        
        // Apply restrictions
        if (config.restrictions) {
            document.getElementById('followersOnly').checked = config.restrictions.followersOnly;
            document.getElementById('subsOnly').checked = config.restrictions.subsOnly;
        }
        
        // Apply visual settings
        if (config.visual) {
            document.getElementById('soundEnabled').checked = config.visual.soundEnabled;
            document.getElementById('animationsEnabled').checked = config.visual.animationsEnabled;
            document.getElementById('showBackground').checked = config.visual.showBackground;
            document.getElementById('epilepsyMode').checked = config.visual.epilepsyMode;
        }
    }
    
    toggleTimerOptions(enabled) {
        const timerOptions = document.getElementById('timerOptions');
        if (timerOptions) {
            if (enabled) {
                timerOptions.classList.add('active');
            } else {
                timerOptions.classList.remove('active');
            }
        }
    }
    
    launchGame() {
        // Save all configuration
        this.saveCommonOptions();
        
        // Generate URL parameters
        const params = this.generateUrlParams();
        
        // Redirect to game
        const url = `index.html?${params.toString()}`;
        
        this.showToast('Lancement de la partie...', 'success');
        
        setTimeout(() => {
            window.location.href = url;
        }, 1000);
    }
    
    generateUrlParams() {
        const params = new URLSearchParams();
        
        // Add mode
        params.append('gameMode', this.configuration.mode);
        
        // Add mode-specific params
        const modeConfig = this.configuration.modeConfig;
        if (this.configuration.mode === '1vAll') {
            params.append('mod1vViewersPlayer', modeConfig.soloPlayer);
        } else if (this.configuration.mode === '1v1') {
            params.append('oneVsOneModeList0', modeConfig.player1);
            params.append('oneVsOneModeList1', modeConfig.player2);
        } else if (this.configuration.mode === 'problems') {
            if (modeConfig.themes?.length > 0) {
                params.append('themes', modeConfig.themes.join(','));
            }
        } else if (this.configuration.mode === 'multiplayer') {
            if (this.gameId) {
                params.append('game', this.gameId);
                params.append('role', modeConfig.role);
            }
        }
        
        // Add timer settings
        if (this.configuration.timer.enabled) {
            params.append('timerMode', 'on');
            params.append('InitialvoterTimer', this.configuration.timer.voteTime);
            params.append('timerWheelAnimation', this.configuration.timer.wheelAnimationTime);
            if (this.configuration.timer.uniqueVote) {
                params.append('limitToOneVote', 'on');
            }
            if (this.configuration.timer.majorityMode) {
                params.append('majorityMode', 'on');
            }
        }
        
        // Add restrictions
        if (this.configuration.restrictions.followersOnly) {
            params.append('followMode', 'on');
        }
        if (this.configuration.restrictions.subsOnly) {
            params.append('subMode', 'on');
        }
        
        // Add visual settings
        if (!this.configuration.visual.showBackground) {
            params.append('noBg', 'on');
        }
        if (this.configuration.visual.epilepsyMode) {
            params.append('noEpilepsy', 'on');
        }
        
        // Add default channel
        if (this.configuration.twitch.defaultChannel) {
            params.append('defaultChannel', this.configuration.twitch.defaultChannel);
        }
        
        return params;
    }
    
    // Multiplayer specific methods
    selectMultiplayerRole(role) {
        document.querySelectorAll('.role-card').forEach(card => {
            card.classList.remove('selected');
        });
        document.querySelector(`.role-card[data-role="${role}"]`).classList.add('selected');
        
        // Show appropriate panel
        document.querySelectorAll('.role-panel').forEach(panel => {
            panel.classList.remove('active');
        });
        
        if (role === 'host') {
            document.getElementById('host-panel').classList.add('active');
        } else {
            document.getElementById('join-panel').classList.add('active');
        }
        
        this.configuration.modeConfig.role = role;
    }
    
    createGame() {
        const streamerName = document.getElementById('hostStreamerName').value.trim();
        
        if (!streamerName) {
            this.showToast('Veuillez entrer votre nom de streameur', 'error');
            return;
        }
        
        // Generate game ID
        this.gameId = this.generateGameId();
        this.configuration.modeConfig.streamerName = streamerName;
        this.configuration.modeConfig.role = 'host';
        
        // Generate URLs
        const baseUrl = window.location.origin;
        const hostUrl = `${baseUrl}/index.html?game=${this.gameId}&role=host`;
        const guestUrl = `${baseUrl}/index.html?game=${this.gameId}&role=guest`;
        
        // Update UI
        document.getElementById('gameCode').textContent = this.gameId;
        document.getElementById('hostUrl').textContent = hostUrl;
        document.getElementById('guestUrl').textContent = guestUrl;
        document.getElementById('gameCreatedInfo').style.display = 'block';
        
        // Initialize socket connection if needed
        this.initializeSocket(streamerName);
        
        this.showToast('Partie créée avec succès !', 'success');
    }
    
    joinGame() {
        const streamerName = document.getElementById('guestStreamerName').value.trim();
        const gameCode = document.getElementById('gameCodeInput').value.trim().toUpperCase();
        
        if (!streamerName || !gameCode) {
            this.showToast('Veuillez remplir tous les champs', 'error');
            return;
        }
        
        this.gameId = gameCode;
        this.configuration.modeConfig.streamerName = streamerName;
        this.configuration.modeConfig.role = 'guest';
        
        // Generate player URL
        const playerUrl = `${window.location.origin}/index.html?game=${this.gameId}&role=guest`;
        
        // Update UI
        document.getElementById('playerUrl').textContent = playerUrl;
        document.getElementById('gameJoinedInfo').style.display = 'block';
        
        // Initialize socket connection
        this.initializeSocket(streamerName);
        
        this.showToast('Connecté à la partie !', 'success');
    }
    
    initializeSocket(streamerName) {
        // Socket.io connection for multiplayer
        if (typeof io !== 'undefined') {
            this.socket = io();
            
            this.socket.on('connect', () => {
                console.log('Connected to server');
                
                if (this.configuration.modeConfig.role === 'host') {
                    this.socket.emit('createGame', {
                        gameId: this.gameId,
                        hostName: streamerName,
                        settings: {
                            timer: this.configuration.timer,
                            restrictions: this.configuration.restrictions
                        }
                    });
                } else {
                    this.socket.emit('joinGame', {
                        gameId: this.gameId,
                        guestName: streamerName
                    });
                }
            });
            
            this.socket.on('playerJoined', (data) => {
                if (this.configuration.modeConfig.role === 'host') {
                    this.showToast(`${data.guestName} a rejoint la partie !`, 'success');
                    document.querySelector('.status-waiting').textContent = 'Joueur connecté !';
                    document.querySelector('.status-waiting').className = 'status status-connected';
                }
            });
            
            this.socket.on('error', (error) => {
                this.showToast(`Erreur: ${error.message}`, 'error');
            });
        }
    }
    
    generateGameId() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < 4; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
    
    // Problems mode methods
    loadProblems() {
        // This would load problems from CSV file
        // For now, we'll create dummy themes
        const themes = [
            { name: 'middlegame', count: 1250 },
            { name: 'endgame', count: 890 },
            { name: 'opening', count: 650 },
            { name: 'tactics', count: 2100 },
            { name: 'mate', count: 450 },
            { name: 'fork', count: 320 },
            { name: 'pin', count: 280 },
            { name: 'sacrifice', count: 195 },
            { name: 'discoveredAttack', count: 175 },
            { name: 'doubleAttack', count: 165 }
        ];
        
        this.renderThemes(themes);
    }
    
    renderThemes(themes) {
        const themeList = document.getElementById('themeList');
        if (!themeList) return;
        
        themeList.innerHTML = '';
        
        themes.forEach(theme => {
            const themeItem = document.createElement('div');
            themeItem.className = 'theme-item';
            themeItem.dataset.theme = theme.name;
            
            themeItem.innerHTML = `
                <input type="checkbox" id="theme-${theme.name}">
                <label for="theme-${theme.name}">${this.formatThemeName(theme.name)}</label>
                <span class="theme-count">${theme.count}</span>
            `;
            
            themeItem.addEventListener('click', (e) => {
                if (e.target.type !== 'checkbox') {
                    const checkbox = themeItem.querySelector('input');
                    checkbox.checked = !checkbox.checked;
                }
                themeItem.classList.toggle('selected');
                this.updateProblemCount();
            });
            
            themeList.appendChild(themeItem);
        });
    }
    
    formatThemeName(name) {
        // Convert camelCase to readable format
        return name.replace(/([A-Z])/g, ' $1').trim()
                  .replace(/^./, str => str.toUpperCase());
    }
    
    selectAllThemes() {
        document.querySelectorAll('.theme-item').forEach(item => {
            item.classList.add('selected');
            item.querySelector('input').checked = true;
        });
        this.updateProblemCount();
    }
    
    clearThemes() {
        document.querySelectorAll('.theme-item').forEach(item => {
            item.classList.remove('selected');
            item.querySelector('input').checked = false;
        });
        this.updateProblemCount();
    }
    
    updateProblemCount() {
        const selected = document.querySelectorAll('.theme-item.selected');
        let total = 0;
        
        selected.forEach(item => {
            const count = parseInt(item.querySelector('.theme-count').textContent);
            total += count;
        });
        
        document.getElementById('availableProblems').textContent = total;
    }
    
    // Utility methods
    copyToClipboard(targetId) {
        const element = document.getElementById(targetId);
        if (!element) return;
        
        const text = element.textContent;
        navigator.clipboard.writeText(text).then(() => {
            this.showToast('Copié dans le presse-papiers !', 'success');
        }).catch(() => {
            this.showToast('Erreur lors de la copie', 'error');
        });
    }
    
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icons = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };
        
        toast.innerHTML = `
            <i class="fas ${icons[type]}"></i>
            <span class="toast-message">${message}</span>
            <button class="toast-close">&times;</button>
        `;
        
        container.appendChild(toast);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            toast.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
        
        // Manual close
        toast.querySelector('.toast-close').addEventListener('click', () => {
            toast.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        });
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.multiplayerManager = new MultiplayerManager();
});
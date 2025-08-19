// js/multi-config.js - Gestion de la configuration et compatibilité

class ConfigurationManager {
    constructor() {
        // Mapping des modes pour compatibilité avec l'ancien système
        this.modeMapping = {
            'sandbox': 'normal',
            'problems': 'probMode',
            '1vAll': 'mod1vViewers',
            '1v1': 'mod1v1',
            'viewersVsViewers': 'modViewersvViewers',
            'multiplayer': 'modStreamerChatvStreamerChat'
        };
        
        // Configuration par défaut
        this.defaultConfig = {
            gameMode: 'normal',
            defaultChannel: '',
            
            // Timer settings
            timerMode: false,
            InitialvoterTimer: 30,
            timerWheelAnimation: 3,
            limitToOneVote: false,
            majorityMode: true,
            pauseAfterWinLose: 15,
            timerMoveBot: 2,
            timerMoveText: 3,
            
            // Restrictions
            followMode: false,
            subMode: false,
            
            // Visual settings
            noBg: false,
            noEpilepsy: false,
            
            // Mode specific settings
            mod1vViewersPlayer: '',
            oneVsOneModeList0: '',
            oneVsOneModeList1: '',
            streamerChatvStreamerChat0: '',
            streamerChatvStreamerChat1: '',
            
            // Problem mode
            themes: []
        };
        
        this.init();
    }
    
    init() {
        this.loadFromUrl();
        this.loadFromLocalStorage();
        this.setupAutoSave();
    }
    
    loadFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        
        // Load each parameter from URL if it exists
        for (const [key, value] of urlParams) {
            if (this.defaultConfig.hasOwnProperty(key)) {
                // Convert 'on' to boolean true
                if (value === 'on') {
                    this.defaultConfig[key] = true;
                } else if (value === 'off') {
                    this.defaultConfig[key] = false;
                } else {
                    this.defaultConfig[key] = value;
                }
            }
        }
        
        // Special handling for themes (comma-separated)
        const themes = urlParams.get('themes');
        if (themes) {
            this.defaultConfig.themes = themes.split(',');
        }
    }
    
    loadFromLocalStorage() {
        const saved = localStorage.getItem('chessVoterConfig');
        if (saved) {
            try {
                const config = JSON.parse(saved);
                // Merge with default config
                Object.assign(this.defaultConfig, config);
            } catch (e) {
                console.error('Error loading saved configuration:', e);
            }
        }
    }
    
    setupAutoSave() {
        // Auto-save configuration changes
        setInterval(() => {
            this.saveToLocalStorage();
        }, 5000); // Save every 5 seconds
        
        // Save on page unload
        window.addEventListener('beforeunload', () => {
            this.saveToLocalStorage();
        });
    }
    
    saveToLocalStorage() {
        const configToSave = this.getCurrentConfig();
        localStorage.setItem('chessVoterConfig', JSON.stringify(configToSave));
    }
    
    getCurrentConfig() {
        const config = { ...this.defaultConfig };
        
        // Get values from form if they exist
        const formElements = {
            'defaultChannel': 'defaultChannel',
            'timerMode': 'timerMode',
            'InitialvoterTimer': 'voteTime',
            'timerWheelAnimation': 'wheelAnimationTime',
            'limitToOneVote': 'uniqueVote',
            'majorityMode': 'majorityMode',
            'followMode': 'followersOnly',
            'subMode': 'subsOnly',
            'noBg': 'showBackground', // Inverted
            'noEpilepsy': 'epilepsyMode'
        };
        
        for (const [configKey, elementId] of Object.entries(formElements)) {
            const element = document.getElementById(elementId);
            if (element) {
                if (element.type === 'checkbox') {
                    // Special handling for inverted checkboxes
                    if (configKey === 'noBg') {
                        config[configKey] = !element.checked;
                    } else {
                        config[configKey] = element.checked;
                    }
                } else if (element.type === 'number') {
                    config[configKey] = parseInt(element.value) || 0;
                } else {
                    config[configKey] = element.value;
                }
            }
        }
        
        return config;
    }
    
    convertToLegacyParams(modernConfig) {
        const params = new URLSearchParams();
        
        // Convert mode
        const mode = modernConfig.mode;
        const legacyMode = this.modeMapping[mode] || 'normal';
        
        if (legacyMode === 'probMode') {
            params.append('probMode', 'on');
            params.append('gameMode', 'probMode');
        } else {
            params.append('gameMode', legacyMode);
        }
        
        // Add mode-specific parameters
        switch (mode) {
            case '1vAll':
                params.append('mod1vViewersPlayer', modernConfig.modeConfig.soloPlayer || '');
                break;
            
            case '1v1':
                params.append('oneVsOneModeList0', modernConfig.modeConfig.player1 || '');
                params.append('oneVsOneModeList1', modernConfig.modeConfig.player2 || '');
                break;
            
            case 'multiplayer':
                params.append('streamerChatvStreamerChat0', modernConfig.modeConfig.streamer1 || '');
                params.append('streamerChatvStreamerChat1', modernConfig.modeConfig.streamer2 || '');
                if (modernConfig.modeConfig.gameId) {
                    params.append('game', modernConfig.modeConfig.gameId);
                    params.append('role', modernConfig.modeConfig.role);
                }
                break;
            
            case 'problems':
                if (modernConfig.modeConfig.themes?.length > 0) {
                    params.append('themes', modernConfig.modeConfig.themes.join(','));
                }
                break;
        }
        
        // Timer settings
        if (modernConfig.timer.enabled) {
            params.append('timerMode', 'on');
            params.append('InitialvoterTimer', modernConfig.timer.voteTime);
            params.append('timerWheelAnimation', modernConfig.timer.wheelAnimationTime);
            
            if (modernConfig.timer.uniqueVote) {
                params.append('limitToOneVote', 'on');
            }
            
            if (modernConfig.timer.majorityMode) {
                params.append('majorityMode', 'on');
            }
        }
        
        // Restrictions
        if (modernConfig.restrictions.followersOnly) {
            params.append('followMode', 'on');
        }
        if (modernConfig.restrictions.subsOnly) {
            params.append('subMode', 'on');
        }
        
        // Visual settings
        if (!modernConfig.visual.showBackground) {
            params.append('noBg', 'on');
        }
        if (modernConfig.visual.epilepsyMode) {
            params.append('noEpilepsy', 'on');
        }
        
        // Default channel
        if (modernConfig.twitch.defaultChannel) {
            params.append('defaultChannel', modernConfig.twitch.defaultChannel);
        }
        
        return params;
    }
    
    exportConfig() {
        const config = this.getCurrentConfig();
        const json = JSON.stringify(config, null, 2);
        
        // Create download link
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chess-voter-config-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        return json;
    }
    
    importConfig(jsonString) {
        try {
            const config = JSON.parse(jsonString);
            this.applyConfig(config);
            this.saveToLocalStorage();
            return true;
        } catch (e) {
            console.error('Error importing configuration:', e);
            return false;
        }
    }
    
    applyConfig(config) {
        // Apply to form elements
        Object.entries(config).forEach(([key, value]) => {
            const element = document.getElementById(key);
            if (element) {
                if (element.type === 'checkbox') {
                    element.checked = value;
                } else {
                    element.value = value;
                }
            }
        });
    }
    
    // Presets for common configurations
    getPresets() {
        return {
            'quick': {
                name: 'Partie Rapide',
                description: 'Votes rapides, pas de restrictions',
                config: {
                    timerMode: true,
                    InitialvoterTimer: 15,
                    timerWheelAnimation: 2,
                    majorityMode: true,
                    limitToOneVote: false,
                    followMode: false,
                    subMode: false
                }
            },
            'competitive': {
                name: 'Mode Compétitif',
                description: 'Votes stricts, followers uniquement',
                config: {
                    timerMode: true,
                    InitialvoterTimer: 30,
                    timerWheelAnimation: 3,
                    majorityMode: true,
                    limitToOneVote: true,
                    followMode: true,
                    subMode: false
                }
            },
            'sub-only': {
                name: 'Abonnés Uniquement',
                description: 'Réservé aux abonnés, votes longs',
                config: {
                    timerMode: true,
                    InitialvoterTimer: 45,
                    timerWheelAnimation: 4,
                    majorityMode: true,
                    limitToOneVote: true,
                    followMode: false,
                    subMode: true
                }
            },
            'chaos': {
                name: 'Mode Chaos',
                description: 'Roue aléatoire, votes multiples',
                config: {
                    timerMode: true,
                    InitialvoterTimer: 10,
                    timerWheelAnimation: 5,
                    majorityMode: false,
                    limitToOneVote: false,
                    followMode: false,
                    subMode: false
                }
            },
            'educational': {
                name: 'Mode Pédagogique',
                description: 'Temps de réflexion long, tous peuvent voter',
                config: {
                    timerMode: true,
                    InitialvoterTimer: 60,
                    timerWheelAnimation: 3,
                    majorityMode: true,
                    limitToOneVote: false,
                    followMode: false,
                    subMode: false
                }
            }
        };
    }
    
    applyPreset(presetName) {
        const presets = this.getPresets();
        if (presets[presetName]) {
            this.applyConfig(presets[presetName].config);
            return true;
        }
        return false;
    }
    
    // Validation des configurations
    validateConfig(config) {
        const errors = [];
        
        // Validate timer settings
        if (config.timerMode) {
            if (config.InitialvoterTimer < 5 || config.InitialvoterTimer > 300) {
                errors.push('Le temps de vote doit être entre 5 et 300 secondes');
            }
            if (config.timerWheelAnimation < 1 || config.timerWheelAnimation > 10) {
                errors.push('L\'animation de la roue doit durer entre 1 et 10 secondes');
            }
        }
        
        // Validate mode-specific settings
        if (config.gameMode === 'mod1v1') {
            if (!config.oneVsOneModeList0 || !config.oneVsOneModeList1) {
                errors.push('Les deux joueurs doivent être spécifiés pour le mode 1v1');
            }
        }
        
        if (config.gameMode === 'mod1vViewers') {
            if (!config.mod1vViewersPlayer) {
                errors.push('Le joueur solo doit être spécifié');
            }
        }
        
        if (config.gameMode === 'modStreamerChatvStreamerChat') {
            if (!config.streamerChatvStreamerChat0 || !config.streamerChatvStreamerChat1) {
                errors.push('Les deux streamers doivent être spécifiés pour le mode Chat vs Chat');
            }
        }
        
        // Validate channel
        if (!config.defaultChannel && config.gameMode !== 'modStreamerChatvStreamerChat') {
            errors.push('Un channel Twitch par défaut doit être spécifié');
        }
        
        return {
            valid: errors.length === 0,
            errors: errors
        };
    }
    
    // Obtenir l'URL finale pour lancer le jeu
    getFinalGameUrl(config) {
        const params = this.convertToLegacyParams(config);
        return `index.html?${params.toString()}`;
    }
    
    // Statistiques d'utilisation
    trackUsage() {
        const usage = JSON.parse(localStorage.getItem('chessVoterUsage') || '{}');
        const today = new Date().toISOString().split('T')[0];
        
        if (!usage[today]) {
            usage[today] = {
                launches: 0,
                modes: {}
            };
        }
        
        usage[today].launches++;
        
        const mode = this.getCurrentConfig().gameMode;
        usage[today].modes[mode] = (usage[today].modes[mode] || 0) + 1;
        
        localStorage.setItem('chessVoterUsage', JSON.stringify(usage));
        
        return usage;
    }
    
    getUsageStats() {
        const usage = JSON.parse(localStorage.getItem('chessVoterUsage') || '{}');
        const stats = {
            totalLaunches: 0,
            modeUsage: {},
            dailyAverage: 0,
            mostUsedMode: null
        };
        
        Object.values(usage).forEach(day => {
            stats.totalLaunches += day.launches;
            Object.entries(day.modes).forEach(([mode, count]) => {
                stats.modeUsage[mode] = (stats.modeUsage[mode] || 0) + count;
            });
        });
        
        const days = Object.keys(usage).length;
        stats.dailyAverage = days > 0 ? Math.round(stats.totalLaunches / days) : 0;
        
        // Find most used mode
        let maxUsage = 0;
        Object.entries(stats.modeUsage).forEach(([mode, count]) => {
            if (count > maxUsage) {
                maxUsage = count;
                stats.mostUsedMode = mode;
            }
        });
        
        return stats;
    }
    
    // Reset configuration
    resetConfig() {
        localStorage.removeItem('chessVoterConfig');
        this.applyConfig(this.defaultConfig);
    }
    
    // Compatibility avec l'ancien système
    isLegacyUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.has('probMode') || 
               urlParams.has('mod1vViewers') || 
               urlParams.has('mod1v1') ||
               urlParams.has('modViewersvViewers') ||
               urlParams.has('modStreamerChatvStreamerChat');
    }
    
    convertLegacyUrl() {
        if (this.isLegacyUrl()) {
            const urlParams = new URLSearchParams(window.location.search);
            const modernConfig = {
                mode: 'sandbox',
                modeConfig: {},
                timer: {},
                restrictions: {},
                visual: {},
                twitch: {}
            };
            
            // Detect mode
            if (urlParams.get('probMode') === 'on') {
                modernConfig.mode = 'problems';
            } else if (urlParams.get('gameMode') === 'mod1vViewers') {
                modernConfig.mode = '1vAll';
                modernConfig.modeConfig.soloPlayer = urlParams.get('mod1vViewersPlayer');
            } else if (urlParams.get('gameMode') === 'mod1v1') {
                modernConfig.mode = '1v1';
                modernConfig.modeConfig.player1 = urlParams.get('oneVsOneModeList0');
                modernConfig.modeConfig.player2 = urlParams.get('oneVsOneModeList1');
            } else if (urlParams.get('gameMode') === 'modViewersvViewers') {
                modernConfig.mode = 'viewersVsViewers';
            } else if (urlParams.get('gameMode') === 'modStreamerChatvStreamerChat') {
                modernConfig.mode = 'multiplayer';
                modernConfig.modeConfig.streamer1 = urlParams.get('streamerChatvStreamerChat0');
                modernConfig.modeConfig.streamer2 = urlParams.get('streamerChatvStreamerChat1');
            }
            
            return modernConfig;
        }
        return null;
    }
}

// Initialize Configuration Manager
document.addEventListener('DOMContentLoaded', () => {
    window.configManager = new ConfigurationManager();
    
    // Check if coming from legacy URL
    if (window.configManager.isLegacyUrl()) {
        console.log('Legacy URL detected, converting to modern format');
        const modernConfig = window.configManager.convertLegacyUrl();
        if (modernConfig) {
            console.log('Converted configuration:', modernConfig);
        }
    }
});
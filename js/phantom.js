/**
 * 🎯 PHANTOM CHESS - VERSION CORRIGÉE
 * Le board gère automatiquement le cimetière quand une pièce disparaît
 * On envoie simplement la matrice 10x10 via GAME_START
 */

class PhantomChessboard {
    constructor() {
        // UUIDs Bluetooth
        this.SERVICE_UUID = 'fd31a840-22e7-11eb-adc1-0242ac120002';
        this.UUID_GAME = 'cc68a66e-3bfa-4614-a77f-f46954a4c103';
        this.UUID_MECHANISM_SPEED = 'acb646cc-92ca-11ee-b9d1-0242ac120002';
        this.UUID_SOUND_SETTINGS = 'acb64a32-92ca-11ee-b9d1-0242ac120002';
        this.UUID_BATTERY = '7b204548-40c4-11eb-adc1-0242ac120002';
        this.UUID_SETSTATE = 'acb6543c-92ca-11ee-b9d1-0242ac120002';
        
        // OpCodes
        this.OP_CODES = {
            GAME_START: 0,
            GAME_END: 1,
            MOVEMENT: 2,
            MOVEMENT_VERIFY: 3,
            VOICE_COMMAND: 4,
            TAKE_BACK: 5,
            BOARD_STATE: 6,
            CALIBRATION: 7,
            ERROR_MSG: 8,
            CHECK_SOUND: 9,
            SIDE: 10,
            GAME_ASSISTANCE: 11,
            BLE_MOVE_DONE: 12,
            SNAPTOCENTERCOM: 13,
            RESET_DETECTION: 14
        };
        
        this.OP_CODE_NAMES = {
            0: 'GAME_START', 1: 'GAME_END', 2: 'MOVEMENT', 3: 'MOVEMENT_VERIFY',
            4: 'VOICE_COMMAND', 5: 'TAKE_BACK', 6: 'BOARD_STATE', 7: 'CALIBRATION',
            8: 'ERROR_MSG', 9: 'CHECK_SOUND', 10: 'SIDE', 11: 'GAME_ASSISTANCE',
            12: 'BLE_MOVE_DONE', 13: 'SNAPTOCENTERCOM', 14: 'RESET_DETECTION'
        };
        
        // État
        this.device = null;
        this.server = null;
        this.service = null;
        this.characteristics = {};
        this.isConnected = false;
        this.enabled = false;
        this.lastFenSent = null;
        this.gameInitialized = false;
        
        console.log('🎯 PhantomChessboard initialisé');
    }
    
    // ========== CONVERSION FEN → MATRICE 10x10 ==========
    
    /**
     * Convertit un FEN en matrice 10x10 pour le Phantom
     * 
     * Le Phantom lit la matrice du bas vers le haut, donc on inverse l'ordre des lignes.
     * 
     * @param {string} fen - Position FEN
     * @returns {string} Matrice 10x10 (100 caractères)
     */
    fenToMatrix(fen) {
        // Extraire juste la position (première partie du FEN)
        const position = fen.split(' ')[0];
        const rows = position.split('/');
        
        // Convertir chaque rangée FEN en string de 8 caractères
        const board = [];
        for (const row of rows) {
            let boardRow = '';
            for (const char of row) {
                if (/\d/.test(char)) {
                    boardRow += '.'.repeat(parseInt(char));
                } else {
                    boardRow += char;
                }
            }
            board.push(boardRow.padEnd(8, '.').slice(0, 8));
        }
        
        // S'assurer qu'on a 8 lignes
        while (board.length < 8) {
            board.push('........');
        }
        
        // Inverser l'ordre des lignes (rang 8 → rang 1)
        board.reverse();
        
        // Construire la matrice 10x10
        let matrix = '.'.repeat(10);  // Ligne 0 : cimetière haut
        
        for (const row of board) {
            matrix += '.' + row + '.';  // Lignes 1-8
        }
        
        matrix += '.'.repeat(10);  // Ligne 9 : cimetière bas
        
        return matrix;
    }
    
    /**
     * Affiche une matrice de façon lisible (pour debug)
     */
    formatMatrix(matrix) {
        if (!matrix || matrix.length < 100) return 'Matrice invalide';
        
        let display = '   a b c d e f g h\n';
        display += '   0 1 2 3 4 5 6 7 8 9\n';
        
        for (let row = 0; row < 10; row++) {
            const rank = row === 0 ? ' ' : (row === 9 ? ' ' : (9 - row).toString());
            display += `${row} ${rank} `;
            for (let col = 0; col < 10; col++) {
                display += matrix[row * 10 + col] + ' ';
            }
            display += '\n';
        }
        
        return display;
    }
    
    // ========== CONNEXION ==========
    
    async connect() {
        if (!navigator.bluetooth) {
            this.log('❌ Web Bluetooth non supporté', 'error');
            alert('Web Bluetooth non supporté. Utilisez Chrome ou Edge.');
            return false;
        }
        
        try {
            this.log('🔍 Recherche du Phantom...', 'info');
            
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'Phantom' }],
                optionalServices: [this.SERVICE_UUID]
            });
            
            this.log(`📱 Appareil trouvé: ${this.device.name}`, 'info');
            
            this.server = await this.device.gatt.connect();
            this.service = await this.server.getPrimaryService(this.SERVICE_UUID);
            
            // Récupérer les caractéristiques
            this.characteristics.game = await this.service.getCharacteristic(this.UUID_GAME);
            
            try {
                this.characteristics.speed = await this.service.getCharacteristic(this.UUID_MECHANISM_SPEED);
            } catch (e) { /* Optionnel */ }
            
            try {
                this.characteristics.sound = await this.service.getCharacteristic(this.UUID_SOUND_SETTINGS);
            } catch (e) { /* Optionnel */ }
            
            try {
                this.characteristics.state = await this.service.getCharacteristic(this.UUID_SETSTATE);
            } catch (e) { /* Optionnel */ }
            
            try {
                this.characteristics.battery = await this.service.getCharacteristic(this.UUID_BATTERY);
            } catch (e) { /* Optionnel */ }
            
            // Activer les notifications
            if (this.characteristics.game) {
                await this.characteristics.game.startNotifications();
                this.characteristics.game.addEventListener('characteristicvaluechanged',
                    this.handleGameNotification.bind(this));
            }
            
            if (this.characteristics.state) {
                await this.characteristics.state.startNotifications();
                this.characteristics.state.addEventListener('characteristicvaluechanged',
                    this.handleStateNotification.bind(this));
            }
            
            if (this.characteristics.battery) {
                await this.characteristics.battery.startNotifications();
                this.characteristics.battery.addEventListener('characteristicvaluechanged',
                    this.handleBatteryNotification.bind(this));
            }
            
            this.isConnected = true;
            this.enabled = true;
            this.log(`✅ Connecté à ${this.device.name}`, 'success');
            this.updateUI(true);
            
            // Lire les valeurs initiales des caractéristiques
            await this.readInitialValues();
            
            // Initialisation automatique avec position de départ
            await this.initializeGame();
            
            // Gestion déconnexion
            this.device.addEventListener('gattserverdisconnected', () => {
                this.log('⚠️ Déconnecté', 'warn');
                this.isConnected = false;
                this.enabled = false;
                this.gameInitialized = false;
                this.updateUI(false);
            });
            
            return true;
            
        } catch (error) {
            this.log(`❌ Erreur: ${error.message}`, 'error');
            return false;
        }
    }
    
    async disconnect() {
        if (this.device && this.device.gatt.connected) {
            if (this.gameInitialized) {
                await this.sendGameEnd();
            }
            this.device.gatt.disconnect();
            this.isConnected = false;
            this.enabled = false;
            this.gameInitialized = false;
            this.log('🔌 Déconnecté', 'info');
            this.updateUI(false);
        }
    }
    
    // ========== INITIALISATION ==========
    
    /**
     * Lit les valeurs initiales des caractéristiques (vitesse, volume, batterie, état)
     */
    async readInitialValues() {
        this.log('📖 Lecture des valeurs initiales...', 'info');
        
        // Lire la vitesse
        if (this.characteristics.speed) {
            try {
                const value = await this.characteristics.speed.readValue();
                const speed = new TextDecoder().decode(value);
                this.log(`⚡ Vitesse actuelle: ${speed}%`, 'info');
                
                // Mettre à jour l'UI si présente
                const speedSlider = document.getElementById('phantom-speed');
                const speedValue = document.getElementById('phantom-speed-value');
                if (speedSlider) speedSlider.value = parseInt(speed) || 50;
                if (speedValue) speedValue.textContent = `${speed}%`;
            } catch (e) {
                this.log(`⚠️ Impossible de lire la vitesse: ${e.message}`, 'warn');
            }
        }
        
        // Lire le volume
        if (this.characteristics.sound) {
            try {
                const value = await this.characteristics.sound.readValue();
                const sound = new TextDecoder().decode(value);
                const volume = sound.split(',')[0];
                this.log(`🔊 Volume actuel: ${volume}%`, 'info');
                
                // Mettre à jour l'UI si présente
                const volumeSlider = document.getElementById('phantom-volume');
                const volumeValue = document.getElementById('phantom-volume-value');
                if (volumeSlider) volumeSlider.value = parseInt(volume) || 50;
                if (volumeValue) volumeValue.textContent = `${volume}%`;
            } catch (e) {
                this.log(`⚠️ Impossible de lire le volume: ${e.message}`, 'warn');
            }
        }
        
        // Lire la batterie
        if (this.characteristics.battery) {
            try {
                const value = await this.characteristics.battery.readValue();
                const batteryData = new TextDecoder().decode(value);
                const [percentage] = batteryData.split(',');
                this.log(`🔋 Batterie: ${percentage}%`, 'info');
                
                // Mettre à jour l'UI si présente
                const batteryEl = document.getElementById('phantom-battery');
                if (batteryEl) batteryEl.textContent = `🔋 ${percentage}%`;
            } catch (e) {
                this.log(`⚠️ Impossible de lire la batterie: ${e.message}`, 'warn');
            }
        }
        
        // Lire l'état du board
        if (this.characteristics.state) {
            try {
                const value = await this.characteristics.state.readValue();
                const state = new TextDecoder().decode(value);
                this.log(`📊 État du board: ${state}`, 'info');
                
                // Mettre à jour l'UI si présente
                const stateEl = document.getElementById('phantom-state-text');
                if (stateEl) {
                    stateEl.textContent = state;
                    stateEl.style.color = '#0ff';
                }
            } catch (e) {
                this.log(`⚠️ Impossible de lire l'état: ${e.message}`, 'warn');
            }
        }
        
        this.log('✅ Lecture des valeurs terminée', 'success');
    }
    
    async initializeGame() {
        if (this.gameInitialized) {
            this.log('ℹ️ Partie déjà initialisée', 'info');
            return true;
        }
        
        this.log('🎮 Initialisation partie...', 'info');
        
        // Envoyer la position initiale
        const initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        await this.syncPosition(initialFen);
        
        this.gameInitialized = true;
        this.log('✅ Partie initialisée', 'success');
        
        return true;
    }
    
    // ========== COMMANDES BLE ==========
    
    async sendCommand(opCode, data = '') {
        if (!this.isConnected || !this.characteristics.game) {
            this.log('❌ Non connecté', 'error');
            return false;
        }
        
        try {
            const message = String.fromCharCode(opCode) + data;
            const encoded = new TextEncoder().encode(message);
            await this.characteristics.game.writeValue(encoded);
            
            const opName = this.OP_CODE_NAMES[opCode] || `0x${opCode.toString(16)}`;
            if (data.length < 50) {
                this.log(`📤 [${opName}] "${data}"`, 'sent');
            } else {
                this.log(`📤 [${opName}] (${data.length} chars)`, 'sent');
            }
            return true;
        } catch (error) {
            this.log(`❌ Erreur envoi: ${error.message}`, 'error');
            return false;
        }
    }
    
    // ========== COMMANDES DE JEU ==========
    
    async sendGameStart() {
        const initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
        const matrix = this.fenToMatrix(initialFen);
        return await this.sendCommand(this.OP_CODES.GAME_START, matrix + ',W');
    }
    
    async sendGameEnd() {
        this.gameInitialized = false;
        return await this.sendCommand(this.OP_CODES.GAME_END);
    }
    
    async sendResetDetection(fen = '') {
        return await this.sendCommand(this.OP_CODES.RESET_DETECTION, fen);
    }
    
    async calibrate() {
        return await this.sendCommand(this.OP_CODES.CALIBRATION);
    }
    
    async sendTakeBack(count, fen, side = '1') {
        const data = `${count},${fen},${side}`;
        this.log(`↩️ TAKE_BACK: ${count} coups, side=${side}`, 'info');
        return await this.sendCommand(this.OP_CODES.TAKE_BACK, data);
    }
    
    // ========== MOUVEMENTS ==========
    
    /**
     * Envoie un mouvement via MOVEMENT (OpCode 2)
     * Note: Pour les captures, utiliser syncPosition() qui est plus fiable
     */
    async sendMove(move) {
        if (!this.gameInitialized) {
            this.log('⚠️ Partie non initialisée', 'warn');
            await this.initializeGame();
        }
        
        this.log(`♟️ Envoi mouvement: ${move}`, 'info');
        return await this.sendCommand(this.OP_CODES.MOVEMENT, move);
    }
    
    /**
     * 🎯 MÉTHODE PRINCIPALE : Synchronise la position avec le Phantom
     * 
     * Utilise GAME_START avec la matrice 10x10 générée depuis le FEN.
     * Le board Phantom gère AUTOMATIQUEMENT :
     * - Le déplacement des pièces vers leurs nouvelles positions
     * - L'envoi des pièces capturées (disparues) au cimetière
     * 
     * @param {string} fen - Position FEN à synchroniser
     * @param {object} moveInfo - Info sur le coup (optionnel, non utilisé actuellement)
     */
    async syncPosition(fen, moveInfo = null) {
        if (!this.enabled || !this.isConnected) {
            console.log('⚠️ Phantom non actif');
            return false;
        }
        
        // Éviter les envois dupliqués
        if (fen === this.lastFenSent) {
            console.log('⏭️ FEN identique, ignoré');
            return true;
        }
        
        this.log(`🔄 Sync position...`, 'info');
        
        try {
            // Convertir FEN en matrice 10x10
            const matrix = this.fenToMatrix(fen);
            
            // Debug: afficher la matrice
            console.log('📋 Matrice générée:\n' + this.formatMatrix(matrix));
            
            // Déterminer la couleur qui joue
            const fenParts = fen.split(' ');
            const colorToPlay = (fenParts.length > 1 && fenParts[1] === 'b') ? 'B' : 'W';
            
            // Envoyer via GAME_START avec la matrice
            // Le board va automatiquement:
            // 1. Comparer avec la position actuelle
            // 2. Déplacer les pièces nécessaires
            // 3. Envoyer les pièces "disparues" au cimetière
            await this.sendCommand(this.OP_CODES.GAME_START, matrix + ',' + colorToPlay);
            
            // Attendre que le board se stabilise
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Sélectionner le mode BLE
            await this.sendCommand(this.OP_CODES.SIDE, '2');
            
            this.lastFenSent = fen;
            this.log('✅ Position synchronisée', 'success');
            
            return true;
        } catch (error) {
            this.log(`❌ Erreur sync: ${error.message}`, 'error');
            return false;
        }
    }
    
    // ========== PARAMÈTRES ==========
    
    async setSpeed(speed) {
        if (!this.characteristics.speed) {
            this.log('⚠️ Vitesse indisponible', 'warn');
            return false;
        }
        
        try {
            const value = Math.max(0, Math.min(100, speed));
            const encoded = new TextEncoder().encode(value.toString());
            await this.characteristics.speed.writeValue(encoded);
            this.log(`⚡ Vitesse: ${value}%`, 'info');
            return true;
        } catch (error) {
            this.log(`❌ Erreur vitesse: ${error.message}`, 'error');
            return false;
        }
    }
    
    async setVolume(volume) {
        if (!this.characteristics.sound) {
            this.log('⚠️ Volume indisponible', 'warn');
            return false;
        }
        
        try {
            const value = Math.max(0, Math.min(100, volume));
            const soundSettings = `${value},1`;
            const encoded = new TextEncoder().encode(soundSettings);
            await this.characteristics.sound.writeValue(encoded);
            this.log(`🔊 Volume: ${value}%`, 'info');
            return true;
        } catch (error) {
            this.log(`❌ Erreur volume: ${error.message}`, 'error');
            return false;
        }
    }
    
    async setGameAssistance(settings = '1,1,1,1,0,0') {
        return await this.sendCommand(this.OP_CODES.GAME_ASSISTANCE, settings);
    }
    
    // ========== COMMANDES BRUTES ==========
    
    async sendRawCommand(opCode, data = '') {
        this.log(`🔧 Commande brute: 0x${opCode.toString(16)} "${data}"`, 'info');
        return await this.sendCommand(opCode, data);
    }
    
    // ========== NOTIFICATIONS ==========
    
    handleGameNotification(event) {
        const value = event.target.value;
        const decoder = new TextDecoder('utf-8');
        const bytes = new Uint8Array(value.buffer);
        
        try {
            const strValue = decoder.decode(value);
            const opCode = bytes[0];
            const opName = this.OP_CODE_NAMES[opCode] || `0x${opCode.toString(16)}`;
            const dataStr = strValue.substring(1);
            
            // Log
            if (dataStr.trim() && dataStr.length < 100) {
                this.log(`📥 [${opName}] "${dataStr}"`, 'received');
            } else if (dataStr.trim()) {
                this.log(`📥 [${opName}] (${dataStr.length} chars)`, 'received');
            } else {
                this.log(`📥 [${opName}]`, 'received');
            }
            
            // BLE_MOVE_DONE
            if (opCode === this.OP_CODES.BLE_MOVE_DONE) {
                this.log(`🎯 MOVE_DONE`, 'success');
            }
            
            // MOVEMENT_VERIFY - répondre automatiquement
            if (opCode === this.OP_CODES.MOVEMENT_VERIFY) {
                this.log(`🔍 MOVEMENT_VERIFY: "${dataStr}" → Confirmation...`, 'warning');
                
                setTimeout(() => {
                    this.sendCommand(this.OP_CODES.MOVEMENT_VERIFY, "1")
                        .then(() => this.log(`✅ MOVEMENT_VERIFY confirmé`, 'success'))
                        .catch(err => this.log(`❌ Erreur confirmation: ${err.message}`, 'error'));
                }, 100);
            }
            
        } catch (e) {
            this.log(`📥 Notification binaire (${bytes.length} bytes)`, 'received');
        }
    }
    
    handleStateNotification(event) {
        const state = new TextDecoder('utf-8').decode(event.target.value);
        this.log(`📊 ÉTAT: ${state}`, 'info');
        
        const stateEl = document.getElementById('phantom-state-text');
        if (stateEl) {
            stateEl.textContent = state;
            stateEl.style.color = '#0ff';
        }
    }
    
    handleBatteryNotification(event) {
        const batteryData = new TextDecoder('utf-8').decode(event.target.value);
        const [percentage] = batteryData.split(',');
        this.log(`🔋 Batterie: ${percentage}%`, 'info');
        
        const batteryEl = document.getElementById('phantom-battery');
        if (batteryEl) {
            batteryEl.textContent = `🔋 ${percentage}%`;
        }
    }
    
    // ========== UTILITAIRES ==========
    
    log(message, type = 'info') {
        const prefix = {
            'info': 'ℹ️', 'success': '✅', 'error': '❌',
            'warn': '⚠️', 'sent': '📤', 'received': '📥'
        }[type] || 'ℹ️';
        
        console.log(`${prefix} [Phantom] ${message}`);
    }
    
    updateUI(connected) {
        console.log(`UI: ${connected ? 'Connecté' : 'Déconnecté'}`);
    }
    
    setEnabled(enabled) {
        this.enabled = enabled;
        this.log(enabled ? '🟢 Activé' : '🔴 Désactivé', 'info');
    }
    
    isEnabled() {
        return this.enabled && this.isConnected;
    }
}

// Instance globale
window.phantomChessboard = new PhantomChessboard();

/**
 * 🎯 FONCTION GLOBALE appelée par chessVoterApp.js après chaque coup
 * C'est le pont entre le jeu d'échecs et le Phantom
 */
window.syncPhantomPosition = function() {
    // Vérifier que tout est disponible
    if (!window.phantomChessboard) {
        console.log('⚠️ [syncPhantomPosition] phantomChessboard non disponible');
        return;
    }
    
    if (!window.phantomChessboard.isConnected) {
        console.log('⚠️ [syncPhantomPosition] Phantom non connecté');
        return;
    }
    
    if (!window.phantomChessboard.enabled) {
        console.log('⚠️ [syncPhantomPosition] Phantom désactivé');
        return;
    }
    
    // Vérifier que chess.js est disponible
    if (typeof chess === 'undefined') {
        console.log('⚠️ [syncPhantomPosition] chess.js non disponible');
        return;
    }
    
    // Récupérer le FEN actuel et synchroniser
    const currentFen = chess.fen();
    console.log('🔄 [syncPhantomPosition] Sync vers Phantom:', currentFen);
    
    // Appeler la méthode de synchronisation
    window.phantomChessboard.syncPosition(currentFen);
};

console.log('🎯 Phantom.js chargé - syncPhantomPosition() disponible globalement');
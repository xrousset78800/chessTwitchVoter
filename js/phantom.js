/**
 * 🎯 PHANTOM CHESS - VERSION DEBUG OPTIMISÉE
 * Support complet des commandes pour tests sans FEN
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
        
        // OpCodes (valeurs décimales pour cohérence)
        this.OP_CODES = {
            GAME_START: 0,
            GAME_END: 1,
            MOVEMENT: 2,
            MOVEMENT_VERIFY: 3,
            TAKE_BACK: 5,
            BOARD_STATE: 6,
            CALIBRATION: 7,
            SIDE: 10,
            BLE_MOVE_DONE: 12,
            SNAPTOCENTERCOM: 13,
            RESET_DETECTION: 14
        };
        
        this.OP_CODE_NAMES = {
            0: 'GAME_START', 1: 'GAME_END', 2: 'MOVEMENT',3: 'MOVEMENT_VERIFY', 5: 'TAKE_BACK',
            6: 'BOARD_STATE', 7: 'CALIBRATION', 10: 'SIDE',
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
        
        // Matrice initiale
        this.INITIAL_MATRIX = '...........rp....PR..np....PN..bp....PB..qp....PQ..kp....PK..bp....PB..np....PN..rp....PR...........,W';
        
        console.log('🎯 PhantomChessboard initialisé');
    }
    
    // ========== CONNEXION ==========
    
    async connect() {
        if (!navigator.bluetooth) {
            this.log('❌ Web Bluetooth non supporté', 'error');
            alert('Web Bluetooth non supporté. Utilisez Chrome ou Edge.');
            return false;
        }
        
        try {
            this.log('🔍 Recherche Phantom...', 'info');
            
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'Phantom' }],
                optionalServices: [this.SERVICE_UUID]
            });
            
            this.log(`📱 Connexion à ${this.device.name}...`, 'info');
            
            this.server = await this.device.gatt.connect();
            this.service = await this.server.getPrimaryService(this.SERVICE_UUID);
            
            // Récupération des caractéristiques
            const uuids = {
                game: this.UUID_GAME,
                speed: this.UUID_MECHANISM_SPEED,
                sound: this.UUID_SOUND_SETTINGS,
                battery: this.UUID_BATTERY,
                state: this.UUID_SETSTATE
            };
            
            for (const [key, uuid] of Object.entries(uuids)) {
                try {
                    this.characteristics[key] = await this.service.getCharacteristic(uuid);
                    this.log(`✓ ${key} OK`, 'info');
                } catch (e) {
                    this.log(`⚠ ${key} indisponible`, 'warn');
                }
            }
            
            // Notifications
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
            
            // Initialisation automatique
            await this.initializeGame();
            
            // Déconnexion automatique
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
    
    async initializeGame() {
        if (this.gameInitialized) {
            this.log('ℹ️ Partie déjà initialisée', 'info');
            return true;
        }
        
        this.log('🎮 Initialisation partie...', 'info');
        
        await this.sendGameStart();
        //await this.sendCommand(this.OP_CODES.SIDE, '2'); // Mode BLE
        
        this.gameInitialized = true;
        this.log('✅ Partie initialisée (GAME_START + BLE)', 'success');
        
        return true;
    }
    
    // ========== COMMANDES BLE DE BASE ==========
    
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
       return await this.sendCommand(this.OP_CODES.GAME_START, this.INITIAL_MATRIX);
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

    async sendUndo() {
        this.log('↩️ Annulation du dernier coup', 'info');
        // Le Phantom n'a pas d'OpCode UNDO natif, on utilise une commande personnalisée
        // Vous devrez adapter selon ce que votre Phantom supporte
        return await this.sendRawCommand(0x55, ''); // À vérifier avec votre protocole
    }

    // ========== MOUVEMENTS ==========
    
    /**
     * Envoie un mouvement (sans FEN)
     * Formats acceptés : "e2e4", "e2-e4", "e7e8q" (promotion)
     */
    async sendMove(move) {
        if (!this.gameInitialized) {
            this.log('⚠️ Partie non initialisée', 'warn');
            await this.initializeGame();
        }
        
        // Normaliser le format (accepte UCI et case-case)
        //let normalizedMove = move.replace('-', '').toLowerCase().trim();
        
        this.log(`♟️ Envoi mouvement: ${move}`, 'info');
        return await this.sendCommand(this.OP_CODES.MOVEMENT, move);
    }
    
    /**
     * Synchronisation FEN (méthode pour compatibilité)
     */
    async syncPosition(fen, moveInfo = null) {
        if (!this.enabled || !this.isConnected) {
            console.log('⚠️ Phantom non actif');
            return false;
        }
        
        if (!this.gameInitialized) {
            await this.initializeGame();
        }
        
        if (fen === this.lastFenSent) {
            console.log('⏭️ FEN identique, ignoré');
            return true;
        }
        
        this.log(`🔄 Sync FEN: ${fen}`, 'info');
        
        try {
            await this.sendResetDetection(fen);
            await new Promise(resolve => setTimeout(resolve, 300));
            await this.sendCommand(this.OP_CODES.SIDE, '2'); // BLE mode
            
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
    
    // ========== COMMANDES BRUTES (POUR DEBUG) ==========
    
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
        
        // TOUJOURS LOGGER
        if (dataStr.trim() && dataStr.length < 100) {
            this.log(`📥 [${opName}] "${dataStr}"`, 'received');
        } else if (dataStr.trim()) {
            this.log(`📥 [${opName}] (${dataStr.length} chars)`, 'received');
        } else {
            this.log(`📥 [${opName}]`, 'received');
        }
        
        // Cas spéciaux
        if (opCode === this.OP_CODES.BLE_MOVE_DONE) {
            this.log(`🎯 MOVE_DONE: ${dataStr}`, 'success');
        }
        
        // MOVEMENT_VERIFY (OpCode 3) - RÉPONDRE AUTOMATIQUEMENT
        if (opCode === 3) {
            this.log(`🔍 MOVEMENT_VERIFY: "${dataStr}" → Envoi confirmation...`, 'warning');
            
            // Répondre automatiquement "1" = verified
            setTimeout(() => {
                this.sendCommand(this.OP_CODES.MOVEMENT_VERIFY, "1")
                    .then(() => {
                        this.log(`✅ MOVEMENT_VERIFY confirmé`, 'success');
                    })
                    .catch(err => {
                        this.log(`❌ Erreur confirmation: ${err.message}`, 'error');
                    });
            }, 100);
        }
        
    } catch (e) {
        this.log(`📥 Notification binaire (${bytes.length} bytes)`, 'received');
    }
}
    
handleStateNotification(event) {
    const state = new TextDecoder('utf-8').decode(event.target.value);
    
    // TOUJOURS LOGGER L'ÉTAT
    this.log(`📊 ÉTAT: ${state}`, 'info');
    
    // Mettre à jour l'affichage dans le HTML
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
        // Hook pour mise à jour UI externe
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

console.log('🎯 Phantom.js chargé (version debug optimisée)');
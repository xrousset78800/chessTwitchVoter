/**
 * 🎯 PHANTOM CHESS INTEGRATION (Version sans UI auto-générée)
 * Module pour synchroniser l'échiquier Phantom avec l'échiquier virtuel
 * L'interface utilisateur est gérée par le formulaire de configuration
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
        
        // OpCodes (alignés avec phantom_debug.html)
        this.OP_CODES = {
            GAME_START: 0,
            GAME_END: 1,
            MOVEMENT: 2,
            BOARD_STATE: 6,
            CALIBRATION: 7,
            SIDE: 10,
            BLE_MOVE_DONE: 12,
            SNAPTOCENTERCOM: 13,
            RESET_DETECTION: 14  // ⭐ CRUCIAL : C'est celui-ci qu'on utilise avec FEN
        };
        
        this.OP_CODE_NAMES = {
            0: 'GAME_START', 1: 'GAME_END', 2: 'MOVEMENT',
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
        
        console.log('🎯 PhantomChessboard initialisé (version formulaire)');
    }
    
    /**
     * ========== CONNEXION ==========
     */
    
    async connect() {
        if (!navigator.bluetooth) {
            this.log('❌ Web Bluetooth non supporté', 'error');
            alert('Web Bluetooth non supporté par ce navigateur. Utilisez Chrome ou Edge.');
            return false;
        }
        
        try {
            this.log('🔍 Recherche de l\'échiquier Phantom...', 'info');
            
            // Demander la connexion BLE
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'Phantom' }],
                optionalServices: [this.SERVICE_UUID]
            });
            
            this.log(`📱 Connexion à ${this.device.name}...`, 'info');
            
            // Connexion GATT
            this.server = await this.device.gatt.connect();
            this.service = await this.server.getPrimaryService(this.SERVICE_UUID);
            
            // Récupérer les caractéristiques
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
                    this.log(`✓ Caractéristique ${key} OK`, 'info');
                } catch (e) {
                    this.log(`⚠ Caractéristique ${key} non disponible`, 'warn');
                }
            }
            
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
            
            // Gérer la déconnexion
            this.device.addEventListener('gattserverdisconnected', () => {
                this.log('⚠️ Échiquier déconnecté', 'warn');
                this.isConnected = false;
                this.enabled = false;
                this.updateUI(false);
            });
            
            return true;
            
        } catch (error) {
            this.log(`❌ Erreur de connexion: ${error.message}`, 'error');
            return false;
        }
    }
    
    async disconnect() {
        if (this.device && this.device.gatt.connected) {
            this.device.gatt.disconnect();
            this.isConnected = false;
            this.enabled = false;
            this.log('🔌 Déconnecté', 'info');
            this.updateUI(false);
        }
    }
    
    /**
     * ========== ENVOI DE COMMANDES ==========
     */
    
    async sendCommand(opCode, data = '') {
        if (!this.isConnected || !this.characteristics.game) {
            this.log('❌ Échiquier non connecté', 'error');
            return false;
        }
        
        try {
            const message = String.fromCharCode(opCode) + data;
            const encoded = new TextEncoder().encode(message);
            await this.characteristics.game.writeValue(encoded);
            
            const opName = this.OP_CODE_NAMES[opCode] || 'UNK';
            if (data.length < 100) {
                this.log(`📤 [${opName}] "${data}"`, 'sent');
            } else {
                this.log(`📤 [${opName}] (FEN longue)`, 'sent');
            }
            return true;
        } catch (error) {
            this.log(`❌ Erreur envoi: ${error.message}`, 'error');
            return false;
        }
    }
    
    /**
     * ========== SYNCHRONISATION POSITION ==========
     * 🎯 C'EST LA FONCTION PRINCIPALE !
     * Envoie un FEN à l'échiquier via RESET_DETECTION
     */
    async syncPosition(fen) {
        if (!this.enabled || !this.isConnected) {
            console.log('⚠️ Phantom non connecté, sync ignorée');
            return false;
        }
        
        // Éviter d'envoyer la même position deux fois
        if (fen === this.lastFenSent) {
            console.log('⏭️ FEN identique, envoi ignoré');
            return true;
        }
        
        this.log(`♟️ Synchronisation: ${fen}`, 'info');
        
        // ⭐ RESET_DETECTION avec FEN (comme les boutons Tests FEN de debug)
        const success = await this.sendCommand(this.OP_CODES.RESET_DETECTION, fen);
        
        if (success) {
            this.lastFenSent = fen;
            this.log('✅ Position synchronisée avec l\'échiquier', 'success');
        }
        
        return success;
    }
    
    /**
     * ========== GESTION DES NOTIFICATIONS ==========
     */
    
    handleGameNotification(event) {
        const value = event.target.value;
        const decoder = new TextDecoder('utf-8');
        const bytes = new Uint8Array(value.buffer);
        
        try {
            const strValue = decoder.decode(value);
            const opCode = bytes[0];
            const opName = this.OP_CODE_NAMES[opCode] || 'UNK';
            const dataStr = strValue.substring(1);
            
            if (dataStr.trim() && dataStr.length < 100) {
                this.log(`📥 [${opName}] "${dataStr}"`, 'received');
            } else if (dataStr.trim()) {
                this.log(`📥 [${opName}] (longue)`, 'received');
            } else {
                this.log(`📥 [${opName}]`, 'received');
            }
            
            // Si c'est un mouvement détecté sur l'échiquier physique
            if (opCode === this.OP_CODES.BLE_MOVE_DONE) {
                this.log(`🎯 Coup détecté sur échiquier: ${dataStr}`, 'info');
                // TODO: Si besoin, synchroniser vers le virtuel
            }
            
        } catch (e) {
            this.log(`📥 Notification binaire`, 'received');
        }
    }
    
    handleStateNotification(event) {
        const state = new TextDecoder('utf-8').decode(event.target.value);
        this.log(`📊 État: ${state}`, 'info');
    }
    
    handleBatteryNotification(event) {
        const batteryData = new TextDecoder('utf-8').decode(event.target.value);
        const [percentage] = batteryData.split(',');
        this.log(`🔋 Batterie: ${percentage}%`, 'info');
        
        // Mettre à jour l'UI si un élément existe
        const batteryEl = document.getElementById('phantom-battery');
        if (batteryEl) {
            batteryEl.textContent = `🔋 ${percentage}%`;
        }
    }
    
    /**
     * ========== COMMANDES UTILES ==========
     */
    
    async startGame() {
        const INITIAL_MATRIX = '...........rp....PR..np....PN..bp....PB..qp....PQ..kp....PK..bp....PB..np....PN..rp....PR...........,W';
        return await this.sendCommand(this.OP_CODES.GAME_START, INITIAL_MATRIX);
    }
    
    async endGame() {
        return await this.sendCommand(this.OP_CODES.GAME_END);
    }
    
    async selectSide(side) {
        // 0 = 2 joueurs, 1 = Board, 2 = BLE
        return await this.sendCommand(this.OP_CODES.SIDE, side.toString());
    }
    
    async calibrate() {
        return await this.sendCommand(this.OP_CODES.CALIBRATION);
    }
    
    /**
     * ========== UTILITAIRES ==========
     */
    
    log(message, type = 'info') {
        const prefix = {
            'info': 'ℹ️',
            'success': '✅',
            'error': '❌',
            'warn': '⚠️',
            'sent': '📤',
            'received': '📥'
        }[type] || 'ℹ️';
        
        console.log(`${prefix} [Phantom] ${message}`);
    }
    
    /**
     * Mise à jour de l'interface utilisateur
     * Cette fonction sera override par le script du formulaire
     */
    updateUI(connected) {
        // Stub - sera remplacé par le code du formulaire
        console.log(`UI Update: ${connected ? 'Connecté' : 'Déconnecté'}`);
    }
    
    /**
     * Active/désactive le Phantom
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        this.log(enabled ? '🟢 Phantom activé' : '🔴 Phantom désactivé', 'info');
    }
    
    isEnabled() {
        return this.enabled && this.isConnected;
    }
}

// ========== INSTANCE GLOBALE ==========
window.phantomChessboard = new PhantomChessboard();

// ========== FONCTION DE SYNC (appelée par moveAction) ==========
function syncPhantomPosition() {
    // Vérifier que le Phantom est actif et connecté
    if (!window.phantomChessboard || !window.phantomChessboard.isEnabled()) {
        return;
    }
    
    // Vérifier que l'auto-sync est activée
    const autoSyncCheckbox = document.getElementById('phantom-auto-sync');
    if (autoSyncCheckbox && !autoSyncCheckbox.checked) {
        return;
    }
    
    // Récupérer le FEN de la position actuelle
    if (typeof chess !== 'undefined') {
        const currentFen = chess.fen();
        window.phantomChessboard.syncPosition(currentFen);
    }
}

// ========== FONCTION DE TEST ==========
function testPhantomSync() {
    if (typeof chess !== 'undefined') {
        const fen = chess.fen();
        console.log('🧪 Test de synchronisation avec FEN:', fen);
        window.phantomChessboard.syncPosition(fen);
    } else {
        alert('Aucune partie en cours pour tester');
    }
}

console.log('🎯 Module Phantom Chessboard chargé (version formulaire)');
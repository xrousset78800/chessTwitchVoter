# phantom_bridge.py - Pont entre votre app web et le Phantom via Bluetooth
# Nécessite: pip install bleak flask flask-cors

import asyncio
from flask import Flask, request, jsonify
from flask_cors import CORS
from bleak import BleakClient, BleakScanner

app = Flask(__name__)
CORS(app)

class PhantomBridge:
    def __init__(self):
        # UUIDs officiels du Phantom
        self.SERVICE_UUID = 'fd31a840-22e7-11eb-adc1-0242ac120002'
        self.UUID_GAME = 'cc68a66e-3bfa-4614-a77f-f46954a4c103'
        self.UUID_SETSTATE = 'acb6543c-92ca-11ee-b9d1-0242ac120002'
        self.BATTERY_CHAR = '7b204548-40c4-11eb-adc1-0242ac120002'

        self.client = None
        self.is_connected = False
        self.device_address = None
        self.battery_level = 0
        self.last_state = ""

    async def scan_for_phantom(self):
        print("🔍 Recherche du plateau Phantom...")
        devices = await BleakScanner.discover(timeout=10.0)
        for device in devices:
            if device.name and ('phantom' in device.name.lower() or 'chess' in device.name.lower()):
                print(f"📱 Phantom trouvé: {device.name} ({device.address})")
                return device.address
        print("❌ Aucun Phantom trouvé")
        return None

    async def connect(self, address=None):
        if not address:
            address = await self.scan_for_phantom()
            if not address:
                return False

        self.device_address = address
        self.client = BleakClient(address)

        print(f"🔗 Connexion à {address}...")
        await self.client.connect()

        # Vérifier que le service existe
        services = await self.client.get_services()
        if self.SERVICE_UUID.lower() not in [s.uuid.lower() for s in services]:
            print("❌ Service Phantom non trouvé")
            return False

        # S'abonner aux notifications de statut
        try:
            await self.client.start_notify(self.UUID_SETSTATE, self.on_status_notification)
            print("📡 Notifications de statut activées")
        except Exception as e:
            print(f"⚠️ Impossible d'activer les notifications: {e}")

        self.is_connected = True
        print("✅ Phantom connecté avec succès!")

        # Lire le niveau de batterie
        await self.read_battery()
        return True

    def on_status_notification(self, sender, data):
        try:
            self.last_state = data.decode('utf-8')
            print(f"📡 Statut Phantom: {self.last_state}")
        except Exception as e:
            print(f"❌ Erreur décodage statut: {e}")

    async def send_command(self, opcode: int, data_str: str = ""):
        """Envoyer une commande au Phantom avec OpCode et chaîne de données"""
        if not self.is_connected or not self.client:
            return False
        try:
            payload = bytes([opcode]) + data_str.encode('utf-8')
            await self.client.write_gatt_char(self.UUID_GAME, payload)
            print(f"🎯 Commande envoyée: OpCode={opcode}, Data='{data_str}'")
            return True
        except Exception as e:
            print(f"❌ Erreur envoi commande: {e}")
            return False

    # --------------------- Commandes principales ---------------------
    async def start_game(self, matrix_str: str, color: str = "W"):
        """Démarrer une nouvelle partie"""
        return await self.send_command(0x00, f"{matrix_str},{color}")

    async def select_side(self, side: int):
        """Sélectionner quel côté joue: 0=2 joueurs, 1=board, 2=BLE"""
        return await self.send_command(0x0A, str(side))

    async def move(self, from_square: str, to_square: str, promotion: str = ""):
        """Envoyer un mouvement depuis l'appli ou pour test"""
        data = f"M 1 {from_square}-{to_square} {promotion}".strip()
        return await self.send_command(0x02, data)

    async def game_end(self):
        """Terminer la partie"""
        return await self.send_command(0x01)

    async def calibration(self):
        """Calibrer le plateau"""
        return await self.send_command(0x07)

    async def snap_to_center(self):
        """Centrer toutes les pièces sur leurs cases"""
        return await self.send_command(0x0D)

    async def reset_detection(self, fen: str):
        """Réinitialiser la position du plateau selon FEN"""
        return await self.send_command(0x0E, fen)

    async def read_battery(self):
        if not self.is_connected:
            return 0
        try:
            data = await self.client.read_gatt_char(self.BATTERY_CHAR)
            self.battery_level = int.from_bytes(data, byteorder='little') if data else 0
            print(f"🔋 Batterie: {self.battery_level}%")
            return self.battery_level
        except Exception as e:
            print(f"❌ Erreur lecture batterie: {e}")
            return 0

    async def disconnect(self):
        if self.client and self.is_connected:
            try:
                await self.client.disconnect()
                print("👋 Phantom déconnecté")
            except Exception as e:
                print(f"❌ Erreur déconnexion: {e}")
        self.is_connected = False
        self.client = None

# Instance globale
phantom = PhantomBridge()

# --------------------- API Flask ---------------------
@app.route('/phantom/status', methods=['GET'])
def get_status():
    return jsonify({
        'connected': phantom.is_connected,
        'battery': phantom.battery_level,
        'last_state': phantom.last_state,
        'address': phantom.device_address
    })

@app.route('/phantom/connect', methods=['POST'])
def connect_phantom():
    data = request.get_json() or {}
    address = data.get('address')
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        success = loop.run_until_complete(phantom.connect(address))
        return jsonify({'success': success})
    finally:
        loop.close()

@app.route('/phantom/disconnect', methods=['POST'])
def disconnect_phantom():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(phantom.disconnect())
        return jsonify({'success': True})
    finally:
        loop.close()

@app.route('/phantom/start', methods=['POST'])
def start_game():
    data = request.get_json() or {}
    matrix = data.get('matrix')
    color = data.get('color', 'W')
    if not matrix:
        return jsonify({'error': 'Missing matrix parameter'}), 400
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        success = loop.run_until_complete(phantom.start_game(matrix, color))
        return jsonify({'success': success})
    finally:
        loop.close()

@app.route('/phantom/side', methods=['POST'])
def select_side():
    data = request.get_json() or {}
    side = data.get('side')
    if side is None:
        return jsonify({'error': 'Missing side parameter'}), 400
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        success = loop.run_until_complete(phantom.select_side(int(side)))
        return jsonify({'success': success})
    finally:
        loop.close()

@app.route('/phantom/move', methods=['POST'])
def move():
    data = request.get_json() or {}
    from_sq = data.get('from')
    to_sq = data.get('to')
    promotion = data.get('promotion', '')
    if not from_sq or not to_sq:
        return jsonify({'error': 'Missing from/to parameters'}), 400
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        success = loop.run_until_complete(phantom.move(from_sq, to_sq, promotion))
        return jsonify({'success': success})
    finally:
        loop.close()

@app.route('/phantom/end', methods=['POST'])
def end_game():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        success = loop.run_until_complete(phantom.game_end())
        return jsonify({'success': success})
    finally:
        loop.close()

@app.route('/phantom/scan', methods=['GET'])
def scan_devices():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        address = loop.run_until_complete(phantom.scan_for_phantom())
        return jsonify({'found': address is not None, 'address': address})
    finally:
        loop.close()

if __name__ == '__main__':
    print("🚀 Démarrage du pont Phantom...")
    app.run(host='localhost', port=5000, debug=True)

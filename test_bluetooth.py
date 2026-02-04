# test_bluetooth.py - Test simple pour vérifier Bluetooth
import asyncio
import sys

try:
    from bleak import BleakScanner
    print("✅ Bleak importé avec succès")
except ImportError:
    print("❌ Erreur: pip install bleak")
    sys.exit(1)

async def test_bluetooth():
    try:
        print("🔍 Test du scanner Bluetooth...")
        
        # Test basique - juste démarrer le scanner
        devices = await BleakScanner.discover(timeout=5.0)
        
        print(f"✅ Scanner fonctionnel ! {len(devices)} appareils trouvés:")
        
        for device in devices:
            print(f"  📱 {device.name or 'Sans nom'} ({device.address})")
            
        return True
        
    except Exception as e:
        print(f"❌ Erreur Bluetooth: {e}")
        print("\n🔧 Solutions possibles:")
        
        if "permission" in str(e).lower():
            print("  - Lancez avec sudo (Linux)")
            print("  - Autorisez Bluetooth pour Python (macOS)")
            print("  - Lancez en Administrateur (Windows)")
            
        elif "turned on" in str(e).lower():
            print("  - Vérifiez que Bluetooth est activé")
            print("  - Redémarrez le service Bluetooth")
            
        elif "not found" in str(e).lower():
            print("  - Installez les pilotes Bluetooth")
            print("  - Vérifiez l'adaptateur Bluetooth")
            
        return False

if __name__ == "__main__":
    print("🧪 Test Bluetooth pour Phantom")
    print("=" * 40)
    
    # Vérifications système
    import platform
    print(f"OS: {platform.system()} {platform.release()}")
    print(f"Python: {sys.version}")
    
    # Test async
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        success = loop.run_until_complete(test_bluetooth())
        
        if success:
            print("\n🎉 Bluetooth fonctionne ! Vous pouvez lancer phantom_bridge.py")
        else:
            print("\n❌ Problème Bluetooth à résoudre avant d'utiliser Phantom")
            
    except Exception as e:
        print(f"❌ Erreur critique: {e}")
        
    finally:
        try:
            loop.close()
        except:
            pass
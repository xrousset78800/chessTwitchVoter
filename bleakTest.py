from bleak import BleakClient

address = "XX:XX:XX:XX:XX:XX"  # Adresse MAC de ton plateau
UUID = "0000ffe1-0000-1000-8000-00805f9b34fb"

async def send_move():
    async with BleakClient(address) as client:
        await client.write_gatt_char(UUID, b"e2e4")  # Exemple d’un coup

import asyncio
asyncio.run(send_move())
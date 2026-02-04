lass PhantomChessboard {
    constructor() {
        this.device = null;
        this.server = null;
        this.writeChar = null;
        this.readChar = null;
    }

    log(...args) {
        console.log("[Phantom]", ...args);
    }

    async connect() {
        this.device = await navigator.bluetooth.requestDevice({
            filters: [{ namePrefix: "Phantom" }],
            optionalServices: [0xffe0]
        });

        this.server = await this.device.gatt.connect();
        const service = await this.server.getPrimaryService(0xffe0);

        this.writeChar = await service.getCharacteristic(0xffe1);
        this.readChar = await service.getCharacteristic(0xffe2);

        await this.readChar.startNotifications();
        this.readChar.addEventListener("characteristicvaluechanged", e => {
            const text = new TextDecoder().decode(e.target.value);
            this.log("RX:", text);
        });

        this.log("BLE CONNECTED");
    }

    async send(cmd, data = "") {
        const msg = `${cmd} ${data}`.trim();
        this.log("TX:", msg);
        await this.writeChar.writeValue(new TextEncoder().encode(msg));
    }

    // -------- CLEAN API --------

    async setBLEMode() {
        return this.send(10, "2");
    }

    async setFEN(fen) {
        return this.send(1, fen);
    }

    async gameStart() {
        return this.send(31); // START
    }

    async move(from, to) {
        return this.send(2, `M 1 ${from}-${to} E`);
    }
}

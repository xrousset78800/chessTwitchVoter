/**
 * Vue réelle sans Twitch : la caméra de la régie passe par le serveur du site.
 *
 * - CamSender (régie) : filme la caméra choisie, compresse dans le navigateur
 *   (WebCodecs, H.264 sinon VP8) et envoie les morceaux par la connexion socket.io
 *   déjà ouverte. Image clé toutes les 2 s ; si le réseau ne suit pas, on saute des
 *   images puis on repart d'une image clé.
 * - CamPlayer (viewers) : décode les morceaux relayés par le serveur et les peint
 *   dans un <canvas>. Un trou dans la numérotation (morceau perdu) fait attendre
 *   la prochaine image clé plutôt que d'afficher une image cassée.
 *
 * Le serveur ne décode rien : il vérifie l'émetteur (login de la régie), la taille
 * et le débit, garde le groupe d'images depuis la dernière clé pour les nouveaux
 * venus, et relaie.
 */

export const CAM_QUALITIES = {
    low:  { width: 640,  height: 360, fps: 10, bitrate: 350_000 },
    mid:  { width: 960,  height: 540, fps: 15, bitrate: 800_000 },
    high: { width: 1280, height: 720, fps: 20, bitrate: 1_500_000 }
};
const KEY_EVERY_MS = 1000;   // un viewer en retard ou qui arrive rattrape le direct à la clé suivante
export const CAM_ZOOM = { min: 1, max: 4, step: 0.1 };
const MAX_IN_FLIGHT = 4;   // morceaux envoyés sans accusé de réception : au-delà, le réseau ne suit pas

export const camSupported = {
    send: () => typeof VideoEncoder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
    play: () => typeof VideoDecoder !== 'undefined'
};

/** Caméras disponibles (les noms n'apparaissent qu'après une première autorisation) */
export async function listCameras() {
    try {
        const all = await navigator.mediaDevices.enumerateDevices();
        return all.filter(d => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: d.label || window.tt('ui.cam.n', { n: i + 1 }) }));
    } catch { return []; }
}

async function pickCodec(width, height, bitrate, framerate) {
    const base = { width, height, bitrate, framerate, latencyMode: 'realtime' };
    const tries = [
        { ...base, codec: 'avc1.42E01F', avc: { format: 'annexb' } },   // H.264 baseline, paramètres dans chaque image clé
        { ...base, codec: 'avc1.42001F', avc: { format: 'annexb' } },
        { ...base, codec: 'vp8' }
    ];
    for (const cfg of tries) {
        try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch {}
    }
    return null;
}

export class CamSender {
    constructor(socket, onStatus = () => {}) {
        this.socket = socket;
        this.onStatus = onStatus;
        this.active = false;
        this.info = null;
    }

    setSocket(socket) { this.socket = socket; }

    async start({ deviceId = '', quality = 'mid', zoom = 1 } = {}) {
        this.stop(true);
        const q = CAM_QUALITIES[quality] || CAM_QUALITIES.mid;
        if (!camSupported.send()) throw new Error('Navigateur sans WebCodecs : utilise Chrome ou Edge');
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: q.width }, height: { ideal: q.height }, frameRate: { ideal: q.fps } }
        });
        const track = stream.getVideoTracks()[0];
        const st = track.getSettings();
        // Dimensions paires (H.264), sans dépasser la qualité demandée
        const scale = Math.min(1, q.width / (st.width || q.width), q.height / (st.height || q.height));
        const width = Math.max(16, Math.floor((st.width || q.width) * scale / 2) * 2);
        const height = Math.max(16, Math.floor((st.height || q.height) * scale / 2) * 2);
        const cfg = await pickCodec(width, height, q.bitrate, q.fps);
        if (!cfg) { track.stop(); throw new Error(window.tt('ui.cam.noCodec')); }

        this.stream = stream;
        this.track = track;
        this.cfg = cfg;
        this.q = q;
        this.active = true;
        this.inFlight = 0;
        this.needKey = true;
        this.lastKey = 0;
        this.lastFrame = 0;
        this.sent = 0;
        this.dropped = 0;
        this.capAt = new Map();   // horodatage de l'image -> heure de capture (mesure du retard de bout en bout)
        this.encMs = 0;
        this.info = { width, height, fps: q.fps, codec: cfg.codec.startsWith('avc1') ? 'H.264' : 'VP8', label: track.label };
        this.zoomCaps = (() => { try { return track.getCapabilities?.().zoom || null; } catch { return null; } })();
        this.crop = 1;
        await this.setZoom(zoom);

        this.encoder = new VideoEncoder({
            output: (chunk) => this.send(chunk),
            error: (e) => { this.onStatus({ error: e.message }); this.stop(); }
        });
        this.encoder.configure(cfg);
        this.announce();
        track.addEventListener('ended', () => { this.onStatus({ error: window.tt('ui.cam.unplugged') }); this.stop(); });

        // Lecture des images : MediaStreamTrackProcessor (Chrome/Edge, continue onglet en arrière-plan),
        // sinon une vidéo cachée lue à intervalle régulier
        if (typeof MediaStreamTrackProcessor !== 'undefined') {
            const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
            this.reader = reader;
            (async () => {
                while (this.active && this.reader === reader) {
                    const { value: frame, done } = await reader.read().catch(() => ({ done: true }));
                    if (done) break;
                    this.encode(frame);
                }
            })();
        } else {
            const video = document.createElement('video');
            video.muted = true; video.playsInline = true; video.srcObject = stream;
            await video.play().catch(() => {});
            this.video = video;
            this.interval = setInterval(() => {
                if (video.readyState < 2) return;
                this.encode(new VideoFrame(video, { timestamp: Math.round(performance.now() * 1000) }));
            }, Math.round(1000 / q.fps));
        }
        this.onStatus({ live: true, info: this.info });
        return this.info;
    }

    /**
     * Zoom en direct, sans relancer la caméra : optique si la caméra le permet (Chrome/Edge),
     * le reste en recadrant le centre de l'image avant compression.
     */
    async setZoom(z) {
        z = Math.min(CAM_ZOOM.max, Math.max(CAM_ZOOM.min, Number(z) || 1));
        this.zoom = z;
        let hw = 1;
        const c = this.zoomCaps;
        if (c && this.track && c.max > c.min) {
            const base = c.min > 0 ? c.min : 1;
            const want = Math.min(c.max, Math.max(c.min, base * z));
            try {
                await this.track.applyConstraints({ advanced: [{ zoom: want }] });
                hw = want / base;
            } catch { hw = 1; }
        }
        this.crop = Math.max(1, z / hw);
        if (this.info) this.info.zoom = { value: z, optical: hw > 1.01 };
        return this.info?.zoom;
    }

    /** Image recadrée au centre (zoom numérique), aux dimensions de l'encodeur */
    cropped(frame) {
        const w = this.cfg.width, h = this.cfg.height;
        if (!this.canvas) { this.canvas = new OffscreenCanvas(w, h); this.ctx2d = this.canvas.getContext('2d'); }
        if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
        const fw = frame.displayWidth, fh = frame.displayHeight;
        const sw = fw / this.crop, sh = fh / this.crop;
        this.ctx2d.drawImage(frame, (fw - sw) / 2, (fh - sh) / 2, sw, sh, 0, 0, w, h);
        return new VideoFrame(this.canvas, { timestamp: frame.timestamp });
    }

    /** (Re)présente le flux au serveur : début de diffusion, ou reconnexion */
    announce() {
        if (!this.active || !this.socket) return;
        this.needKey = true;
        this.inFlight = 0;
        this.socket.emit('h24:cam:start', { codec: this.cfg.codec, w: this.cfg.width, h: this.cfg.height });
    }

    encode(frame) {
        try {
            const now = performance.now();
            const enc = this.encoder;
            if (!this.active || !enc || enc.state !== 'configured' || now - this.lastFrame < 1000 / this.q.fps - 4) return;
            // Réseau saturé ou encodeur en retard : on saute l'image, la suivante sera une image clé
            if (this.inFlight > MAX_IN_FLIGHT || enc.encodeQueueSize > 2) { this.needKey = true; this.dropped++; return; }
            this.lastFrame = now;
            const key = this.needKey || now - this.lastKey >= KEY_EVERY_MS;
            if (key) { this.lastKey = now; this.needKey = false; }
            this.capAt.set(frame.timestamp, Date.now());
            if (this.capAt.size > 60) this.capAt.delete(this.capAt.keys().next().value);
            if (this.crop > 1.001) {
                const out = this.cropped(frame);
                try { enc.encode(out, { keyFrame: key }); } finally { out.close(); }
            } else enc.encode(frame, { keyFrame: key });
        } finally {
            frame.close();
        }
    }

    send(chunk) {
        if (!this.active || !this.socket?.connected) { this.needKey = true; return; }
        const data = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(data);
        this.inFlight++;
        this.sent++;
        const w = this.capAt?.get(chunk.timestamp) || Date.now();
        this.capAt?.delete(chunk.timestamp);
        this.encMs = this.encMs * 0.9 + (Date.now() - w) * 0.1;
        this.socket.timeout(5000).emit('h24:cam:chunk', { k: chunk.type === 'key' ? 1 : 0, t: chunk.timestamp, w }, data, (err, ok) => {
            this.inFlight = Math.max(0, this.inFlight - 1);
            if (err || ok === false) this.needKey = true;
        });
    }

    stop(silent = false) {
        const was = this.active;
        this.active = false;
        try { this.reader?.cancel(); } catch {}
        this.reader = null;
        clearInterval(this.interval);
        this.interval = null;
        if (this.video) { this.video.srcObject = null; this.video = null; }
        try { if (this.encoder?.state !== 'closed') this.encoder?.close(); } catch {}
        this.encoder = null;
        this.stream?.getTracks().forEach(t => t.stop());
        this.stream = null;
        this.track = null;
        if (was) this.socket?.emit('h24:cam:stop');
        if (!silent) this.onStatus({ live: false });
    }
}

export class CamPlayer {
    constructor(canvas, onState = () => {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onState = onState;
        this.decoder = null;
        this.lastFrameAt = 0;
    }

    configure(cfg) {
        this.close();
        if (!camSupported.play()) { this.onState('unsupported'); return; }
        this.cfg = cfg;
        this.waitKey = true;
        this.lastSeq = 0;
        this.capAt = new Map();
        this.lagMs = null;
        const decoder = new VideoDecoder({
            output: (frame) => {
                if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
                    this.canvas.width = frame.displayWidth;
                    this.canvas.height = frame.displayHeight;
                }
                this.ctx.drawImage(frame, 0, 0);
                // Retard de bout en bout (capture -> affichage), exact quand régie et viewer sont sur le même PC
                const w = this.capAt.get(frame.timestamp);
                if (w) { this.capAt.delete(frame.timestamp); const lag = Date.now() - w; this.lagMs = this.lagMs == null ? lag : this.lagMs * 0.85 + lag * 0.15; }
                frame.close();
                if (!this.lastFrameAt) this.onState('playing');
                this.lastFrameAt = performance.now();
            },
            error: () => { this.configure(this.cfg); }   // décodeur cassé : on repart à la prochaine image clé
        });
        VideoDecoder.isConfigSupported({ codec: cfg.codec }).then(({ supported }) => {
            if (this.decoder !== decoder) return;
            if (!supported) { this.onState('unsupported'); this.close(); return; }
            decoder.configure({ codec: cfg.codec, codedWidth: cfg.w, codedHeight: cfg.h, optimizeForLatency: true });
            this.ready = true;
            for (const c of this.early.splice(0)) this.push(c.meta, c.data);
        }).catch(() => this.onState('unsupported'));
        this.decoder = decoder;
        this.ready = false;
        this.early = [];
        this.lastFrameAt = 0;
        this.onState('waiting');
    }

    push(meta, data) {
        const d = this.decoder;
        if (!d) return;
        if (!this.ready) { if (this.early.length < 120) this.early.push({ meta, data }); return; }
        if (d.state !== 'configured') return;
        if (this.lastSeq && meta.s !== this.lastSeq + 1) this.waitKey = true;   // morceau perdu en route
        this.lastSeq = meta.s;
        if (this.waitKey && !meta.k) return;
        // En retard (décodeur engorgé) : on saute jusqu'à la prochaine clé plutôt que d'accumuler du retard
        if (d.decodeQueueSize > 3) { this.waitKey = true; return; }
        this.waitKey = false;
        if (meta.w) { this.capAt.set(meta.t, meta.w); if (this.capAt.size > 60) this.capAt.delete(this.capAt.keys().next().value); }
        try {
            d.decode(new EncodedVideoChunk({ type: meta.k ? 'key' : 'delta', timestamp: meta.t, data }));
        } catch { this.waitKey = true; }
    }

    /** Plus d'image depuis un moment (réseau, régie partie) */
    stalled(ms = 4000) { return !!this.decoder && (!this.lastFrameAt || performance.now() - this.lastFrameAt > ms); }

    close() {
        try { if (this.decoder && this.decoder.state !== 'closed') this.decoder.close(); } catch {}
        this.decoder = null;
        this.ready = false;
        this.early = [];
    }
}

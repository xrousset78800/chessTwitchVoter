/**
 * Qui pilote le Phantom ? Un seul mode à la fois : partie Tournoi suivie, régie 24/24 ou partie lancée depuis Nouveau.
 *
 * Chaque mode s'enregistre (libellé, actif ou non, adresse, pages où il s'affiche). Toutes les positions
 * envoyées au Phantom passent par ici : si un autre mode actif le pilote déjà, on demande avant de basculer
 * (l'échiquier physique serait entièrement remis à une autre position). Depuis une page en arrière-plan,
 * rien n'est envoyé ni demandé. Un refus vaut jusqu'à un clic sur « Synchroniser » ou la fin de l'autre mode.
 *
 * Le même registre sert à l'entrée « Partie en cours » du menu.
 */
(function () {
    const modes = new Map();   // id -> { label(), active(), url(), pages: [] }
    const declined = new Set();
    const seen = {};           // id -> dernière fois qu'on était sur sa page pendant qu'il tournait
    let pending = null;        // { src, p } : question en cours

    const tr = (key, params, fallback) => {
        const v = window.i18n?.t?.(key, params || {});
        if (v && v !== key) return v;
        return String(fallback).replace(/\{(\w+)\}/g, (_, k) => params?.[k] ?? '');
    };
    const page = () => document.body?.dataset.page || '';
    const isActive = id => { try { return !!modes.get(id)?.active(); } catch { return false; } };
    const labelOf = id => { try { return modes.get(id)?.label() || id; } catch { return id; } };

    const PO = {
        owner: null,
        src: null,

        register(id, def) { modes.set(id, { pages: [], ...def, id }); },

        /** Action explicite (Synchroniser, choix dans une fenêtre) : ce mode prend la main */
        claim(id) { PO.owner = id; declined.delete(id); },

        /** Un autre mode actif pilote le Phantom ? Son libellé, sinon null */
        conflictWith(id) {
            const cur = PO.owner;
            if (!cur || cur === id || !isActive(cur) || !window.phantomChessboard?.isConnected) return null;
            return labelOf(cur);
        },

        /** Envoie une position au nom d'un mode (passe par le contrôle) */
        sync(id, fen) {
            const p = window.phantomChessboard;
            if (!p) return Promise.resolve(false);
            PO.src = id;
            return p.syncPosition(fen);
        },

        /** Ce mode peut-il envoyer sa position ? Demande à l'utilisateur en cas de conflit sur la page affichée */
        gate(id) {
            const cur = PO.owner;
            if (!cur || cur === id || !isActive(cur)) { PO.claim(id); return Promise.resolve(true); }
            if (declined.has(id)) return Promise.resolve(false);
            if (!(modes.get(id)?.pages || []).includes(page())) return Promise.resolve(false);
            if (pending?.src === id) return pending.p;
            if (pending) return Promise.resolve(false);
            const p = ask(id, cur).then(ok => {
                pending = null;
                if (ok) PO.claim(id); else declined.add(id);
                return ok;
            });
            pending = { src: id, p };
            return p;
        },

        /** Ce qui tourne en ce moment, pour l'entrée « Partie en cours » du menu */
        current() {
            const here = page();
            const act = [...modes.values()].filter(m => isActive(m.id));
            for (const m of act) if (m.pages.includes(here)) seen[m.id] = Date.now();
            if (!act.length) return null;
            const own = window.phantomChessboard?.isConnected && act.find(m => m.id === PO.owner);
            const m = own || act.sort((a, b) => (seen[b.id] || 0) - (seen[a.id] || 0))[0];
            let url = '';
            try { url = m.url(); } catch { /* adresse inconnue */ }
            return { id: m.id, label: labelOf(m.id), url, pages: m.pages, here: m.pages.includes(here) };
        },
    };

    // ── Fenêtre « Basculer le Phantom ? » ──
    function ask(next, cur) {
        let modal = document.getElementById('modal-phantom-owner');
        if (!modal) {
            modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.id = 'modal-phantom-owner';
            modal.innerHTML = `<div class="modal modal--follow" role="dialog" aria-modal="true" aria-labelledby="poTitle">
                <div class="modal__header">
                    <h2 class="modal__title" id="poTitle"><i class="fas fa-triangle-exclamation"></i> <span></span></h2>
                    <button class="modal__close" data-po="keep" aria-label="×">&times;</button>
                </div>
                <div class="modal__body"><p class="po-text"></p><p class="form-hint po-hint"></p></div>
                <div class="modal__footer po-actions">
                    <button class="btn" data-po="keep"></button>
                    <button class="btn btn--primary" data-po="switch"></button>
                </div></div>`;
            document.body.appendChild(modal);
        }
        const nextLabel = labelOf(next), curLabel = labelOf(cur);
        modal.querySelector('#poTitle span').textContent = tr('phantomOwner.title', null, 'Phantom déjà utilisé');
        modal.querySelector('.po-text').textContent = tr('phantomOwner.text', { cur: curLabel, next: nextLabel },
            'Le Phantom suit actuellement « {cur} ». Le basculer sur « {next} » ? L\'échiquier physique sera entièrement remis à la nouvelle position.');
        modal.querySelector('.po-hint').textContent = tr('phantomOwner.hint', null,
            'Si tu le laisses, cette page n\'enverra rien au Phantom tant que tu ne cliques pas sur « Synchroniser ».');
        modal.querySelector('[data-po="switch"]').textContent = tr('phantomOwner.switch', null, 'Basculer le Phantom');
        modal.querySelector('.po-actions [data-po="keep"]').textContent = tr('phantomOwner.keep', { cur: curLabel }, 'Laisser sur « {cur} »');
        modal.classList.add('is-active');
        return new Promise(resolve => {
            const done = ok => {
                modal.classList.remove('is-active');
                modal.removeEventListener('click', onClick);
                document.removeEventListener('keydown', onKey);
                resolve(ok);
            };
            const onClick = e => {
                const b = e.target.closest('[data-po]');
                if (b) done(b.dataset.po === 'switch');
                else if (e.target === modal) done(false);
            };
            const onKey = e => { if (e.key === 'Escape') done(false); };
            modal.addEventListener('click', onClick);
            document.addEventListener('keydown', onKey);
        });
    }

    // ── Toutes les positions envoyées au Phantom passent par le contrôle (par défaut : la partie de l'app) ──
    const p = window.phantomChessboard;
    if (p && !p.__ownerGate) {
        const orig = p.syncPosition.bind(p);
        p.syncPosition = function (fen, ...rest) {
            const src = PO.src || 'game';
            PO.src = null;
            if (!p.isConnected) return orig(fen, ...rest);
            return PO.gate(src).then(ok => {
                if (!ok) { console.log(`🔒 Phantom piloté par « ${labelOf(PO.owner)} » : position de « ${labelOf(src)} » non envoyée`); return false; }
                return orig(fen, ...rest);
            });
        };
        p.__ownerGate = true;
    }

    window.PhantomOwner = PO;
})();

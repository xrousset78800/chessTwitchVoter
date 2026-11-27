/**
 * Page Succès : niveau, XP et pions du compte, puis les succès par catégorie
 * (débloqués, en cours avec leur progression, secrets masqués tant qu'ils sont verrouillés).
 * Pastille niveau + pions dans la barre du haut (.nav__level), mise à jour avec le compte.
 */
const tr = (key, params) => window.i18n?.t?.(key, params) ?? key;
const t = (key, params) => tr(`achievements.${key}`, params);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const locale = () => window.i18n?.locale?.() || 'fr-FR';
const fmtNum = (n) => Number(n || 0).toLocaleString(locale());
const fmtDate = (ts) => new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
const TIER_ICON = { B: 'fa-medal', A: 'fa-medal', O: 'fa-medal', P: 'fa-gem', S: 'fa-user-secret' };

/** Nom d'une récompense : objet du menu Pièces ou titre */
function rewardLabel(id) {
    if (id.startsWith('title-')) return t(`rewards.${id}`);
    if (['flat', 'neon', 'token'].includes(id)) return `${tr('pieces.title')} ${tr(`pieces.${id}`)}`;
    return `${tr('pieces.boardTitle')} ${tr(`pieces.board.${id}`)}`;
}

function levelBlock(acc) {
    if (!acc && window.twitchAuth?.isLoggedIn) {
        return `<div class="ach-level ach-level--guest"><i class="fas fa-spinner fa-spin"></i><p>${esc(t('loading'))}</p></div>`;
    }
    if (!acc) {
        return `<div class="ach-level ach-level--guest">
            <i class="fab fa-twitch"></i>
            <p>${esc(t('loginHint'))}</p>
            <button class="btn btn--sm btn--primary" data-ach-login>${esc(tr('twitch.connect'))}</button>
        </div>`;
    }
    const pct = acc.max ? 100 : Math.min(100, Math.round((acc.levelXp / Math.max(1, acc.nextXp)) * 100));
    return `<div class="ach-level">
        <div class="ach-level__badge"><span>${esc(t('level'))}</span><b>${acc.level}</b></div>
        <div class="ach-level__main">
            <div class="ach-level__bar"><span style="width:${pct}%"></span></div>
            <div class="ach-level__xp">${acc.max ? esc(t('levelMax')) : esc(t('xpToNext', { xp: fmtNum(acc.levelXp), next: fmtNum(acc.nextXp) }))}</div>
        </div>
        <div class="ach-level__stat"><b>♟ ${fmtNum(acc.coins)}</b><span>${esc(t('coins'))}</span></div>
        <div class="ach-level__stat"><b>🔥 ${fmtNum(acc.streak)}</b><span>${esc(t('streak'))}</span></div>
    </div>`;
}

let rules = null;   // gains par palier (/api/economy/rules), pour afficher la récompense à récupérer
const rewardOf = (def) => rules?.achievement?.[def.tier] || rules?.achievement?.B || null;

/** Récompense du succès (XP et pions), en bas à droite de la carte */
function gainTag(def, done, toClaim) {
    const r = rewardOf(def);
    if (!r) return '';
    const icon = toClaim ? 'fa-gift' : done ? 'fa-check' : 'fa-star';
    return `<span class="ach-card__gain"><i class="fas ${icon}"></i> +${fmtNum(r.xp)} XP · +${fmtNum(r.coins)} ♟</span>`;
}

function card(def, done, stats, toClaim) {
    const hidden = def.secret && !done;
    const name = hidden ? t('secretName') : t(`list.${def.id}.name`);
    const desc = hidden ? t('secretDesc') : t(`list.${def.id}.desc`);
    let progress = '';
    if (!done && def.stat && def.goal > 1) {
        const v = Math.min(def.goal, stats[def.stat] || 0);
        progress = `<div class="ach-card__progress" title="${fmtNum(v)} / ${fmtNum(def.goal)}">
            <span style="width:${Math.round((v / def.goal) * 100)}%"></span></div>
            <div class="ach-card__count">${fmtNum(v)} / ${fmtNum(def.goal)}</div>`;
    }
    const reward = def.reward && !hidden
        ? `<div class="ach-card__reward"><i class="fas fa-gift"></i> ${esc(rewardLabel(def.reward))}</div>` : '';
    const claimAttrs = toClaim ? ` data-ach-claim="${esc(def.id)}" role="button" tabindex="0" title="${esc(t('claim'))}"` : '';
    return `<li class="ach-card ach-tier--${def.tier}${done ? ' is-done' : ''}${hidden ? ' is-secret' : ''}${toClaim ? ' is-claimable' : ''}"${claimAttrs}>
        <div class="ach-card__icon"><i class="fas ${done || !hidden ? TIER_ICON[def.tier] : 'fa-question'}"></i></div>
        <div class="ach-card__body">
            <div class="ach-card__head">
                <span class="ach-card__name">${esc(name)}</span>
                <span class="ach-card__tier">${esc(t(`tier.${def.tier}`))}</span>
            </div>
            <div class="ach-card__desc">${esc(desc)}</div>
            ${progress}${reward}
            <div class="ach-card__foot">
                ${done ? `<span class="ach-card__date"><i class="fas fa-check"></i> ${esc(fmtDate(done))}</span>` : '<span></span>'}
                ${gainTag(def, done, toClaim)}
            </div>
        </div>
    </li>`;
}

const AchievementsPage = {
    async init() {
        const root = document.getElementById('achievements-root');
        if (!root) return;
        const defs = await window.achievements?.ready;
        if (!defs) { root.innerHTML = `<div class="rec-empty">${esc(t('unavailable'))}</div>`; return; }
        this.render();
        if (!rules) {
            fetch('/api/economy/rules').then(r => r.json()).then(d => { rules = d.rules; if (isActive()) this.render(); }).catch(() => {});
        }
        const page = document.getElementById('page-achievements') || root;
        if (!page.dataset.claimBound) {
            page.dataset.claimBound = '1';
            page.addEventListener('click', e => {
                const b = e.target.closest('[data-ach-claim], [data-ach-claim-all]');
                if (b) this.claim(b.dataset.achClaimAll != null ? window.achievements.toClaim() : [b.dataset.achClaim], b);
            });
            page.addEventListener('keydown', e => {
                const b = (e.key === 'Enter' || e.key === ' ') && e.target.closest?.('li[data-ach-claim]');
                if (b) { e.preventDefault(); this.claim([b.dataset.achClaim], b); }
            });
        }
    },

    /** Récupère les récompenses : XP, pions et objets arrivent sur le compte */
    async claim(ids, btn) {
        if (!ids.length || this.claiming) return;
        this.claiming = true;
        if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
        try {
            const { claimed, gain } = await window.achievements.claim(ids);
            if (claimed?.length && window.AppToast) {
                const parts = [`+${fmtNum(gain.xp)} XP`, `+${fmtNum(gain.coins + (gain.daily || 0))} ♟`];
                if (gain.items?.length) parts.push(gain.items.map(rewardLabel).join(', '));
                window.AppToast.show(`<b>${esc(t('claimedToast', { n: claimed.length }))}</b> ${esc(parts.join(' · '))}`, 'success', 5000);
            }
        } catch (e) {
            console.warn('🏆 Récompense non récupérée :', e.message);
            window.AppToast?.show(esc(t('claimError')), 'error', 4000);
            if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
        } finally {
            this.claiming = false;
        }
    },

    render() {
        const root = document.getElementById('achievements-root');
        const defs = window.achievements?.defs;
        if (!root || !defs) return;
        const acc = window.economy?.account || null;
        const unlocked = window.achievements.unlocked();
        const stats = acc?.stats || {};
        const total = defs.list.length;
        const doneCount = defs.list.filter(d => unlocked[d.id]).length;
        const pending = new Set(window.achievements.toClaim());

        // En haut à droite, à côté du titre : niveau, compteur de succès, « Tout récupérer »
        const top = document.getElementById('achievements-top');
        const topHTML = levelBlock(acc)
            + `<div class="ach-summary"><span>${esc(t('count', { n: doneCount, total }))}</span>`
            + (pending.size ? `<button type="button" class="btn btn--sm btn--primary ach-claim-all" data-ach-claim-all><i class="fas fa-gift"></i> ${esc(t('claimAll', { n: pending.size }))}</button>` : '')
            + `</div>`;
        if (top) top.innerHTML = topHTML;
        root.innerHTML = (top ? '' : topHTML) +
            defs.categories.map(cat => {
                const items = defs.list.filter(d => d.cat === cat);
                const n = items.filter(d => unlocked[d.id]).length;
                // Pronostics : bilan cumulé de tous les matchs
                const pst = cat === 'predict' && (stats.predictMoves || stats.predictWinners)
                    ? `<p class="ach-cat__stat">${esc(tr('predict.stats', { hits: stats.predictMoveHits || 0, total: stats.predictMoves || 0, streak: stats.predictBestStreak || 0, whits: stats.predictWinnerHits || 0, wtotal: stats.predictWinners || 0 }))}</p>` : '';
                return `<section class="ach-cat">
                    <h2 class="ach-cat__title">${esc(t(`cat.${cat}`))} <span>${n} / ${items.length}</span></h2>${pst}
                    <ul class="ach-grid">${items.map(d => card(d, unlocked[d.id], stats, pending.has(d.id))).join('')}</ul>
                </section>`;
            }).join('');
        (top || root).querySelector('[data-ach-login]')?.addEventListener('click', () => window.twitchAuth?.login());
    },
};

/** Pastille de la barre du haut : niveau et pions (lien vers la page Succès) */
function renderNavLevel() {
    const acc = window.economy?.account;
    // Pastille sur l'icône Succès : récompenses à récupérer
    const n = window.achievements?.toClaim?.().length || 0;
    document.querySelectorAll('.nav__icon[data-navigate="/achievements"]').forEach(a => {
        let dot = a.querySelector('.nav__claim');
        if (!n) { dot?.remove(); return; }
        if (!dot) { dot = document.createElement('span'); dot.className = 'nav__claim'; a.appendChild(dot); }
        if (dot.textContent !== String(n)) dot.textContent = n;
        a.title = `${tr('nav.achievements')} · ${t('toClaim', { n })}`;
    });
    document.querySelectorAll('.nav__level').forEach(el => {
        el.hidden = !acc;
        if (!acc) return;
        const html = `<span class="nav__level-lv">${esc(t('levelShort'))} ${acc.level}</span><span class="nav__level-coins">♟ ${fmtNum(acc.coins)}</span>`;
        if (el._html !== html) { el.innerHTML = html; el._html = html; }
        const title = `${t('level')} ${acc.level} · ${fmtNum(acc.coins)} ${t('coins')}`;
        if (el.title !== title) el.title = title;
    });
}

const isActive = () => document.getElementById('page-achievements')?.classList.contains('is-active');
for (const ev of ['economyChanged', 'achievementsChanged', 'languageChanged']) {
    window.addEventListener(ev, () => {
        renderNavLevel();
        if (isActive()) AchievementsPage.render();
    });
}
renderNavLevel();
window.achievements?.ready?.then(() => renderNavLevel()); // la pastille a besoin du registre

export default AchievementsPage;

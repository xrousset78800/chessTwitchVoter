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

function card(def, done, stats) {
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
    return `<li class="ach-card ach-tier--${def.tier}${done ? ' is-done' : ''}${hidden ? ' is-secret' : ''}">
        <div class="ach-card__icon"><i class="fas ${done || !hidden ? TIER_ICON[def.tier] : 'fa-question'}"></i></div>
        <div class="ach-card__body">
            <div class="ach-card__head">
                <span class="ach-card__name">${esc(name)}</span>
                <span class="ach-card__tier">${esc(t(`tier.${def.tier}`))}</span>
            </div>
            <div class="ach-card__desc">${esc(desc)}</div>
            ${progress}${reward}
            ${done ? `<div class="ach-card__date"><i class="fas fa-check"></i> ${esc(fmtDate(done))}</div>` : ''}
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

        root.innerHTML = levelBlock(acc) +
            `<div class="ach-summary">${esc(t('count', { n: doneCount, total }))}</div>` +
            defs.categories.map(cat => {
                const items = defs.list.filter(d => d.cat === cat);
                const n = items.filter(d => unlocked[d.id]).length;
                return `<section class="ach-cat">
                    <h2 class="ach-cat__title">${esc(t(`cat.${cat}`))} <span>${n} / ${items.length}</span></h2>
                    <ul class="ach-grid">${items.map(d => card(d, unlocked[d.id], stats)).join('')}</ul>
                </section>`;
            }).join('');
        root.querySelector('[data-ach-login]')?.addEventListener('click', () => window.twitchAuth?.login());
    },
};

/** Pastille de la barre du haut : niveau et pions (lien vers la page Succès) */
function renderNavLevel() {
    const acc = window.economy?.account;
    document.querySelectorAll('.nav__level').forEach(el => {
        el.hidden = !acc;
        if (!acc) return;
        el.innerHTML = `<span class="nav__level-lv">${esc(t('levelShort'))} ${acc.level}</span><span class="nav__level-coins">♟ ${fmtNum(acc.coins)}</span>`;
        el.title = `${t('level')} ${acc.level} · ${fmtNum(acc.coins)} ${t('coins')}`;
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

export default AchievementsPage;

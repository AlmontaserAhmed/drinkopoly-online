(() => {
  const CATEGORY_LABELS = {
    never: 'Never Have I Ever',
    truth_dare: 'Truth or Dare',
    categories: 'Categories',
    most_likely: 'Most Likely To',
    rhyme: 'Rhyme Time',
    waterfall: 'Waterfall',
    chaos: 'Chaos',
    rest: 'Rest',
    start: 'Start'
  };
  const CATEGORY_EMOJI = {
    start: '🏁', never: '🍸', truth_dare: '🎭', categories: '💬',
    most_likely: '👉', rhyme: '🎵', waterfall: '🌊', chaos: '⚡', rest: '💤'
  };
  const CATEGORY_IDS = ['never', 'truth_dare', 'categories', 'most_likely', 'rhyme', 'waterfall'];

  const AVATAR_LIST = ['crown', 'flame', 'skull', 'star', 'bolt', 'diamond', 'paw', 'rocket'];
  const COLOR_LIST = ['#e6483c', '#3ca7e6', '#3ce67a', '#e6c53c', '#b23ce6', '#e68c3c', '#3ce6d8', '#e63c9d'];
  const AVATAR_SVG = {
    crown: '<svg viewBox="0 0 24 24"><polygon points="3,18 3,9 8,13 12,5 16,13 21,9 21,18" fill="currentColor"/></svg>',
    flame: '<svg viewBox="0 0 24 24"><path d="M12 2c-4 5-7 8-7 12a7 7 0 0 0 14 0c0-3-2-5-3-7 0 2-1 3-2 3-1-1 0-4-2-8z" fill="currentColor"/></svg>',
    skull: '<svg viewBox="0 0 24 24"><circle cx="12" cy="10" r="7" fill="currentColor"/><circle cx="9" cy="10" r="1.6" fill="#1a1428"/><circle cx="15" cy="10" r="1.6" fill="#1a1428"/><rect x="9" y="15" width="6" height="4" rx="1" fill="currentColor"/></svg>',
    star: '<svg viewBox="0 0 24 24"><polygon points="12,2 14.9,8.6 22,9.3 16.7,14 18.2,21 12,17.3 5.8,21 7.3,14 2,9.3 9.1,8.6" fill="currentColor"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><polygon points="13,2 4,14 11,14 9,22 20,9 12,9" fill="currentColor"/></svg>',
    diamond: '<svg viewBox="0 0 24 24"><polygon points="12,2 20,12 12,22 4,12" fill="currentColor"/></svg>',
    paw: '<svg viewBox="0 0 24 24"><circle cx="12" cy="15" r="5" fill="currentColor"/><circle cx="5" cy="9" r="2.3" fill="currentColor"/><circle cx="10" cy="4.3" r="2.3" fill="currentColor"/><circle cx="14" cy="4.3" r="2.3" fill="currentColor"/><circle cx="19" cy="9" r="2.3" fill="currentColor"/></svg>',
    rocket: '<svg viewBox="0 0 24 24"><path d="M12 2c3 2.2 5 6 5 10 0 2-.7 3.8-1.7 5l-1 3-2.3-2-2.3 2-1-3C7.7 15.8 7 14 7 12c0-4 2-7.8 5-10z" fill="currentColor"/><circle cx="12" cy="10.5" r="1.6" fill="#1a1428"/></svg>'
  };
  function avatarSVG(name) { return AVATAR_SVG[name] || AVATAR_SVG.star; }

  const ITEM_DEFS = [
    { key: 'shield', icon: '🛡️', label: 'Shield', desc: 'Blocks the next bad Chaos effect aimed at you.' },
    { key: 'payback', icon: '🎯', label: 'Payback', desc: 'Make someone else drink 2, right now.' },
    { key: 'extra', icon: '⏩', label: 'Extra Turn', desc: 'Take a bonus turn after this one.' }
  ];

  let session = JSON.parse(localStorage.getItem('drinkopoly-session') || 'null');
  let pollTimer = null;
  let deckState = null;
  let animLock = false;

  const $ = (id) => document.getElementById(id);
  const screens = ['home', 'lobby', 'game', 'over'];

  function showScreen(name) {
    for (const s of screens) $(`screen-${s}`).classList.toggle('active', s === name);
  }

  function saveSession() { localStorage.setItem('drinkopoly-session', JSON.stringify(session)); }
  function clearSession() { session = null; localStorage.removeItem('drinkopoly-session'); }

  async function api(path, method, body) {
    const opts = { method, headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  function authedBody(extra) {
    return Object.assign({ playerId: session.playerId, token: session.token }, extra || {});
  }

  // ---------- Sound (synthesized, zero external assets) ----------
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let actx = null;
  let soundOn = JSON.parse(localStorage.getItem('drinkopoly-sound') ?? 'true');
  function ensureAudio() {
    if (!AudioCtx) return null;
    if (!actx) actx = new AudioCtx();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone(freq, duration, type, delay, gainVal) {
    if (!soundOn) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime + (delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainVal ?? 0.15, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + duration + 0.03);
  }
  function sfxRoll() { for (let i = 0; i < 5; i++) tone(280 + Math.random() * 220, 0.06, 'square', i * 0.08, 0.07); }
  function sfxLand() { tone(660, 0.12, 'triangle', 0, 0.18); tone(880, 0.18, 'triangle', 0.08, 0.14); }
  function sfxChaos() { tone(160, 0.32, 'sawtooth', 0, 0.2); tone(110, 0.38, 'sawtooth', 0.1, 0.18); }
  function sfxItem() { tone(520, 0.1, 'sine', 0, 0.15); tone(760, 0.15, 'sine', 0.06, 0.12); }
  function sfxClick() { tone(420, 0.05, 'square', 0, 0.05); }
  function sfxWin() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', i * 0.12, 0.15)); }

  function setSoundIcon() {
    const label = soundOn ? '🔊' : '🔇';
    $('btn-sound-lobby').textContent = label;
    $('btn-sound-game').textContent = label;
  }
  function toggleSound() {
    soundOn = !soundOn;
    localStorage.setItem('drinkopoly-sound', JSON.stringify(soundOn));
    setSoundIcon();
    if (soundOn) { ensureAudio(); sfxClick(); }
  }
  $('btn-sound-lobby').addEventListener('click', toggleSound);
  $('btn-sound-game').addEventListener('click', toggleSound);
  setSoundIcon();

  // ---------- Perimeter board math ----------
  function perimeterCoords(n) {
    let w = 3;
    while (4 * w - 4 < n) w++;
    const coords = [];
    for (let c = 0; c < w; c++) coords.push([0, c]);
    for (let r = 1; r < w; r++) coords.push([r, w - 1]);
    for (let c = w - 2; c >= 0; c--) coords.push([w - 1, c]);
    for (let r = w - 2; r >= 1; r--) coords.push([r, 0]);
    return { w, coords };
  }

  // ---------- Home screen ----------
  $('btn-create').addEventListener('click', async () => {
    ensureAudio();
    const name = $('create-name').value.trim();
    if (!name) return ($('home-error').textContent = 'Enter your name first.');
    try {
      const data = await api('/api/rooms', 'POST', { name });
      session = { roomCode: data.roomCode, playerId: data.playerId, token: data.token };
      saveSession();
      render(data.state);
      startPolling();
    } catch (e) { $('home-error').textContent = e.message; }
  });

  $('btn-join').addEventListener('click', async () => {
    ensureAudio();
    const code = $('join-code').value.trim().toUpperCase();
    const name = $('join-name').value.trim();
    if (!code || !name) return ($('home-error').textContent = 'Enter a room code and your name.');
    try {
      const data = await api(`/api/rooms/${code}/join`, 'POST', { name });
      session = { roomCode: code, playerId: data.playerId, token: data.token };
      saveSession();
      render(data.state);
      startPolling();
    } catch (e) { $('home-error').textContent = e.message; }
  });

  // ---------- Lobby screen ----------
  $('btn-copy-link').addEventListener('click', async () => {
    const url = `${location.origin}/room/${session.roomCode}`;
    try { await navigator.clipboard.writeText(url); flashHint('btn-copy-link', 'Copied!'); }
    catch { prompt('Copy this link:', url); }
  });
  function flashHint(btnId, text) {
    const btn = $(btnId);
    const original = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = original; }, 1400);
  }

  function renderDeckToggles(deckConfig, isHost) {
    const wrap = $('deck-toggles');
    wrap.innerHTML = '';
    for (const id of CATEGORY_IDS) {
      const chip = document.createElement('div');
      const on = !!deckConfig.enabledCategories[id];
      chip.className = 'toggle-chip' + (on ? ' on' : '') + (isHost ? '' : ' disabled');
      chip.textContent = `${CATEGORY_EMOJI[id]} ${CATEGORY_LABELS[id]}`;
      chip.addEventListener('click', () => toggleCategory(id, !on));
      wrap.appendChild(chip);
    }
    const chaosChip = document.createElement('div');
    const chaosOn = deckConfig.chaosEnabled !== false;
    chaosChip.className = 'toggle-chip' + (chaosOn ? ' on' : '') + (isHost ? '' : ' disabled');
    chaosChip.textContent = '⚡ Chaos Events';
    chaosChip.addEventListener('click', () => toggleChaos(!chaosOn));
    wrap.appendChild(chaosChip);
  }
  async function toggleCategory(id, value) {
    if (session.playerId !== deckState.hostPlayerId) return;
    sfxClick();
    try { const data = await api(`/api/rooms/${session.roomCode}/deck`, 'POST', authedBody({ enabledCategories: { [id]: value } })); render(data.state); }
    catch (e) { $('deck-error').textContent = e.message; }
  }
  async function toggleChaos(value) {
    if (session.playerId !== deckState.hostPlayerId) return;
    sfxClick();
    try { const data = await api(`/api/rooms/${session.roomCode}/deck`, 'POST', authedBody({ chaosEnabled: value })); render(data.state); }
    catch (e) { $('deck-error').textContent = e.message; }
  }

  function renderAvatarPicker(state) {
    const me = state.players.find((p) => p.id === session.playerId);
    if (!me) return;
    const iconWrap = $('avatar-picker');
    iconWrap.innerHTML = '';
    AVATAR_LIST.forEach((icon) => {
      const el = document.createElement('div');
      el.className = 'icon-choice' + (icon === me.avatarIcon ? ' selected' : '');
      el.innerHTML = avatarSVG(icon);
      el.title = icon;
      el.addEventListener('click', () => updateAvatar({ icon }));
      iconWrap.appendChild(el);
    });
    const colorWrap = $('color-picker');
    colorWrap.innerHTML = '';
    COLOR_LIST.forEach((color) => {
      const el = document.createElement('div');
      el.className = 'color-choice' + ((me.color || '').toLowerCase() === color.toLowerCase() ? ' selected' : '');
      el.style.background = color;
      el.addEventListener('click', () => updateAvatar({ color }));
      colorWrap.appendChild(el);
    });
  }
  async function updateAvatar(payload) {
    sfxClick();
    try { const data = await api(`/api/rooms/${session.roomCode}/avatar`, 'POST', authedBody(payload)); render(data.state); }
    catch (e) { /* silent: cosmetic action */ }
  }

  $('btn-add-custom').addEventListener('click', async () => {
    const category = $('custom-category').value;
    const text = $('custom-text').value.trim();
    if (!text) return;
    try {
      const data = await api(`/api/rooms/${session.roomCode}/custom-challenge`, 'POST', authedBody({ category, text }));
      $('custom-text').value = '';
      $('deck-error').textContent = '';
      render(data.state);
    } catch (e) { $('deck-error').textContent = e.message; }
  });

  $('btn-start').addEventListener('click', async () => {
    try { const data = await api(`/api/rooms/${session.roomCode}/start`, 'POST', authedBody()); render(data.state); }
    catch (e) { $('lobby-hint').textContent = e.message; }
  });

  $('btn-leave-lobby').addEventListener('click', leaveRoom);
  $('btn-leave-game').addEventListener('click', leaveRoom);
  $('btn-leave-over').addEventListener('click', leaveRoom);
  async function leaveRoom() {
    try { await api(`/api/rooms/${session.roomCode}/leave`, 'POST', authedBody()); } catch {}
    stopPolling();
    clearSession();
    showScreen('home');
  }

  // ---------- Game screen ----------
  $('btn-end-game').addEventListener('click', async () => {
    if (!confirm('End the game for everyone?')) return;
    try { const data = await api(`/api/rooms/${session.roomCode}/end`, 'POST', authedBody()); render(data.state); } catch (e) { alert(e.message); }
  });
  $('btn-restart').addEventListener('click', async () => {
    try { const data = await api(`/api/rooms/${session.roomCode}/restart`, 'POST', authedBody()); render(data.state); } catch (e) { alert(e.message); }
  });

  function renderBoard(state) {
    const board = $('board');
    const n = state.board.length;
    const { w, coords } = perimeterCoords(n);
    board.style.gridTemplateColumns = `repeat(${w}, 1fr)`;
    board.style.gridTemplateRows = `repeat(${w}, 1fr)`;
    board.innerHTML = '';

    const byPos = {};
    for (const p of state.players) {
      if (p.isSpectator) continue;
      (byPos[p.position] = byPos[p.position] || []).push(p);
    }

    state.board.forEach((space, idx) => {
      const [r, c] = coords[idx];
      const el = document.createElement('div');
      el.className = `space space-${space.type}`;
      el.style.gridRow = r + 1;
      el.style.gridColumn = c + 1;
      el.title = space.label;

      const icon = document.createElement('div');
      icon.className = 'space-icon';
      icon.textContent = CATEGORY_EMOJI[space.type] || '❔';
      el.appendChild(icon);

      const numEl = document.createElement('div');
      numEl.textContent = idx === 0 ? 'START' : String(idx + 1);
      el.appendChild(numEl);

      const tokens = document.createElement('div');
      tokens.className = 'tokens';
      (byPos[idx] || []).forEach((p) => {
        const t = document.createElement('div');
        t.className = 'token';
        t.style.background = p.color;
        t.title = p.name;
        t.innerHTML = avatarSVG(p.avatarIcon);
        tokens.appendChild(t);
      });
      el.appendChild(tokens);
      board.appendChild(el);
    });

    const center = document.createElement('div');
    center.className = 'board-center';
    center.id = 'board-center';
    board.appendChild(center);
    renderCenterPanel(state);
  }

  function renderCenterPanel(state) {
    const center = $('board-center');
    if (!center) return;
    center.innerHTML = '';
    const current = state.players.find((p) => p.id === state.currentPlayerId);

    const h = document.createElement('h2');
    if (!current) h.textContent = 'Waiting...';
    else if (state.currentPlayerId === session.playerId && !state.activeEvent) h.textContent = '🎲 Your turn!';
    else if (state.activeEvent) h.textContent = `${current.name}'s turn`;
    else h.textContent = `Waiting for ${current.name}...`;
    center.appendChild(h);

    const order = document.createElement('div');
    order.className = 'center-turn-order';
    state.turnOrder.forEach((pid) => {
      const p = state.players.find((pp) => pp.id === pid);
      if (!p) return;
      const dot = document.createElement('div');
      dot.className = 'player-token';
      dot.style.width = '26px'; dot.style.height = '26px';
      dot.style.background = p.color;
      dot.style.opacity = pid === state.currentPlayerId ? '1' : '0.5';
      if (pid === state.currentPlayerId) dot.style.boxShadow = '0 0 0 3px rgba(255,255,255,0.6)';
      dot.title = p.name;
      dot.innerHTML = avatarSVG(p.avatarIcon);
      order.appendChild(dot);
    });
    center.appendChild(order);

    if (state.currentPlayerId === session.playerId && !state.activeEvent) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary center-roll-btn';
      btn.textContent = '🎲 Roll';
      btn.addEventListener('click', () => doRoll(btn));
      center.appendChild(btn);
    } else if (!state.activeEvent) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = current ? `Waiting for ${current.name} to roll...` : '';
      center.appendChild(p);
    }
  }

  async function doRoll(btn) {
    if (btn) btn.disabled = true;
    sfxRoll();
    try {
      const data = await api(`/api/rooms/${session.roomCode}/roll`, 'POST', authedBody());
      animateRollThenRender(data.state);
    } catch (e) { alert(e.message); if (btn) btn.disabled = false; }
  }

  function animateRollThenRender(state) {
    const ev = state.activeEvent;
    animLock = true;
    const modal = $('event-modal');
    modal.hidden = false;
    $('event-badge').textContent = 'Rolling...';
    $('event-text').textContent = '';
    $('event-options').innerHTML = '';
    $('btn-next-turn').hidden = true;
    $('event-hint').textContent = '';
    const die = $('die');
    die.classList.add('rolling');
    const flicker = setInterval(() => { die.dataset.value = String(1 + Math.floor(Math.random() * 6)); }, 90);
    setTimeout(() => {
      clearInterval(flicker);
      die.classList.remove('rolling');
      die.dataset.value = String(ev.roll || 1);
      sfxLand();
      if (ev.category === 'chaos' && !/blocked/i.test(ev.text)) sfxChaos();
      animLock = false;
      render(state);
    }, 650);
  }

  function renderPlayerList(container, state, { showChallenges } = {}) {
    container.innerHTML = '';
    for (const p of state.players) {
      const li = document.createElement('li');
      const tok = document.createElement('div');
      tok.className = 'player-token';
      tok.style.background = p.color;
      tok.innerHTML = avatarSVG(p.avatarIcon);
      const name = document.createElement('div');
      name.className = 'player-name';
      name.textContent = p.name + (p.isSpectator ? ' (watching)' : '');
      const meta = document.createElement('div');
      meta.className = 'player-meta';
      const bits = [];
      if (p.isHost) bits.push('Host');
      if (state.currentPlayerId === p.id) bits.push('Rolling now');
      if (!p.connected) bits.push('offline');
      if (showChallenges && !p.isSpectator) bits.push(`${p.challengesDone} challenges`);
      meta.textContent = bits.join(' · ');
      li.appendChild(tok); li.appendChild(name); li.appendChild(meta);
      container.appendChild(li);
    }
  }

  function renderRules(state) {
    const banner = $('rules-banner');
    const list = $('rules-list');
    if (!state.rules.length) { banner.hidden = true; return; }
    banner.hidden = false;
    list.innerHTML = '';
    for (const r of state.rules) {
      const li = document.createElement('li');
      li.textContent = r;
      list.appendChild(li);
    }
  }

  function renderItems(state) {
    const card = $('items-card');
    const bar = $('items-bar');
    const me = state.players.find((p) => p.id === session.playerId);
    if (!me || me.isSpectator) { card.hidden = true; return; }
    const total = (me.items.shield || 0) + (me.items.payback || 0) + (me.items.extra || 0);
    if (!total) { card.hidden = true; return; }
    card.hidden = false;
    bar.innerHTML = '';
    for (const d of ITEM_DEFS) {
      const count = me.items[d.key] || 0;
      if (!count) continue;
      const btn = document.createElement('button');
      btn.className = 'item-chip';
      btn.title = d.desc;
      btn.innerHTML = `<span class="item-icon">${d.icon}</span><span>${d.label}</span><span class="item-count">${count}</span>`;
      if (d.key === 'extra' && state.currentPlayerId !== session.playerId) { btn.disabled = true; }
      btn.addEventListener('click', () => useItem(d.key));
      bar.appendChild(btn);
    }
  }
  async function useItem(key) {
    if (key === 'payback') { openTargetPicker(); return; }
    sfxItem();
    try { const data = await api(`/api/rooms/${session.roomCode}/item`, 'POST', authedBody({ item: key })); render(data.state); }
    catch (e) { alert(e.message); }
  }
  function openTargetPicker() {
    const modal = $('target-modal');
    const wrap = $('target-options');
    wrap.innerHTML = '';
    const others = (deckState ? deckState.players : []).filter((p) => p.id !== session.playerId && !p.isSpectator);
    for (const p of others) {
      const b = document.createElement('button');
      b.className = 'btn btn-secondary';
      b.textContent = p.name;
      b.addEventListener('click', async () => {
        modal.hidden = true;
        sfxItem();
        try { const data = await api(`/api/rooms/${session.roomCode}/item`, 'POST', authedBody({ item: 'payback', targetPlayerId: p.id })); render(data.state); }
        catch (e) { alert(e.message); }
      });
      wrap.appendChild(b);
    }
    modal.hidden = false;
  }
  $('btn-cancel-target').addEventListener('click', () => { $('target-modal').hidden = true; });

  function renderLog(state) {
    const log = $('game-log');
    log.innerHTML = '';
    for (const entry of state.log.slice().reverse()) {
      const li = document.createElement('li');
      li.textContent = entry.text;
      log.appendChild(li);
    }
  }

  function renderEvent(state) {
    const modal = $('event-modal');
    const ev = state.activeEvent;
    if (!ev) { modal.hidden = true; return; }
    modal.hidden = false;
    $('event-badge').textContent = `${CATEGORY_EMOJI[ev.category] || ''} ${CATEGORY_LABELS[ev.category] || ev.category}`;
    $('die').dataset.value = String(ev.roll || 1);
    $('event-roll').textContent = ev.roll ? `Rolled a ${ev.roll}${ev.lapped ? ' — completed a lap!' : ''}` : '';
    $('event-text').textContent = ev.text;

    const optsWrap = $('event-options');
    optsWrap.innerHTML = '';
    const isActivePlayer = ev.playerId === session.playerId;

    if (ev.requiresChoice) {
      optsWrap.classList.toggle('row', ev.options.length <= 2);
      if (isActivePlayer) {
        for (const opt of ev.options) {
          const b = document.createElement('button');
          b.className = 'btn btn-secondary';
          b.textContent = opt;
          b.addEventListener('click', async () => {
            sfxClick();
            try { const data = await api(`/api/rooms/${session.roomCode}/choice`, 'POST', authedBody({ option: opt })); render(data.state); }
            catch (e) { $('event-hint').textContent = e.message; }
          });
          optsWrap.appendChild(b);
        }
        $('event-hint').textContent = '';
      } else {
        $('event-hint').textContent = `Waiting for ${ev.playerName} to choose...`;
      }
      $('btn-next-turn').hidden = true;
    } else {
      $('btn-next-turn').hidden = false;
      $('event-hint').textContent = 'Anyone can tap Next once the challenge is done.';
    }
  }
  $('btn-next-turn').addEventListener('click', async () => {
    sfxClick();
    try { const data = await api(`/api/rooms/${session.roomCode}/next`, 'POST', authedBody()); render(data.state); }
    catch (e) { $('event-hint').textContent = e.message; }
  });

  function renderOver(state) {
    $('over-stats').innerHTML = '';
    const active = state.players.filter((p) => !p.isSpectator);
    const sorted = active.slice().sort((a, b) => b.challengesDone - a.challengesDone);
    sorted.forEach((p, i) => {
      const li = document.createElement('li');
      const tok = document.createElement('div');
      tok.className = 'player-token'; tok.style.background = p.color; tok.innerHTML = avatarSVG(p.avatarIcon);
      const name = document.createElement('div');
      name.className = 'player-name'; name.textContent = `${i === 0 ? '🏆 ' : ''}${p.name}`;
      const meta = document.createElement('div');
      meta.className = 'player-meta'; meta.textContent = `${p.challengesDone} challenges · ${p.laps} laps`;
      li.appendChild(tok); li.appendChild(name); li.appendChild(meta);
      $('over-stats').appendChild(li);
    });

    const awards = $('awards');
    awards.innerHTML = '';
    if (active.length) {
      const mk = (emoji, title, name) => {
        const div = document.createElement('div');
        div.className = 'award-card';
        div.innerHTML = `<div class="award-emoji">${emoji}</div><div class="award-title">${title}</div><div class="award-name">${name}</div>`;
        awards.appendChild(div);
      };
      const topChallenges = active.slice().sort((a, b) => b.challengesDone - a.challengesDone)[0];
      const topChaos = active.slice().sort((a, b) => b.chaosTriggered - a.chaosTriggered)[0];
      const topLaps = active.slice().sort((a, b) => b.laps - a.laps)[0];
      mk('🏆', 'Champion Drinker', topChallenges.name);
      if (topChaos.chaosTriggered > 0) mk('🌀', 'Most Chaotic', topChaos.name);
      if (topLaps.laps > 0) mk('🏃', 'Fastest Around the Board', topLaps.name);
    }
    $('btn-restart').hidden = state.hostPlayerId !== session.playerId;
  }

  let lastPhaseForSound = null;
  function render(state) {
    if (!state) return;
    deckState = state;

    if (state.phase === 'gameover' && lastPhaseForSound !== 'gameover') sfxWin();
    lastPhaseForSound = state.phase;

    if (state.phase === 'lobby') {
      showScreen('lobby');
      $('lobby-code').textContent = state.code;
      $('lobby-count').textContent = `(${state.players.length})`;
      renderPlayerList($('lobby-players'), state);
      renderAvatarPicker(state);
      const isHost = state.hostPlayerId === session.playerId;
      renderDeckToggles(state.deckConfig, isHost);
      $('btn-start').hidden = !isHost;
      $('btn-start').disabled = state.players.length < 2;
      $('lobby-hint').textContent = isHost
        ? (state.players.length < 2 ? 'Waiting for at least one more player to join...' : 'Ready when you are!')
        : 'Waiting for the host to start the game...';
      $('event-modal').hidden = true;
    } else if (state.phase === 'playing') {
      showScreen('game');
      $('game-code').textContent = state.code;
      const me = state.players.find((p) => p.id === session.playerId);
      $('spectator-banner').hidden = !(me && me.isSpectator);
      renderBoard(state);
      renderRules(state);
      renderItems(state);
      renderPlayerList($('game-players'), state, { showChallenges: true });
      renderLog(state);
      $('btn-end-game').hidden = state.hostPlayerId !== session.playerId;
      renderEvent(state);
    } else if (state.phase === 'gameover') {
      showScreen('over');
      renderOver(state);
      $('event-modal').hidden = true;
    }
  }

  async function poll() {
    if (animLock) return;
    try {
      const data = await api(`/api/rooms/${session.roomCode}/state?playerId=${session.playerId}&token=${session.token}`, 'GET');
      render(data.state);
    } catch (e) {
      stopPolling();
      clearSession();
      showScreen('home');
      $('home-error').textContent = 'Your session ended (room closed or expired). Start a new one!';
    }
  }
  function startPolling() { stopPolling(); poll(); pollTimer = setInterval(poll, 1200); }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  // ---------- Boot ----------
  function boot() {
    const match = location.pathname.match(/^\/room\/([A-Za-z0-9]{4})$/);
    if (match && !session) $('join-code').value = match[1].toUpperCase();
    if (session) { showScreen('lobby'); startPolling(); }
    else showScreen('home');
  }
  boot();
})();

// Drinkopoly Online — zero-dependency Node.js server (no npm install required)
// Plain http server + JSON REST API polled by the client. No external packages.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DECK_PATH = path.join(__dirname, 'decks', 'default-deck.json');
const DEFAULT_DECK = JSON.parse(fs.readFileSync(DECK_PATH, 'utf8'));

const CATEGORY_META = {
  never: { label: 'Never Have I Ever', weight: 5 },
  truth_dare: { label: 'Truth or Dare', weight: 4 },
  categories: { label: 'Categories', weight: 3 },
  most_likely: { label: 'Most Likely To', weight: 4 },
  rhyme: { label: 'Rhyme Time', weight: 3 },
  waterfall: { label: 'Waterfall', weight: 3 }
};
const CATEGORY_IDS = Object.keys(CATEGORY_META);

const PLAYER_COLORS = ['#e6483c', '#3ca7e6', '#3ce67a', '#e6c53c', '#b23ce6', '#e68c3c', '#3ce6d8', '#e63c9d'];
const AVATAR_ICONS = ['crown', 'flame', 'skull', 'star', 'bolt', 'diamond', 'paw', 'rocket'];
const ITEM_TYPES = ['shield', 'payback', 'extra'];

/** rooms: Map<roomCode, Room> */
const rooms = new Map();

function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  } while (rooms.has(code));
  return code;
}

function genId() {
  return crypto.randomBytes(8).toString('hex');
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick(arr) {
  return arr[crypto.randomInt(arr.length)];
}

function nowTs() {
  return Date.now();
}

function newRoom(hostName) {
  const code = generateRoomCode();
  const room = {
    code,
    phase: 'lobby', // lobby | playing | gameover
    createdAt: nowTs(),
    lastActivity: nowTs(),
    hostPlayerId: null,
    players: new Map(), // id -> player
    turnOrder: [],
    currentTurnIndex: 0,
    skipNextPlayer: false,
    board: [],
    deckConfig: {
      enabledCategories: Object.fromEntries(CATEGORY_IDS.map((id) => [id, true])),
      chaosEnabled: true,
      custom: {} // categoryId -> [strings]  (for truth_dare use 'truth' / 'dare' keys, categories -> 'categories', etc.)
    },
    rules: [],
    activeEvent: null, // { spaceIndex, spaceType, category, text, playerId, playerName, requiresChoice, options, resolved }
    log: [],
    winnerLapTarget: 3
  };
  rooms.set(code, room);
  return room;
}

function addLog(room, text) {
  room.log.push({ ts: nowTs(), text });
  if (room.log.length > 60) room.log.shift();
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    avatarIcon: p.avatarIcon,
    isHost: p.isHost,
    isSpectator: p.isSpectator,
    position: p.position,
    laps: p.laps,
    connected: p.connected,
    challengesDone: p.challengesDone,
    chaosTriggered: p.chaosTriggered,
    items: p.items,
    shieldCharges: p.shieldCharges
  };
}

function roomState(room, forPlayerId) {
  return {
    code: room.code,
    phase: room.phase,
    players: [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt).map(publicPlayer),
    hostPlayerId: room.hostPlayerId,
    turnOrder: room.turnOrder,
    currentTurnIndex: room.currentTurnIndex,
    currentPlayerId: room.turnOrder[room.currentTurnIndex] || null,
    board: room.board.map((s) => ({ type: s.type, label: CATEGORY_META[s.type]?.label || (s.type === 'chaos' ? 'Chaos' : s.type === 'start' ? 'Start' : s.type === 'rest' ? 'Rest' : s.type) })),
    deckConfig: room.deckConfig,
    rules: room.rules,
    activeEvent: room.activeEvent,
    log: room.log.slice(-25),
    you: forPlayerId ? publicPlayer(room.players.get(forPlayerId)) : null,
    lastActivity: room.lastActivity
  };
}

function buildBoard(deckConfig) {
  const enabled = CATEGORY_IDS.filter((id) => deckConfig.enabledCategories[id]);
  const pool = [];
  const list = enabled.length ? enabled : CATEGORY_IDS; // never allow an empty board
  for (const id of list) {
    const weight = CATEGORY_META[id].weight;
    for (let i = 0; i < weight; i++) pool.push(id);
  }
  const chaosCount = deckConfig.chaosEnabled === false ? 0 : Math.max(4, Math.round(pool.length * 0.22));
  for (let i = 0; i < chaosCount; i++) pool.push('chaos');

  const shuffled = shuffle(pool);
  const spaces = [{ type: 'start' }, ...shuffled.map((type) => ({ type }))];

  // Pad to a clean square-perimeter length (4w-4) so the client can render a classic
  // Monopoly-style loop with an open center panel, regardless of how many categories are enabled.
  let w = 3;
  while (4 * w - 4 < spaces.length) w++;
  const target = 4 * w - 4;
  while (spaces.length < target) spaces.push({ type: 'rest' });

  return spaces;
}

function poolFor(room, categoryId, subkey) {
  const key = subkey || categoryId;
  const builtin = DEFAULT_DECK[key] || [];
  const custom = (room.deckConfig.custom[key] || []);
  return builtin.concat(custom);
}

function drawCardForSpace(room, space, player) {
  const type = space.type;
  if (type === 'start') {
    return { spaceType: 'start', category: 'start', text: `${player.name} passed Start — everyone give them a cheers!`, playerId: player.id, playerName: player.name, requiresChoice: false, resolved: true };
  }
  if (type === 'never') {
    const text = pick(poolFor(room, 'never'));
    return { spaceType: type, category: 'never', text, playerId: player.id, playerName: player.name, requiresChoice: false, resolved: true };
  }
  if (type === 'truth_dare') {
    return { spaceType: type, category: 'truth_dare', text: `${player.name}, choose your fate...`, playerId: player.id, playerName: player.name, requiresChoice: true, options: ['Truth', 'Dare'], resolved: false };
  }
  if (type === 'categories') {
    const topics = shuffle(poolFor(room, 'categories')).slice(0, 4);
    return { spaceType: type, category: 'categories', text: `${player.name}, pick a category topic:`, playerId: player.id, playerName: player.name, requiresChoice: true, options: topics, resolved: false };
  }
  if (type === 'most_likely') {
    const text = pick(poolFor(room, 'most_likely'));
    return { spaceType: type, category: 'most_likely', text: `${text} Everyone point at once — whoever gets the most points, drinks 2!`, playerId: player.id, playerName: player.name, requiresChoice: false, resolved: true };
  }
  if (type === 'rhyme') {
    const word = pick(poolFor(room, 'rhyme'));
    return { spaceType: type, category: 'rhyme', text: `Rhyme Time! Starting word: "${word}". Go around the turn order rhyming with it — first to stall or repeat drinks 2.`, playerId: player.id, playerName: player.name, requiresChoice: false, resolved: true };
  }
  if (type === 'waterfall') {
    const text = pick(poolFor(room, 'waterfall', 'waterfall'));
    return { spaceType: type, category: 'waterfall', text, playerId: player.id, playerName: player.name, requiresChoice: false, resolved: true };
  }
  if (type === 'chaos') {
    const builtinChaos = DEFAULT_DECK.chaos || [];
    const customChaos = (room.deckConfig.custom.chaos || []).map((t) => ({ type: 'CUSTOM', text: t }));
    const event = pick(builtinChaos.concat(customChaos));
    return { spaceType: type, category: 'chaos', text: event.text, playerId: player.id, playerName: player.name, requiresChoice: false, resolved: true, chaosType: event.type, ruleText: event.ruleText };
  }
  if (type === 'rest') {
    const text = pick(DEFAULT_DECK.rest || ['Quiet space. Take a breather (or a sip, your call).']);
    return { spaceType: type, category: 'rest', text, playerId: player.id, playerName: player.name, requiresChoice: false, resolved: true };
  }
  return { spaceType: type, category: type, text: 'Nothing happens. Take a breather.', playerId: player.id, playerName: player.name, requiresChoice: false, resolved: true };
}

function grantItem(player, item) {
  player.items[item] = Math.min(2, (player.items[item] || 0) + 1);
}

function applyChaosEffect(room, event, player) {
  switch (event.chaosType) {
    case 'REVERSE_ORDER': {
      const currentId = room.turnOrder[room.currentTurnIndex];
      room.turnOrder = room.turnOrder.slice().reverse();
      room.currentTurnIndex = room.turnOrder.indexOf(currentId);
      break;
    }
    case 'SKIP_NEXT':
      room.skipNextPlayer = true;
      break;
    case 'SWAP_POSITIONS': {
      const others = [...room.players.values()].filter((p) => p.id !== player.id && p.connected && !p.isSpectator);
      if (others.length) {
        const other = pick(others);
        const tmp = player.position;
        player.position = other.position;
        other.position = tmp;
      }
      break;
    }
    case 'MOVE_FORWARD_3':
      player.position = (player.position + 3) % room.board.length;
      break;
    case 'MOVE_BACK_3':
      if (player.shieldCharges > 0) {
        player.shieldCharges -= 1;
        event.text += ' ...but their Shield blocked it!';
        event.shielded = true;
      } else {
        player.position = (player.position - 3 + room.board.length) % room.board.length;
      }
      break;
    case 'RULE_CHANGE_NO_NAMES':
    case 'RULE_CHANGE_NO_POINTING':
    case 'RULE_CHANGE_OFFHAND':
      if (event.ruleText) room.rules.push(event.ruleText);
      break;
    case 'BONUS_LAP':
      room.bonusRollFor = player.id;
      break;
    case 'ITEM_SHIELD':
      grantItem(player, 'shield');
      break;
    case 'ITEM_PAYBACK':
      grantItem(player, 'payback');
      break;
    case 'ITEM_EXTRA':
      grantItem(player, 'extra');
      break;
    default:
      break; // flavor-text-only effects: ALL_DRINK, EVERYONE_ELSE_DRINKS, RANDOM_TOAST, DOUBLE_OR_NOTHING, SPOTLIGHT, FREEZE
  }
}

function currentPlayer(room) {
  const id = room.turnOrder[room.currentTurnIndex];
  return room.players.get(id);
}

function advanceTurn(room) {
  if (!room.turnOrder.length) return;
  const n = room.turnOrder.length;
  let steps = 1;
  if (room.skipNextPlayer) {
    room.skipNextPlayer = false;
    const nextIdx = (room.currentTurnIndex + 1) % n;
    const nextPlayer = room.players.get(room.turnOrder[nextIdx]);
    if (nextPlayer && nextPlayer.shieldCharges > 0) {
      nextPlayer.shieldCharges -= 1;
      addLog(room, `${nextPlayer.name}'s Shield blocked a skipped turn!`);
      steps = 1;
    } else {
      steps = 2;
    }
  }
  room.currentTurnIndex = (room.currentTurnIndex + steps) % n;
}

// ---------- HTTP plumbing ----------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1e6) { reject(new Error('Body too large')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function requireRoom(res, code) {
  const room = rooms.get((code || '').toUpperCase());
  if (!room) { sendJson(res, 404, { error: 'Room not found' }); return null; }
  return room;
}

function authPlayer(res, room, playerId, token) {
  const player = room.players.get(playerId);
  if (!player || player.token !== token) { sendJson(res, 403, { error: 'Not authorized for this room' }); return null; }
  return player;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = rel.split('?')[0];
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback to index.html for unknown routes (e.g. /room/ABCD)
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, data2) => {
        if (err2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(data2);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] !== 'api') {
    if (req.method === 'GET') return serveStatic(req, res, url.pathname);
    res.writeHead(405); return res.end();
  }

  try {
    // POST /api/rooms
    if (parts.length === 2 && parts[1] === 'rooms' && req.method === 'POST') {
      const body = await readBody(req);
      const name = (body.name || 'Player').toString().slice(0, 24).trim() || 'Player';
      const room = newRoom(name);
      const playerId = genId();
      const token = genId();
      const player = {
        id: playerId, token, name, color: PLAYER_COLORS[0], avatarIcon: AVATAR_ICONS[0], isHost: true, isSpectator: false,
        position: 0, laps: 0, connected: true, joinedAt: nowTs(), lastSeen: nowTs(), challengesDone: 0, chaosTriggered: 0,
        items: { shield: 0, payback: 0, extra: 0 }, shieldCharges: 0
      };
      room.players.set(playerId, player);
      room.hostPlayerId = playerId;
      addLog(room, `${name} created the room.`);
      return sendJson(res, 200, { roomCode: room.code, playerId, token, state: roomState(room, playerId) });
    }

    // Routing for /api/rooms/:code/*
    if (parts[1] === 'rooms' && parts.length >= 3) {
      const code = parts[2];
      const action = parts[3];
      const room = requireRoom(res, code);
      if (!room) return;
      room.lastActivity = nowTs();

      if (action === 'join' && req.method === 'POST') {
        const body = await readBody(req);
        const name = (body.name || 'Player').toString().slice(0, 24).trim() || 'Player';
        const playerId = genId();
        const token = genId();
        const color = PLAYER_COLORS[room.players.size % PLAYER_COLORS.length];
        const avatarIcon = AVATAR_ICONS[room.players.size % AVATAR_ICONS.length];
        const isSpectator = room.phase !== 'lobby';
        const player = {
          id: playerId, token, name, color, avatarIcon, isHost: false, isSpectator,
          position: 0, laps: 0, connected: true, joinedAt: nowTs(), lastSeen: nowTs(), challengesDone: 0, chaosTriggered: 0,
          items: { shield: 0, payback: 0, extra: 0 }, shieldCharges: 0
        };
        room.players.set(playerId, player);
        addLog(room, `${name} ${isSpectator ? 'joined to spectate (game already in progress)' : 'joined the room'}.`);
        return sendJson(res, 200, { playerId, token, state: roomState(room, playerId) });
      }

      if (action === 'state' && req.method === 'GET') {
        const playerId = url.searchParams.get('playerId');
        const token = url.searchParams.get('token');
        const player = room.players.get(playerId);
        if (!player || player.token !== token) return sendJson(res, 403, { error: 'Not authorized' });
        player.connected = true;
        player.lastSeen = nowTs();
        return sendJson(res, 200, { state: roomState(room, playerId) });
      }

      const body = (req.method === 'POST') ? await readBody(req) : {};
      const player = body.playerId ? authPlayer(res, room, body.playerId, body.token) : null;

      if (action === 'avatar' && req.method === 'POST') {
        if (!player) return;
        if (room.phase !== 'lobby') return sendJson(res, 400, { error: 'Cannot change avatar after the game starts' });
        if (AVATAR_ICONS.includes(body.icon)) player.avatarIcon = body.icon;
        if (typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)) player.color = body.color;
        return sendJson(res, 200, { state: roomState(room, player.id) });
      }

      if (action === 'item' && req.method === 'POST') {
        if (!player) return;
        if (room.phase !== 'playing') return sendJson(res, 400, { error: 'Game not in progress' });
        if (player.isSpectator) return sendJson(res, 403, { error: 'Spectators cannot use items' });
        const item = (body.item || '').toString();
        if (!ITEM_TYPES.includes(item)) return sendJson(res, 400, { error: 'Unknown item' });
        if (!player.items[item]) return sendJson(res, 400, { error: 'You do not have that item' });

        if (item === 'shield') {
          player.items.shield -= 1;
          player.shieldCharges = (player.shieldCharges || 0) + 1;
          addLog(room, `${player.name} activated a Shield.`);
        } else if (item === 'payback') {
          const target = room.players.get(body.targetPlayerId);
          if (!target || target.id === player.id || target.isSpectator) return sendJson(res, 400, { error: 'Pick a valid target' });
          player.items.payback -= 1;
          addLog(room, `${player.name} used Payback on ${target.name} — they drink 2!`);
        } else if (item === 'extra') {
          const cp = currentPlayer(room);
          if (!cp || cp.id !== player.id) return sendJson(res, 400, { error: 'You can only use Extra Turn on your own turn' });
          player.items.extra -= 1;
          room.bonusRollFor = player.id;
          addLog(room, `${player.name} used an Extra Turn token — they'll roll again next.`);
        }
        return sendJson(res, 200, { state: roomState(room, player.id) });
      }

      if (action === 'deck' && req.method === 'POST') {
        if (!player) return;
        if (player.id !== room.hostPlayerId) return sendJson(res, 403, { error: 'Only the host can change deck settings' });
        if (room.phase !== 'lobby') return sendJson(res, 400, { error: 'Cannot change deck after start' });
        if (body.enabledCategories && typeof body.enabledCategories === 'object') {
          for (const id of CATEGORY_IDS) {
            if (typeof body.enabledCategories[id] === 'boolean') room.deckConfig.enabledCategories[id] = body.enabledCategories[id];
          }
        }
        if (typeof body.chaosEnabled === 'boolean') room.deckConfig.chaosEnabled = body.chaosEnabled;
        return sendJson(res, 200, { state: roomState(room, player.id) });
      }

      if (action === 'custom-challenge' && req.method === 'POST') {
        if (!player) return;
        const validKeys = ['never', 'truth', 'dare', 'categories', 'most_likely', 'rhyme', 'chaos'];
        const key = validKeys.includes(body.category) ? body.category : null;
        const text = (body.text || '').toString().trim().slice(0, 280);
        if (!key || !text) return sendJson(res, 400, { error: 'Missing category or text' });
        if (!room.deckConfig.custom[key]) room.deckConfig.custom[key] = [];
        if (room.deckConfig.custom[key].length >= 100) return sendJson(res, 400, { error: 'Custom list full' });
        const entry = key === 'chaos' ? text : text; // chaos custom entries are flavor-text only (no state effect)
        room.deckConfig.custom[key].push(entry);
        addLog(room, `${player.name} added a custom ${key.replace('_', ' ')} entry.`);
        return sendJson(res, 200, { state: roomState(room, player.id) });
      }

      if (action === 'start' && req.method === 'POST') {
        if (!player) return;
        if (player.id !== room.hostPlayerId) return sendJson(res, 403, { error: 'Only the host can start the game' });
        if (room.players.size < 2) return sendJson(res, 400, { error: 'Need at least 2 players' });
        if (room.phase !== 'lobby') return sendJson(res, 400, { error: 'Already started' });
        room.board = buildBoard(room.deckConfig);
        room.turnOrder = shuffle([...room.players.values()].filter((p) => !p.isSpectator).map((p) => p.id));
        room.currentTurnIndex = 0;
        for (const p of room.players.values()) {
          p.position = 0; p.laps = 0; p.challengesDone = 0; p.chaosTriggered = 0;
          p.items = { shield: 0, payback: 0, extra: 0 }; p.shieldCharges = 0;
        }
        room.phase = 'playing';
        room.activeEvent = null;
        addLog(room, `Game started! Board has ${room.board.length} spaces. ${room.players.get(room.turnOrder[0]).name} goes first.`);
        return sendJson(res, 200, { state: roomState(room, player.id) });
      }

      if (action === 'roll' && req.method === 'POST') {
        if (!player) return;
        if (room.phase !== 'playing') return sendJson(res, 400, { error: 'Game not in progress' });
        const cp = currentPlayer(room);
        if (!cp || cp.id !== player.id) return sendJson(res, 403, { error: "It's not your turn" });
        if (room.activeEvent && !room.activeEvent.resolved) return sendJson(res, 400, { error: 'Resolve the current event first' });
        if (room.activeEvent) return sendJson(res, 400, { error: 'Advance to the next turn first' });
        const roll = crypto.randomInt(1, 7);
        const boardLen = room.board.length;
        const before = player.position;
        let newPos = before + roll;
        let lapped = false;
        if (newPos >= boardLen) { newPos -= boardLen; lapped = true; player.laps += 1; }
        player.position = newPos;
        const space = room.board[newPos];
        const event = drawCardForSpace(room, space, player);
        event.roll = roll;
        event.lapped = lapped;
        room.activeEvent = event;
        if (event.resolved) player.challengesDone += 1;
        if (event.category === 'chaos') { player.chaosTriggered += 1; applyChaosEffect(room, event, player); }
        addLog(room, `${player.name} rolled a ${roll} and landed on ${CATEGORY_META[space.type]?.label || space.type}${lapped ? ' (completed a lap!)' : ''}.`);
        return sendJson(res, 200, { state: roomState(room, player.id) });
      }

      if (action === 'choice' && req.method === 'POST') {
        if (!player) return;
        if (!room.activeEvent || room.activeEvent.resolved) return sendJson(res, 400, { error: 'No pending choice' });
        if (room.activeEvent.playerId !== player.id) return sendJson(res, 403, { error: 'Only the active player can choose' });
        const option = (body.option || '').toString();
        if (!room.activeEvent.options.includes(option)) return sendJson(res, 400, { error: 'Invalid option' });
        const ev = room.activeEvent;
        if (ev.category === 'truth_dare') {
          const pool = option === 'Truth' ? poolFor(room, 'truth') : poolFor(room, 'dare');
          ev.text = `${option}: ${pick(pool)}`;
        } else if (ev.category === 'categories') {
          ev.text = `Category: "${option}" — go around the turn order naming one each. First to repeat or stall drinks 2!`;
        }
        ev.chosenOption = option;
        ev.requiresChoice = false;
        ev.resolved = true;
        player.challengesDone += 1;
        addLog(room, `${player.name} chose "${option}".`);
        return sendJson(res, 200, { state: roomState(room, player.id) });
      }

      if (action === 'next' && req.method === 'POST') {
        if (!player) return;
        if (room.phase !== 'playing') return sendJson(res, 400, { error: 'Game not in progress' });
        if (!room.activeEvent || !room.activeEvent.resolved) return sendJson(res, 400, { error: 'Current event is not resolved yet' });
        const bonusFor = room.bonusRollFor;
        room.activeEvent = null;
        if (bonusFor) {
          room.bonusRollFor = null;
          const idx = room.turnOrder.indexOf(bonusFor);
          if (idx !== -1) room.currentTurnIndex = idx; // same player rolls again
        } else {
          advanceTurn(room);
        }
        return sendJson(res, 200, { state: roomState(room, player.id) });
      }

      if (action === 'end' && req.method === 'POST') {
        if (!player) return;
        if (player.id !== room.hostPlayerId) return sendJson(res, 403, { error: 'Only the host can end the game' });
        room.phase = 'gameover';
        room.activeEvent = null;
        addLog(room, `${player.name} ended the game.`);
        return sendJson(res, 200, { state: roomState(room, player.id) });
      }

      if (action === 'restart' && req.method === 'POST') {
        if (!player) return;
        if (player.id !== room.hostPlayerId) return sendJson(res, 403, { error: 'Only the host can restart' });
        room.phase = 'lobby';
        room.activeEvent = null;
        room.rules = [];
        room.log = [];
        for (const p of room.players.values()) {
          p.position = 0; p.laps = 0; p.challengesDone = 0; p.chaosTriggered = 0; p.isSpectator = false;
          p.items = { shield: 0, payback: 0, extra: 0 }; p.shieldCharges = 0;
        }
        addLog(room, `${player.name} restarted the room. Back to the lobby.`);
        return sendJson(res, 200, { state: roomState(room, player.id) });
      }

      if (action === 'leave' && req.method === 'POST') {
        if (!player) return;
        player.connected = false;
        addLog(room, `${player.name} left.`);
        return sendJson(res, 200, { ok: true });
      }
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    sendJson(res, 400, { error: err.message || 'Bad request' });
  }
});

// Clean up dead rooms periodically (6h of inactivity)
setInterval(() => {
  const cutoff = nowTs() - 6 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (room.lastActivity < cutoff) rooms.delete(code);
  }
}, 30 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Drinkopoly Online running at http://localhost:${PORT}`);
});

# Drinkopoly Online

A Boardgame-Online-style adventure drinking game, built for playing remotely over a video call. One person hosts, everyone joins from their own phone with a 4-letter room code, and the board/dice/challenges stay in sync for everyone in real time (polling every ~1.2s).

It has **zero external dependencies** — just plain Node.js (`http`, `fs`, `crypto`). No `npm install` needed, no database, nothing that can fail to install.

## How it plays

- **Board**: a real Monopoly-style square loop rendered as a perimeter around an open center panel (the board auto-sizes itself to a clean square no matter how many challenge categories you've enabled) — built for a wide desktop screen, with a big roll button and live turn order sitting in the middle where the "Monopoly" logo would normally go.
- Landing on a space draws a challenge: Never Have I Ever, Truth or Dare, Categories, Most Likely To, Rhyme Time, Waterfall, or a Mario-Party-style **Chaos** space (reverse turn order, skip a turn, swap positions, new house rules for the rest of the game, double-or-nothing, etc).
- **Items**: some Chaos spaces hand out a power-up instead of an effect — 🛡️ **Shield** (blocks the next bad Chaos effect aimed at you), 🎯 **Payback** (make any other player drink 2, whenever you want), ⏩ **Extra Turn** (bank a bonus turn for later). They show up as tappable chips once you have one, so there's a bit of push-your-luck strategy in when to use them.
- **Turns**: one player rolls at a time (animated dice, with sound); everyone else watches the same card pop up live. Anyone can tap "Next turn" once a challenge is done.
- **Spectating**: if someone joins after the game has already started, they're dropped in as a spectator (can watch the board/log, can't roll) instead of being turned away, and become a full player again once the host restarts.
- **Customization (in the lobby, before starting)**: pick your token (8 hand-drawn icons) and color, toggle which challenge categories are in the game, turn Chaos events on/off, and anyone can add their own custom Never Have I Ever lines, truths, dares, category topics, Most Likely To statements, rhyme words, or chaos flavor text. Those get shuffled in alongside the built-in deck.
- **Game over**: host can end the game any time; final screen hands out a few superlative awards (Champion Drinker, Most Chaotic, Fastest Around the Board) plus a full tally, then the host can restart back to the lobby with the same room and deck.
- **Sound**: all sound effects (dice rattle, landing chime, chaos alarm, item ping, victory fanfare) are synthesized in the browser with the Web Audio API — no audio files to load. Mute with the speaker icon top-right.

### A note on the visuals

Everything in this build — the neon board theme, the 8 player token icons, the category glyphs, the dice, the sounds — is original and hand-built directly in the code (CSS + inline SVG + synthesized audio), rather than downloaded art. The sandbox this was built in doesn't have general internet access, so pulling in a third-party asset pack wasn't an option; this way there's also nothing to attribute or license. If you'd rather use a real asset pack (e.g. a free Kenney.nl set), drop image files into `public/` and swap the relevant CSS/`AVATAR_SVG` entries in `public/app.js`.

## Run it locally (to try it out)

```bash
node server.js
```

Then open `http://localhost:3000`. This works for testing but **only devices on your own network can reach it** — for friends in other countries you need to host it publicly (see below).

## Playing with friends who aren't on your network

Pick one:

### Option A — quick one-off game night (easiest, ~2 minutes)
Use a tunnel like [ngrok](https://ngrok.com) to expose your local server:
```bash
node server.js &
ngrok http 3000
```
Ngrok gives you a public `https://...ngrok-free.app` URL — send that to your friends for the night. Free tier is fine; the URL just changes each time you restart it.

### Option B — a permanent link (better if you'll play regularly)
Deploy it to any free Node hosting service, e.g. **Render.com**:
1. Push this folder to a GitHub repo.
2. On Render: New → Web Service → connect the repo.
3. Build command: (leave blank / `npm install` — there's nothing to install, it'll just no-op).
4. Start command: `node server.js`.
5. Render gives you a permanent `https://your-app.onrender.com` URL to share.

Railway, Fly.io, Glitch, or a cheap VPS all work the same way — it's just `node server.js` listening on `process.env.PORT`.

**Note:** game state lives in memory, so redeploying/restarting the server clears any rooms in progress. That's fine for one game night at a time.

## Project structure

```
server.js              — the whole backend: room/game logic + a tiny static file + JSON API server
decks/default-deck.json — all the built-in challenge content (edit this to change the defaults)
public/index.html       — the app shell (home / lobby / game / game-over screens)
public/style.css        — mobile-first dark theme
public/app.js           — client logic: polls room state, renders the board, handles taps
```

## Tweaking the game yourself

- **Add/change built-in content**: edit `decks/default-deck.json` — it's plain JSON with arrays per category, no code changes needed.
- **Change board size/mix**: `CATEGORY_META` weights near the top of `server.js` control how many spaces of each type appear.
- **Add a new Chaos effect**: add an entry to the `chaos` array in the deck JSON (`type`, `text`, optional `ruleText`), then handle its `type` in `applyChaosEffect()` in `server.js` if it should actually change game state (otherwise it's just flavor text everyone reads and self-enforces).

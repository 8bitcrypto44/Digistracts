# Digistracts by 8bitcrypto_44

Contra-style 8-bit HTML side-scroller. Hosted on GitHub Pages; GoDaddy embeds via iframe.

## Play
- Local: open `index.html`
- Live: [https://8bitcrypto44.github.io/Digistracts/](https://8bitcrypto44.github.io/Digistracts/)

## GoDaddy (iframe)
1. Website Builder -> add an **HTML** section
2. Paste **entire** contents of `godaddy_iframe_snippet.html` (same as `digistracts_godaddy_block.html`)
3. Publish -- cover card loads first; **PLAY DIGISTRACTS** expands the hosted game

## Controls
- **PC:** Left/Right or A/D move · Space jumps · Up/W and Down/S aim · FIRE · double-tap Space for air supers
- **Phone:** joystick · JUMP · FIRE; landscape goes full screen like Primal Odyssey
- Volume slider + MUTE / UNMUTE

## Robot enemy types
- **Walker** -- marches in, contact damage
- **Gunner** -- stops and shoots when in range
- **Tank** -- slow, high HP, heavy bolts, HP bar
- **Dasher** -- yellow telegraph, then red charge attack
- **Flyer** -- aerial hunter with jet trails
- **Drone** -- triple-shot hover unit

## Features
- Preacher staff magic vs robots (your art)
- Full HQ robot sprites (iframe = no paste-size budget)
- 5 levels + warehouse boss
- Gun upgrades: RIFLE, SPREAD, MAXI
- QR collectibles, 3 lives, techno soundtrack

## Build
```bash
python build_game.py
```
Rebuilds `index.html`, iframe stub, and single-file archive.

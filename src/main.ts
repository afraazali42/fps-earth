import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Input } from './input';
import { Player } from './player';
import { World } from './world';
import { Weapon } from './weapon';
import { TargetManager } from './targets';
import { Sfx } from './audio';
import { Net } from './net';
import { RemotePlayers } from './remote';
import { SettingsPanel } from './settings';
import { Editor, PALETTE, SHAPES } from './editor';
import { Globe } from './globe';
import { DEFAULT_CONFIG } from './config';
import * as mapstore from './mapstore';
import * as mapdir from './mapdir';

const PHYSICS_STEP = 1 / 60; // physics runs at a fixed 60 Hz regardless of display refresh rate

/**
 * Where the signaling ("matchmaker") broker lives — it just helps two browsers
 * find each other. By DEFAULT we use PeerJS's free public cloud broker, so a
 * friend in another house can join your link with no server to run or deploy.
 * `?signal=host:port` points at a self-hosted matchmaker instead (e.g. your
 * local `server/` for offline/LAN testing).
 */
function parseSignal(raw: string | null) {
  if (raw) {
    const secure = location.protocol === 'https:';
    const fallbackHost = location.hostname || 'localhost';
    const [h, p] = raw.split(':');
    return { host: h || fallbackHost, port: p ? Number(p) : 9000, path: '/', secure };
  }
  return { host: '0.peerjs.com', port: 443, path: '/', secure: true };
}

/**
 * Where OUR own server (the map directory at `/api`) lives. This is separate
 * from the signaling broker above: signaling can ride the public cloud, but the
 * map directory is our code, so it defaults to the local server on :9000.
 * `?api=URL` overrides it (e.g. a deployed directory later).
 */
function parseApiBase(raw: string | null): string {
  if (raw) return raw.replace(/\/+$/, '');
  const proto = location.protocol === 'https:' ? 'https' : 'http';
  const host = location.hostname || 'localhost';
  return `${proto}://${host}:9000`;
}

async function main() {
  await RAPIER.init();
  console.log('[fps-earth] physics ready');

  const app = document.querySelector<HTMLDivElement>('#app')!;
  const overlay = document.querySelector<HTMLDivElement>('#overlay')!;
  const crosshair = document.querySelector<HTMLDivElement>('#crosshair')!;
  const hud = document.querySelector<HTMLDivElement>('#hud')!;
  const hitmarkerEl = document.querySelector<HTMLDivElement>('#hitmarker')!;
  const scoreEl = document.querySelector<HTMLDivElement>('#score')!;
  const healthEl = document.querySelector<HTMLDivElement>('#health')!;
  const healthFill = document.querySelector<HTMLSpanElement>('#health .fill')!;
  const healthNum = document.querySelector<HTMLSpanElement>('#health .num')!;
  const damageFlashEl = document.querySelector<HTMLDivElement>('#damageflash')!;
  const killfeedEl = document.querySelector<HTMLDivElement>('#killfeed')!;
  const deathEl = document.querySelector<HTMLDivElement>('#death')!;
  const netstatusEl = document.querySelector<HTMLDivElement>('#netstatus')!;
  const inviteEl = document.querySelector<HTMLButtonElement>('#invite')!;
  const settingsContainerEl = document.querySelector<HTMLDivElement>('#settings')!;
  const buildBtnEl = document.querySelector<HTMLButtonElement>('#build-btn')!;
  const paletteEl = document.querySelector<HTMLDivElement>('#palette')!;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  app.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    400,
  );

  // the live game rules — a future "custom game type" is a saved copy of this
  const config = {
    ...DEFAULT_CONFIG,
    weapon: { ...DEFAULT_CONFIG.weapon },
    targets: { ...DEFAULT_CONFIG.targets },
  };

  // load whichever map is current in the library (migrates the old format)
  const startingMap = mapstore.currentMap();

  const input = new Input(document.body);
  const world = new World(config, startingMap);
  const player = new Player(world, input, camera, config);
  const targets = new TargetManager(world, config);
  const sfx = new Sfx();

  // the camera must be in the scene for its children (the viewmodel) to render
  world.scene.add(camera);

  // multiplayer roles: open the game plain → you HOST (others join your link);
  // open it with ?host=CODE → you join that host. ?signal=host:port overrides
  // where the tiny matchmaker lives (defaults to this machine, port 9000).
  const params = new URLSearchParams(location.search);
  const hostCode = params.get('host');
  const role: 'host' | 'peer' = hostCode ? 'peer' : 'host';
  const signal = parseSignal(params.get('signal'));
  mapdir.configure(parseApiBase(params.get('api'))); // our directory, not the broker
  const net = new Net(player, {
    role,
    hostCode: hostCode ?? undefined,
    signal,
    config,
    getMap: () => world.toMap(),
  });
  const remotes = new RemotePlayers(world);

  const inviteLink = () => {
    const u = new URL(`${location.origin}${location.pathname}`);
    u.searchParams.set('host', net.shareCode);
    // carry a custom matchmaker / directory so the friend uses the same ones
    const sig = params.get('signal');
    const api = params.get('api');
    if (sig) u.searchParams.set('signal', sig);
    if (api) u.searchParams.set('api', api);
    return u.toString();
  };
  const updateNetUI = () => {
    if (net.role === 'host' && net.shareCode) {
      netstatusEl.innerHTML =
        `You're the host — friends join with your link:<br><span class="link">${inviteLink()}</span>`;
      inviteEl.classList.add('show');
    } else {
      netstatusEl.textContent = net.status;
    }
  };
  net.onStatus = updateNetUI;
  inviteEl.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(inviteLink());
      inviteEl.textContent = '✓ Link copied!';
      setTimeout(() => (inviteEl.textContent = '📋 Copy invite link'), 1500);
    } catch {
      netstatusEl.innerHTML = `Copy this link:<br><span class="link">${inviteLink()}</span>`;
    }
  });
  updateNetUI();

  // custom-game rules: the host edits, everyone plays by them
  const applyRules = () => world.setGravity(config.gravity);
  const settings = new SettingsPanel(settingsContainerEl, config, () => {
    applyRules();
    if (net.role === 'host') net.broadcastConfig();
  });
  settings.setEditable(net.role === 'host');
  net.onConfig = () => {
    applyRules();
    settings.refresh();
  };
  applyRules();

  // peers: when the host sends their map, rebuild the world and drop in at its spawn
  net.onMap = (map) => {
    world.loadMap(map);
    player.setSpawn(map.spawn.x, map.spawn.y, map.spawn.z);
    player.respawn();
  };

  // hitmarker: flash on hit, bigger and red on kill
  let hitmarkerTimer: ReturnType<typeof setTimeout> | undefined;
  const ui = {
    hitmarker(kill: boolean) {
      hitmarkerEl.classList.toggle('kill', kill);
      hitmarkerEl.classList.add('show');
      clearTimeout(hitmarkerTimer);
      hitmarkerTimer = setTimeout(() => hitmarkerEl.classList.remove('show'), 70);
    },
  };

  const weapon = new Weapon(world, player, camera, input, config, targets, sfx, ui, remotes, net);
  const editor = new Editor(world, input, camera);
  const globe = new Globe(renderer.domElement);
  const createMenu = document.querySelector<HTMLDivElement>('#createmenu')!;

  // --- play / build / globe mode -------------------------------------------

  let mode: 'play' | 'edit' | 'globe' = 'play';
  let menuOpen = false; // the creation menu (E) — frees the mouse
  let wantMenu = false; // distinguishes an E-unlock from an Esc-unlock

  const setMode = (m: 'play' | 'edit') => {
    const was = mode;
    mode = m;
    document.body.classList.toggle('editing', m === 'edit');
    weapon.setHidden(m === 'edit');
    if (m === 'edit') {
      editor.enter();
      input.requestLock();
    } else {
      menuOpen = false;
      createMenu.classList.remove('show');
      editor.exit();
      if (was === 'edit') {
        player.setSpawn(world.spawn.x, world.spawn.y, world.spawn.z);
        player.respawn();
        if (net.role === 'host') net.broadcastMap();
      }
      input.requestLock();
    }
  };

  const openCreateMenu = () => {
    wantMenu = true;
    document.exitPointerLock(); // pointerlockchange then shows the menu
  };
  const closeCreateMenu = () => {
    menuOpen = false;
    wantMenu = false;
    createMenu.classList.remove('show');
    editor.setInteractive(true);
    input.requestLock();
  };

  // --- hotbar (always visible while building; number keys 1–5 select) ------

  const slotsEl = document.querySelector<HTMLDivElement>('#slots')!;
  const hbColor = document.querySelector<HTMLSpanElement>('#hb-color')!;
  const hbInfo = document.querySelector<HTMLSpanElement>('#hb-info')!;
  const slotEls: HTMLElement[] = [];
  SHAPES.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'slot';
    el.innerHTML = `<small>${i + 1}</small>${s.name}`;
    slotsEl.appendChild(el);
    slotEls.push(el);
  });

  // --- creation menu contents (shapes, colours, size, rotate, actions) -----

  const cmShapesEl = document.querySelector<HTMLDivElement>('#cm-shapes')!;
  const cmSizeEl = document.querySelector<HTMLDivElement>('#cm-size')!;
  const undoBtn = document.querySelector<HTMLButtonElement>('#undo-btn')!;

  const shapeButtons: HTMLButtonElement[] = [];
  SHAPES.forEach((s, i) => {
    const b = document.createElement('button');
    b.textContent = s.name;
    b.addEventListener('click', () => editor.setShapeIndex(i));
    cmShapesEl.appendChild(b);
    shapeButtons.push(b);
  });
  const swatches: HTMLElement[] = [];
  PALETTE.forEach((c, i) => {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    sw.style.background = `#${c.toString(16).padStart(6, '0')}`;
    sw.addEventListener('click', () => editor.applyColor(i));
    paletteEl.appendChild(sw);
    swatches.push(sw);
  });
  const sizeVals: Record<'w' | 'h' | 'd', HTMLSpanElement> = {
    w: document.createElement('span'),
    h: document.createElement('span'),
    d: document.createElement('span'),
  };
  (['w', 'h', 'd'] as const).forEach((axis) => {
    const wrap = document.createElement('span');
    wrap.className = 'cm-axis';
    const label = document.createElement('b');
    label.textContent = axis.toUpperCase();
    const minus = document.createElement('button');
    minus.className = 'cm-step';
    minus.textContent = '−';
    minus.addEventListener('click', () => editor.applySize(axis, -0.5));
    const val = sizeVals[axis];
    val.className = 'val';
    const plus = document.createElement('button');
    plus.className = 'cm-step';
    plus.textContent = '+';
    plus.addEventListener('click', () => editor.applySize(axis, 0.5));
    wrap.append(label, minus, val, plus);
    cmSizeEl.appendChild(wrap);
  });
  const rotateBtn = document.createElement('button');
  rotateBtn.textContent = '⟳ Rotate (R)';
  rotateBtn.addEventListener('click', () => editor.applyRotate());
  cmSizeEl.appendChild(rotateBtn);

  undoBtn.addEventListener('click', () => editor.undo());
  document.querySelector('#spawn-btn')!.addEventListener('click', () => editor.setSpawnAtCrosshair());
  document.querySelector('#clear-btn')!.addEventListener('click', () => editor.clear());
  document.querySelector('#play-btn')!.addEventListener('click', () => setMode('play'));
  document.querySelector('#close-btn')!.addEventListener('click', () => closeCreateMenu());
  // selection-edit buttons (shown when a block is selected)
  document.querySelector('#dup-btn')!.addEventListener('click', () => editor.duplicateSelection());
  document.querySelector('#delsel-btn')!.addEventListener('click', () => editor.deleteSelection());
  document.querySelector('#deselect-btn')!.addEventListener('click', () => editor.deselect());
  document.querySelector('#move-btn')!.addEventListener('click', () => {
    editor.startMove();
    closeCreateMenu(); // re-lock so the block follows the crosshair; click to drop
  });
  document.querySelector('#delsel-btn')!.classList.add('danger');

  const cmTitle = document.querySelector<HTMLHeadingElement>('#cm-title')!;
  const cmSub = document.querySelector<HTMLDivElement>('#cm-sub')!;
  const cmShapeLabel = document.querySelector<HTMLDivElement>('#cm-shape-label')!;
  const cmSelrow = document.querySelector<HTMLDivElement>('#cm-selrow')!;
  const buildhintEl = document.querySelector<HTMLDivElement>('#buildhint')!;
  const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

  const refreshHud = () => {
    const sel = editor.selectedBlock;
    const w = sel ? sel.w : editor.size.w;
    const h = sel ? sel.h : editor.size.h;
    const d = sel ? sel.d : editor.size.d;
    const color = sel ? sel.color : editor.currentColor;

    slotEls.forEach((el, i) => el.classList.toggle('active', editor.shapeIndex === i));
    shapeButtons.forEach((b, i) => b.classList.toggle('active', editor.shapeIndex === i));
    const colorIdx = PALETTE.indexOf(color);
    swatches.forEach((s, i) => s.classList.toggle('active', i === colorIdx));
    hbColor.style.background = hex(editor.currentColor);
    sizeVals.w.textContent = String(w);
    sizeVals.h.textContent = String(h);
    sizeVals.d.textContent = String(d);
    undoBtn.disabled = !editor.canUndo;

    // hotbar info + hint reflect the mode
    if (editor.selecting) {
      hbInfo.textContent = sel ? `selected · ${w}×${h}×${d}` : 'point at a block, click to select';
      buildhintEl.innerHTML =
        '<b>Select mode</b> — left-click a block, then <b>E</b> to edit · right-click deselect · <b>Tab</b> build · <b>Esc</b> pause';
    } else {
      const rot = editor.rotationDeg ? `  ⟳${editor.rotationDeg}°` : '';
      hbInfo.textContent = `${editor.size.w}×${editor.size.h}×${editor.size.d}${rot}`;
      buildhintEl.innerHTML =
        'Look with mouse · <b>left-click</b> place · <b>right-click</b> remove · <b>E</b> menu · <b>R</b> rotate · <b>Tab</b> select · <b>Esc</b> pause';
    }

    // creation menu becomes an editor when a block is selected
    const editing = !!sel;
    cmTitle.textContent = editing ? 'Edit selected block' : 'Create';
    cmSub.innerHTML = editing
      ? 'Change colour, size or rotation — or move, duplicate, delete it.'
      : 'Pick a shape, colour and size — press <b>E</b> to close and keep building.';
    cmShapeLabel.style.display = editing ? 'none' : '';
    cmShapesEl.style.display = editing ? 'none' : 'flex';
    cmSelrow.classList.toggle('show', editing);
  };
  editor.onChange = refreshHud;
  refreshHud();

  // build button only for the host (peers play the host's map)
  buildBtnEl.classList.toggle('hidden', net.role !== 'host');
  buildBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    overlay.classList.add('hidden');
    if (mode === 'edit') input.requestLock(); // resume building, keep camera
    else setMode('edit');
  });

  // --- map library (host only) ---------------------------------------------

  const mapsBtn = document.querySelector<HTMLButtonElement>('#maps-btn')!;
  const mapsMenu = document.querySelector<HTMLDivElement>('#mapsmenu')!;
  const mapListEl = document.querySelector<HTMLDivElement>('#map-list')!;
  const codeBox = document.querySelector<HTMLTextAreaElement>('#code-box')!;
  mapsMenu.addEventListener('click', (e) => e.stopPropagation());

  const loadMapById = (id: string) => {
    const map = mapstore.getMap(id);
    if (!map) return;
    mapstore.setCurrent(id);
    world.loadMap(map);
    editor.deselect();
    player.setSpawn(world.spawn.x, world.spawn.y, world.spawn.z);
    if (net.role === 'host' && net.connected) net.broadcastMap();
  };

  const closeMaps = () => mapsMenu.classList.remove('show');

  const refreshMapList = () => {
    const cur = mapstore.currentId();
    mapListEl.replaceChildren();
    for (const info of mapstore.listMaps()) {
      const row = document.createElement('div');
      row.className = info.id === cur ? 'map-row current' : 'map-row';
      const name = document.createElement('span');
      name.className = 'map-name';
      name.textContent = info.name;
      row.appendChild(name);
      const btn = (label: string, cls: string, fn: () => void) => {
        const b = document.createElement('button');
        b.textContent = label;
        if (cls) b.className = cls;
        b.addEventListener('click', fn);
        row.appendChild(b);
        return b;
      };
      btn('Load', 'load', () => {
        loadMapById(info.id);
        closeMaps();
        setMode('edit');
      });
      // Share publishes the map to the online directory and gives a short code.
      // If the directory is unreachable, it falls back to the long offline code.
      const shareBtn = btn('Share', '', async () => {
        const m = mapstore.getMap(info.id);
        if (!m) return;
        const restore = 'Share';
        shareBtn.textContent = '…';
        try {
          const code = await mapdir.publish({
            name: info.name,
            map: m,
            mapKey: info.id,
            location: info.location,
          });
          codeBox.value = code;
          try {
            await navigator.clipboard.writeText(code);
            shareBtn.textContent = '✓ Code copied';
          } catch {
            shareBtn.textContent = '✓ Shared';
          }
        } catch {
          codeBox.value = mapstore.exportCode(m);
          shareBtn.textContent = 'Offline code';
        }
        codeBox.focus();
        codeBox.select();
        setTimeout(() => (shareBtn.textContent = restore), 1800);
      });
      btn('Rename', '', () => {
        const n = prompt('Rename map:', info.name);
        if (n) {
          mapstore.renameMap(info.id, n);
          refreshMapList();
        }
      });
      btn('Copy', '', () => {
        mapstore.duplicateMap(info.id);
        refreshMapList();
      });
      btn('Delete', 'danger', () => {
        if (!confirm(`Delete "${info.name}"? This can't be undone.`)) return;
        const wasCurrent = info.id === mapstore.currentId();
        mapstore.deleteMap(info.id);
        if (wasCurrent) loadMapById(mapstore.currentId());
        refreshMapList();
      });
      mapListEl.appendChild(row);
    }
  };

  mapsBtn.classList.toggle('hidden', net.role !== 'host');
  mapsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    codeBox.value = '';
    refreshMapList();
    mapsMenu.classList.add('show');
  });
  document.querySelector('#maps-close-btn')!.addEventListener('click', () => closeMaps());
  document.querySelector('#newmap-btn')!.addEventListener('click', () => {
    const name = prompt('Name your new map:', 'New map');
    if (name === null) return;
    loadMapById(mapstore.createMap(name));
    closeMaps();
    setMode('edit');
  });
  document.querySelector('#import-btn')!.addEventListener('click', async () => {
    const raw = codeBox.value.trim();
    if (!raw) return;
    // a short 6-char code → fetch the map from the online directory
    if (mapdir.looksLikeCode(raw)) {
      const fetched = await mapdir.fetchMap(raw);
      if (!fetched) {
        alert("That code didn't match a shared map — check it, or make sure the server is running.");
        return;
      }
      const id = mapstore.createMap(fetched.name || 'Imported map', fetched.map);
      if (fetched.location) mapstore.setLocation(id, fetched.location);
      refreshMapList();
      return;
    }
    // otherwise treat it as a long self-contained code
    const map = mapstore.importCode(raw);
    if (!map) {
      alert("That code didn't work — make sure you pasted the whole thing.");
      return;
    }
    mapstore.createMap('Imported map', map);
    refreshMapList();
  });
  document.querySelector('#copycode-btn')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(codeBox.value);
    } catch {
      codeBox.focus();
      codeBox.select();
    }
  });

  // --- globe (host only): your maps as pins on a planet --------------------

  const globeBtn = document.querySelector<HTMLButtonElement>('#globe-btn')!;
  const fadeEl = document.querySelector<HTMLDivElement>('#fade')!;
  const pinNameEl = document.querySelector<HTMLDivElement>('#pin-name')!;
  const globeCurName = document.querySelector<HTMLSpanElement>('#globe-curname')!;

  const updateGlobeCurName = () => {
    const cur = mapstore.listMaps().find((m) => m.id === mapstore.currentId());
    globeCurName.textContent = cur ? cur.name : '';
  };

  // pull other people's shared maps from the directory and show them as pins
  // (skip our own — those already show as local yellow pins)
  const myDevice = mapdir.deviceId();
  const refreshGlobePublic = async () => {
    const all = await mapdir.listPublic();
    globe.setPublicMaps(all.filter((e) => e.location && e.owner !== myDevice));
  };

  const enterGlobe = () => {
    mode = 'globe';
    document.body.classList.add('on-globe');
    document.body.classList.remove('editing');
    overlay.classList.add('hidden');
    weapon.setHidden(true);
    if (input.pointerLocked) document.exitPointerLock();
    updateGlobeCurName();
    globe.enter();
    void refreshGlobePublic(); // async — pins pop in when the directory replies
  };
  const exitGlobe = () => {
    globe.exit();
    document.body.classList.remove('on-globe');
    pinNameEl.classList.remove('show');
    mode = 'play';
    overlay.classList.remove('hidden');
  };

  const fadeThen = (fn: () => void | Promise<void>) => {
    fadeEl.classList.add('show');
    setTimeout(async () => {
      await fn();
      setTimeout(() => fadeEl.classList.remove('show'), 80);
    }, 370);
  };

  globe.onEnterMap = (id) => {
    fadeThen(() => {
      loadMapById(id);
      exitGlobe(); // land on this map's menu — Play to drop in
    });
  };
  // clicking someone else's pin: pull a copy into your library, pin it where they
  // had it, load it, and drop onto its menu
  globe.onEnterPublic = (code) => {
    fadeThen(async () => {
      const fetched = await mapdir.fetchMap(code);
      if (fetched) {
        const id = mapstore.createMap(fetched.name || 'Shared map', fetched.map);
        if (fetched.location) mapstore.setLocation(id, fetched.location);
        loadMapById(id);
      }
      exitGlobe();
    });
  };
  globe.onPlaceMap = (lat, lng) => {
    mapstore.setLocation(mapstore.currentId(), { lat, lng });
    globe.refreshPins();
  };

  globeBtn.classList.toggle('hidden', net.role !== 'host');
  globeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    enterGlobe();
  });
  document.querySelector('#globe-back')!.addEventListener('click', () => exitGlobe());

  // keyboard: build shortcuts + the play↔build toggle
  window.addEventListener('keydown', (e) => {
    if (mode === 'edit') {
      if (menuOpen) {
        if (e.code === 'KeyE' || e.code === 'Escape') {
          e.preventDefault();
          closeCreateMenu();
        }
        return;
      }
      if (e.code === 'KeyE') {
        e.preventDefault();
        openCreateMenu();
      } else if (e.code === 'Tab') {
        e.preventDefault();
        editor.setSelecting(!editor.selecting);
      } else if (e.code === 'KeyR') editor.applyRotate();
      else if (e.code === 'KeyF') editor.setSpawnAtCrosshair();
      else if ((e.code === 'Delete' || e.code === 'Backspace') && editor.hasSelection) {
        editor.deleteSelection();
      } else if (e.code === 'KeyZ' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        editor.undo();
      } else if (!editor.selecting && /^Digit[1-6]$/.test(e.code)) {
        editor.setShapeIndex(Number(e.code.slice(5)) - 1);
      }
    } else if (mode === 'play') {
      if (e.code === 'KeyB' && net.role === 'host' && input.pointerLocked) setMode('edit');
    }
  });

  // --- combat HUD: health, damage flash, kill feed, death/respawn ----------

  let dead = false;
  let prevHp = 100;

  const flashDamage = () => {
    damageFlashEl.style.transition = 'none';
    damageFlashEl.style.opacity = '0.55';
    requestAnimationFrame(() => {
      damageFlashEl.style.transition = 'opacity 0.4s ease-out';
      damageFlashEl.style.opacity = '0';
    });
  };

  let killfeedTimer: ReturnType<typeof setTimeout> | undefined;
  const showKillFeed = (text: string) => {
    killfeedEl.textContent = text;
    killfeedEl.classList.add('show');
    clearTimeout(killfeedTimer);
    killfeedTimer = setTimeout(() => killfeedEl.classList.remove('show'), 3000);
  };

  const shortId = (id: string) => id.slice(0, 4);

  const reconcileLife = () => {
    const me = net.self();
    if (!me) {
      healthFill.style.width = '100%';
      healthNum.textContent = '100';
      healthEl.classList.remove('low');
      return;
    }
    if (me.alive && me.hp < prevHp) flashDamage();
    prevHp = me.hp;

    if (!me.alive && !dead) {
      dead = true;
      deathEl.classList.add('show');
    } else if (me.alive && dead) {
      dead = false;
      deathEl.classList.remove('show');
    }

    const pct = Math.max(0, Math.min(100, me.hp));
    healthFill.style.width = `${pct}%`;
    healthNum.textContent = String(Math.round(pct));
    healthEl.classList.toggle('low', pct <= 30);
  };

  net.onKill = (killer, victim) => {
    if (killer === net.sessionId) {
      ui.hitmarker(true);
      sfx.kill();
      showKillFeed(`You eliminated ${shortId(victim)}`);
    } else if (victim === net.sessionId) {
      showKillFeed(`${shortId(killer)} eliminated you`);
    } else {
      showKillFeed(`${shortId(killer)} eliminated ${shortId(victim)}`);
    }
  };

  net.onRespawn = (id, x, y, z) => {
    // crisp local teleport on our own respawn; the dead flag clears in
    // reconcileLife once the server's snapshot marks us alive again
    if (id === net.sessionId) player.teleport(x, y, z);
  };

  net.start();

  // audio can only start after a user gesture
  window.addEventListener('click', () => sfx.unlock());
  window.addEventListener('keydown', () => sfx.unlock());

  // hide the overlay as soon as the player clicks — don't wait for pointer
  // lock, which can fail or be unavailable on some devices
  overlay.addEventListener('click', () => {
    overlay.classList.add('hidden');
    setMode('play'); // requests pointer lock
  });
  // clicking the canvas re-engages pointer lock if it was lost (e.g. lock failed
  // right after closing the creation menu); while building it also places blocks
  renderer.domElement.addEventListener('click', () => {
    if (input.pointerLocked) return;
    if (mode === 'play' || (mode === 'edit' && !menuOpen)) input.requestLock();
  });
  document.addEventListener('pointerlockchange', () => {
    if (mode === 'globe') return; // globe uses a free cursor; ignore lock changes
    const locked = document.pointerLockElement !== null;
    crosshair.classList.toggle('visible', locked);
    if (locked) {
      overlay.classList.add('hidden');
      createMenu.classList.remove('show');
      if (mode === 'edit') {
        menuOpen = false;
        editor.setInteractive(true);
      }
    } else if (mode === 'play') {
      overlay.classList.remove('hidden');
    } else if (wantMenu) {
      // E was pressed → show the creation menu and free the mouse
      wantMenu = false;
      menuOpen = true;
      createMenu.classList.add('show');
      editor.setInteractive(false);
    } else {
      // Esc → pause
      overlay.classList.remove('hidden');
    }
  });

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // one fixed simulation tick — the rAF loop drives this, and dev tools can
  // drive it directly (deterministically) when rAF is throttled
  const stepSimulation = (dt: number) => {
    if (!dead) player.fixedUpdate(dt);
    targets.fixedUpdate(dt);
    remotes.fixedUpdate(dt, net.players, net.sessionId); // move remote colliders before the step
    world.physics.step();
    if (!dead) weapon.fixedUpdate(dt); // raycasts run against freshly stepped colliders
    net.fixedUpdate(dt);
  };

  const syncScore = () => {
    const me = net.self();
    scoreEl.textContent = me ? `☠ ${me.kills}   ⊗ ${me.deaths}` : `⌖ ${targets.kills}`;
  };

  // render one frame outside the rAF loop (used by dev.step for screenshots)
  const renderFrame = () => {
    player.updateCamera(1);
    weapon.renderUpdate(0);
    reconcileLife();
    syncScore();
    renderer.render(world.scene, camera);
  };

  // main loop: fixed-rate physics, interpolated rendering
  let accumulator = 0;
  let last = performance.now();
  let fpsFrames = 0;
  let fpsTime = 0;

  renderer.setAnimationLoop((now: number) => {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 0.1); // returning from a background tab: don't fast-forward

    if (mode === 'globe') {
      globe.update(dt);
      renderer.render(globe.scene, globe.camera);
      pinNameEl.textContent = globe.hoveredName;
      pinNameEl.classList.toggle('show', globe.hoveredName !== '');
    } else if (mode === 'edit') {
      editor.update(dt);
      renderer.render(world.scene, camera);
    } else {
      player.updateLook();
      accumulator += dt;
      while (accumulator >= PHYSICS_STEP) {
        stepSimulation(PHYSICS_STEP);
        accumulator -= PHYSICS_STEP;
      }
      player.updateCamera(accumulator / PHYSICS_STEP);
      weapon.renderUpdate(dt);
      reconcileLife();
      renderer.render(world.scene, camera);
      syncScore();
    }

    fpsFrames++;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      const tag = mode === 'edit' ? 'build' : net.connected ? `${net.players.length} online` : 'offline';
      hud.textContent = `${Math.round(fpsFrames / fpsTime)} fps · fps-earth · ${tag}`;
      fpsFrames = 0;
      fpsTime = 0;
    }
  });

  if (import.meta.env.DEV) {
    const { installDevTools } = await import('./dev');
    window.dev = installDevTools(
      player,
      input,
      config,
      targets,
      weapon,
      net,
      remotes,
      world,
      editor,
      globe,
      { get: () => (mode === 'globe' ? 'play' : mode), set: setMode },
      { step: stepSimulation, render: renderFrame, draw: () => renderer.render(world.scene, camera) },
    );
    console.log('[fps-earth] dev tools installed — try dev.state() in the console');
  }

  console.log('[fps-earth] running');
}

main().catch((err) => {
  console.error('[fps-earth] failed to start:', err);
  const overlay = document.querySelector<HTMLDivElement>('#overlay');
  if (overlay) {
    overlay.innerHTML = `<h1>fps-earth could not start</h1><div class="sub">${String(err)}</div>`;
  }
});

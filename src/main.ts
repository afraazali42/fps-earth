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
import { Editor, PALETTE } from './editor';
import { DEFAULT_CONFIG } from './config';
import { defaultMap, loadSavedMap } from './gamemap';

const PHYSICS_STEP = 1 / 60; // physics runs at a fixed 60 Hz regardless of display refresh rate

/** Where the signaling ("matchmaker") server lives. Defaults to this machine:9000. */
function parseSignal(raw: string | null) {
  const secure = location.protocol === 'https:';
  const fallbackHost = location.hostname || 'localhost';
  if (raw) {
    const [h, p] = raw.split(':');
    return { host: h || fallbackHost, port: p ? Number(p) : 9000, path: '/', secure };
  }
  return { host: fallbackHost, port: 9000, path: '/', secure };
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

  // load the saved map if there is one, otherwise the starter arena
  const startingMap = loadSavedMap() ?? defaultMap();

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
  const net = new Net(player, {
    role,
    hostCode: hostCode ?? undefined,
    signal,
    config,
    getMap: () => world.toMap(),
  });
  const remotes = new RemotePlayers(world);

  const inviteLink = () =>
    `${location.origin}${location.pathname}?host=${encodeURIComponent(net.shareCode)}`;
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

  // --- play / build mode switching ----------------------------------------

  let mode: 'play' | 'edit' = 'play';
  const setMode = (m: 'play' | 'edit') => {
    const was = mode;
    mode = m;
    document.body.classList.toggle('editing', m === 'edit');
    weapon.setHidden(m === 'edit');
    if (m === 'edit') {
      editor.enter();
    } else {
      editor.exit();
      if (was === 'edit') {
        // dropping in from build mode: start at the map's spawn point
        player.setSpawn(world.spawn.x, world.spawn.y, world.spawn.z);
        player.respawn();
        // share the freshly-built map with everyone who's joined
        if (net.role === 'host') net.broadcastMap();
      }
    }
  };

  // build button only for the host (peers play the host's map)
  buildBtnEl.classList.toggle('hidden', net.role !== 'host');
  buildBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    overlay.classList.add('hidden');
    setMode('edit');
    input.requestLock();
  });

  // build the colour palette HUD
  for (let i = 0; i < PALETTE.length; i++) {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    sw.style.background = `#${PALETTE[i]!.toString(16).padStart(6, '0')}`;
    sw.innerHTML = `<b>${i + 1}</b>`;
    paletteEl.appendChild(sw);
  }
  const swatches = [...paletteEl.children] as HTMLElement[];
  const updatePaletteUI = () => {
    for (let i = 0; i < swatches.length; i++) {
      swatches[i]!.classList.toggle('active', i === editor.colorIndex);
    }
  };

  // quick toggles while playing/building (host only for build)
  window.addEventListener('keydown', (e) => {
    if (!input.pointerLocked) return;
    if (e.code === 'Enter' && mode === 'edit') setMode('play');
    else if (e.code === 'KeyB' && mode === 'play' && net.role === 'host') setMode('edit');
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
    setMode('play');
    input.requestLock();
  });
  // clicking the game canvas re-engages pointer lock if it was lost or failed
  renderer.domElement.addEventListener('click', () => {
    if (!input.pointerLocked) input.requestLock();
  });
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement !== null;
    overlay.classList.toggle('hidden', locked);
    crosshair.classList.toggle('visible', locked);
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

    if (mode === 'edit') {
      editor.update(dt);
      updatePaletteUI();
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
      { get: () => mode, set: setMode },
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

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
import { DEFAULT_CONFIG } from './config';

const PHYSICS_STEP = 1 / 60; // physics runs at a fixed 60 Hz regardless of display refresh rate

async function main() {
  await RAPIER.init();
  console.log('[fps-earth] physics ready');

  const app = document.querySelector<HTMLDivElement>('#app')!;
  const overlay = document.querySelector<HTMLDivElement>('#overlay')!;
  const crosshair = document.querySelector<HTMLDivElement>('#crosshair')!;
  const hud = document.querySelector<HTMLDivElement>('#hud')!;
  const hitmarkerEl = document.querySelector<HTMLDivElement>('#hitmarker')!;
  const scoreEl = document.querySelector<HTMLDivElement>('#score')!;

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
  const config = { ...DEFAULT_CONFIG, weapon: { ...DEFAULT_CONFIG.weapon }, targets: { ...DEFAULT_CONFIG.targets } };

  const input = new Input(document.body);
  const world = new World(config);
  const player = new Player(world, input, camera, config);
  const targets = new TargetManager(world, config);
  const sfx = new Sfx();

  // the camera must be in the scene for its children (the viewmodel) to render
  world.scene.add(camera);

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

  const weapon = new Weapon(world, player, camera, input, config, targets, sfx, ui);

  // multiplayer: ?server=ws://host:port overrides the default local server
  const serverUrl =
    new URLSearchParams(location.search).get('server') ?? 'ws://localhost:2567';
  const net = new Net(serverUrl, player);
  const remotes = new RemotePlayers(world);
  net.start();

  // audio can only start after a user gesture
  window.addEventListener('click', () => sfx.unlock());
  window.addEventListener('keydown', () => sfx.unlock());

  // hide the overlay as soon as the player clicks — don't wait for pointer
  // lock, which can fail or be unavailable on some devices
  overlay.addEventListener('click', () => {
    overlay.classList.add('hidden');
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
    player.fixedUpdate(dt);
    targets.fixedUpdate(dt);
    world.physics.step();
    weapon.fixedUpdate(dt); // raycasts run against freshly stepped positions
    net.fixedUpdate(dt);
    remotes.fixedUpdate(dt, net.players, net.sessionId);
  };

  let lastKills = -1;
  const syncScore = () => {
    if (targets.kills !== lastKills) {
      lastKills = targets.kills;
      scoreEl.textContent = `⌖ ${targets.kills}`;
    }
  };

  // render one frame outside the rAF loop (used by dev.step for screenshots)
  const renderFrame = () => {
    player.updateCamera(1);
    weapon.renderUpdate(0);
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

    player.updateLook();

    accumulator += dt;
    while (accumulator >= PHYSICS_STEP) {
      stepSimulation(PHYSICS_STEP);
      accumulator -= PHYSICS_STEP;
    }

    player.updateCamera(accumulator / PHYSICS_STEP);
    weapon.renderUpdate(dt);
    renderer.render(world.scene, camera);
    syncScore();

    fpsFrames++;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      const online = net.connected ? `${net.players.length} online` : 'offline';
      hud.textContent = `${Math.round(fpsFrames / fpsTime)} fps · fps-earth phase 1 · ${online}`;
      fpsFrames = 0;
      fpsTime = 0;
    }
  });

  if (import.meta.env.DEV) {
    const { installDevTools } = await import('./dev');
    window.dev = installDevTools(player, input, config, targets, weapon, net, remotes, {
      step: stepSimulation,
      render: renderFrame,
    });
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

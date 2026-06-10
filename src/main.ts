import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Input } from './input';
import { Player } from './player';
import { World } from './world';
import { DEFAULT_CONFIG } from './config';

const PHYSICS_STEP = 1 / 60; // physics runs at a fixed 60 Hz regardless of display refresh rate

async function main() {
  await RAPIER.init();
  console.log('[fps-earth] physics ready');

  const app = document.querySelector<HTMLDivElement>('#app')!;
  const overlay = document.querySelector<HTMLDivElement>('#overlay')!;
  const crosshair = document.querySelector<HTMLDivElement>('#crosshair')!;
  const hud = document.querySelector<HTMLDivElement>('#hud')!;

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
  const config = { ...DEFAULT_CONFIG };

  const input = new Input(document.body);
  const world = new World(config);
  const player = new Player(world, input, camera, config);

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
      player.fixedUpdate(PHYSICS_STEP);
      world.physics.step();
      accumulator -= PHYSICS_STEP;
    }

    player.updateCamera(accumulator / PHYSICS_STEP);
    renderer.render(world.scene, camera);

    fpsFrames++;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      hud.textContent = `${Math.round(fpsFrames / fpsTime)} fps · fps-earth phase 0`;
      fpsFrames = 0;
      fpsTime = 0;
    }
  });

  if (import.meta.env.DEV) {
    const { installDevTools } = await import('./dev');
    window.dev = installDevTools(player, input, config);
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

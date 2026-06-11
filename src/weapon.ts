import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Input } from './input';
import type { Player } from './player';
import type { World } from './world';
import type { GameConfig } from './config';
import type { TargetManager } from './targets';
import type { Sfx } from './audio';

/** UI hooks the weapon calls — wired to DOM elements in main.ts. */
export interface WeaponUi {
  hitmarker(kill: boolean): void;
}

// muzzle offset in camera space (right, down, forward)
const MUZZLE_OFFSET = new THREE.Vector3(0.24, -0.16, -0.6);
const TRACER_TTL = 0.07;
const SPARK_TTL = 0.14;

interface FxEntry {
  obj: THREE.Object3D;
  ttl: number;
  maxTtl: number;
}

/**
 * A hitscan rifle: rays come from the player's eye along the view direction,
 * resolved against the physics world (so cover genuinely blocks shots — the
 * same query a future authoritative server will run). All numbers live in
 * GameConfig.weapon and react to live tuning.
 */
export class Weapon {
  /** diagnostics, readable via dev.weaponInfo() */
  shotsFired = 0;
  lastShot: {
    hit: boolean;
    hitTarget: boolean;
    point?: { x: number; y: number; z: number };
  } = { hit: false, hitTarget: false };

  private cooldown = 0;
  private triggerWasDown = false;
  private fx: FxEntry[] = [];
  private viewmodel: THREE.Group;
  private viewKick = 0;

  constructor(
    private world: World,
    private player: Player,
    private camera: THREE.PerspectiveCamera,
    private input: Input,
    private config: GameConfig,
    private targets: TargetManager,
    private sfx: Sfx,
    private ui: WeaponUi,
  ) {
    this.viewmodel = this.buildViewmodel();
    camera.add(this.viewmodel);
  }

  /** Runs at the fixed physics rate, after physics.step(). */
  fixedUpdate(dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);

    const trigger = this.input.down('Mouse0');
    const allowed = this.config.weapon.automatic || !this.triggerWasDown;
    if (trigger && allowed && this.cooldown <= 0) {
      this.fireOnce();
      this.cooldown = 1 / this.config.weapon.fireRate;
    }
    this.triggerWasDown = trigger;
  }

  /** Runs every rendered frame: effect fade-out and viewmodel recoil. */
  renderUpdate(dt: number) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const e = this.fx[i]!;
      e.ttl -= dt;
      if (e.ttl <= 0) {
        this.world.scene.remove(e.obj);
        disposeObject(e.obj);
        this.fx.splice(i, 1);
        continue;
      }
      const fade = e.ttl / e.maxTtl;
      const mat = (e.obj as THREE.Mesh | THREE.Line).material as THREE.Material & {
        opacity: number;
      };
      mat.opacity = fade;
    }

    // recoil: kick decays back to rest
    this.viewKick = Math.max(0, this.viewKick - dt * 0.6);
    const k = this.viewKick;
    this.viewmodel.position.set(0.24, -0.2, -0.5 + k * 0.9);
    this.viewmodel.rotation.x = k * 0.7;
  }

  private fireOnce() {
    this.shotsFired++;
    const eye = this.player.position;
    const eyePos = new THREE.Vector3(eye.x, eye.y + 0.75, eye.z);
    const euler = new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ');
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(euler);

    const ray = new RAPIER.Ray(
      new RAPIER.Vector3(eyePos.x, eyePos.y, eyePos.z),
      new RAPIER.Vector3(dir.x, dir.y, dir.z),
    );
    const hit = this.world.physics.castRay(
      ray,
      this.config.weapon.range,
      true,
      undefined,
      undefined,
      undefined,
      this.player.rigidBody,
    );

    let endPoint: THREE.Vector3;
    if (hit) {
      const p = ray.pointAt(hit.timeOfImpact);
      endPoint = new THREE.Vector3(p.x, p.y, p.z);

      const target = this.targets.byColliderHandle(hit.collider.handle);
      this.lastShot = {
        hit: true,
        hitTarget: Boolean(target && target.alive),
        point: { x: p.x, y: p.y, z: p.z },
      };
      if (target && target.alive) {
        const killed = target.damage(this.config.weapon.damage);
        if (killed) this.targets.kills++;
        this.ui.hitmarker(killed);
        if (killed) this.sfx.kill();
        else this.sfx.hit();
      }
      this.spawnSpark(endPoint);
    } else {
      endPoint = eyePos.clone().addScaledVector(dir, this.config.weapon.range);
      this.lastShot = { hit: false, hitTarget: false };
    }

    const muzzle = MUZZLE_OFFSET.clone().applyEuler(euler).add(eyePos);
    this.spawnTracer(muzzle, endPoint);
    this.sfx.shoot();
    this.viewKick = Math.min(0.12, this.viewKick + 0.07);
  }

  private spawnTracer(from: THREE.Vector3, to: THREE.Vector3) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({
      color: 0xffe9a0,
      transparent: true,
      opacity: 1,
    });
    const line = new THREE.Line(geo, mat);
    this.world.scene.add(line);
    this.fx.push({ obj: line, ttl: TRACER_TTL, maxTtl: TRACER_TTL });
  }

  private spawnSpark(at: THREE.Vector3) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffb74d, transparent: true, opacity: 1 }),
    );
    mesh.position.copy(at);
    this.world.scene.add(mesh);
    this.fx.push({ obj: mesh, ttl: SPARK_TTL, maxTtl: SPARK_TTL });
  }

  private buildViewmodel(): THREE.Group {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x2f3640,
      roughness: 0.4,
      metalness: 0.35,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.13, 0.42), bodyMat);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.34), bodyMat);
    barrel.position.set(0, 0.02, -0.33);
    group.add(body, barrel);
    group.position.set(0.24, -0.2, -0.5);
    return group;
  }
}

function disposeObject(obj: THREE.Object3D) {
  const m = obj as THREE.Mesh;
  m.geometry?.dispose();
  if (m.material) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) mat.dispose();
  }
}

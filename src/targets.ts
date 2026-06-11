import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { World } from './world';
import type { GameConfig } from './config';

interface TargetSpec {
  position: [number, number, number];
  color?: number;
  /** oscillate along an axis: position is the centre of the path */
  moving?: { axis: 'x' | 'y'; amplitude: number; speed: number };
}

const TARGET_RADIUS = 0.45;

/** One shootable practice ball. */
class Target {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  hp: number;
  private flash = 0;
  private respawnIn = -1;
  private t = 0;
  private baseColor: THREE.Color;
  private basePos: THREE.Vector3;

  constructor(
    private world: World,
    private config: GameConfig,
    private spec: TargetSpec,
  ) {
    this.hp = config.targets.health;
    this.baseColor = new THREE.Color(spec.color ?? 0xe53935);
    this.basePos = new THREE.Vector3(...spec.position);

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(TARGET_RADIUS, 24, 16),
      new THREE.MeshStandardMaterial({ color: this.baseColor, roughness: 0.5 }),
    );
    this.mesh.castShadow = true;
    this.mesh.position.copy(this.basePos);
    world.scene.add(this.mesh);

    this.body = world.physics.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(...spec.position),
    );
    this.collider = world.physics.createCollider(
      RAPIER.ColliderDesc.ball(TARGET_RADIUS),
      this.body,
    );
  }

  get alive(): boolean {
    return this.respawnIn < 0;
  }

  /** Apply damage; returns true if this shot destroyed the target. */
  damage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.flash = 1;
    if (this.hp <= 0) {
      this.respawnIn = this.config.targets.respawnSeconds;
      this.mesh.visible = false;
      this.collider.setEnabled(false);
      return true;
    }
    return false;
  }

  fixedUpdate(dt: number) {
    this.t += dt;

    // movement path (kinematic, so it blocks and receives rays correctly)
    if (this.spec.moving) {
      const { axis, amplitude, speed } = this.spec.moving;
      const offset = Math.sin(this.t * speed) * amplitude;
      const p = this.basePos.clone();
      p[axis] += offset;
      this.body.setNextKinematicTranslation(new RAPIER.Vector3(p.x, p.y, p.z));
      this.mesh.position.copy(p);
    }

    // respawn countdown
    if (!this.alive) {
      this.respawnIn -= dt;
      if (this.respawnIn < 0) {
        this.hp = this.config.targets.health;
        this.mesh.visible = true;
        this.collider.setEnabled(true);
      }
      return;
    }

    // hit flash decays; colour darkens as health drops
    this.flash = Math.max(0, this.flash - dt * 6);
    const mat = this.mesh.material as THREE.MeshStandardMaterial;
    const healthFrac = Math.max(0, this.hp / this.config.targets.health);
    mat.color.copy(this.baseColor).multiplyScalar(0.35 + 0.65 * healthFrac);
    mat.emissive.setScalar(this.flash * 0.9);
  }
}

/**
 * Owns all practice targets in the range. Weapons look hits up here by
 * collider handle.
 */
export class TargetManager {
  kills = 0;
  private targets: Target[] = [];
  private byHandle = new Map<number, Target>();

  constructor(world: World, config: GameConfig) {
    const specs: TargetSpec[] = [
      // three static targets on posts, increasing distance
      { position: [-4, 1.85, -12] },
      { position: [3, 1.85, -16] },
      { position: [-1, 1.85, -30] },
      // two movers (orange) at different heights/speeds
      { position: [8, 1.6, -14], color: 0xff7043, moving: { axis: 'x', amplitude: 3, speed: 1.6 } },
      { position: [-8, 2.2, -20], color: 0xff7043, moving: { axis: 'x', amplitude: 4, speed: 1.0 } },
      // one high floater above the ramp platform for vertical aim
      { position: [14, 5.2, -24], color: 0xffa726, moving: { axis: 'y', amplitude: 1.2, speed: 1.2 } },
    ];

    // posts under the static targets (world geometry — blocks bullets too)
    world.addBox({ size: [0.25, 1.4, 0.25], position: [-4, 0.7, -12], color: 0x6d4c41 });
    world.addBox({ size: [0.25, 1.4, 0.25], position: [3, 0.7, -16], color: 0x6d4c41 });
    world.addBox({ size: [0.25, 1.4, 0.25], position: [-1, 0.7, -30], color: 0x6d4c41 });

    for (const spec of specs) {
      const target = new Target(world, config, spec);
      this.targets.push(target);
      this.byHandle.set(target.collider.handle, target);
    }
  }

  byColliderHandle(handle: number): Target | undefined {
    return this.byHandle.get(handle);
  }

  fixedUpdate(dt: number) {
    for (const t of this.targets) t.fixedUpdate(dt);
  }

  /** Dev/debug snapshot. */
  snapshot() {
    return this.targets.map((t) => ({
      pos: {
        x: Math.round(t.mesh.position.x * 100) / 100,
        y: Math.round(t.mesh.position.y * 100) / 100,
        z: Math.round(t.mesh.position.z * 100) / 100,
      },
      hp: t.hp,
      alive: t.alive,
    }));
  }
}

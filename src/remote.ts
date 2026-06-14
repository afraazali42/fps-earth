import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { World } from './world';
import type { NetPlayerState } from './net';

// match the local player's capsule so aiming lines up: total height 1.8 m
const CAPSULE_HALF_HEIGHT = 0.55;
const CAPSULE_RADIUS = 0.35;

/**
 * Renders the other players AND gives each one a physics collider so the local
 * player's shots (and body) collide with them. A coloured capsule with a dark
 * visor shows facing; positions are smoothed between network updates (20 Hz in,
 * 60 Hz out). Dead players are hidden and their collider disabled until they
 * respawn.
 */
export class RemotePlayers {
  count = 0;
  private remotes = new Map<string, Remote>();
  private byHandle = new Map<number, string>();

  constructor(private world: World) {}

  /** Which player a collider belongs to (used by the weapon's raycast). */
  playerByColliderHandle(handle: number): string | undefined {
    return this.byHandle.get(handle);
  }

  fixedUpdate(dt: number, players: NetPlayerState[], selfId: string) {
    const seen = new Set<string>();

    for (const p of players) {
      if (p.id === selfId) continue;
      seen.add(p.id);
      let remote = this.remotes.get(p.id);
      if (!remote) {
        remote = new Remote(this.world, p);
        this.world.scene.add(remote.group);
        this.remotes.set(p.id, remote);
        this.byHandle.set(remote.collider.handle, p.id);
      }
      remote.target = p;
      remote.setAlive(p.alive);
    }

    // remove players who left
    for (const [id, remote] of this.remotes) {
      if (!seen.has(id)) {
        this.byHandle.delete(remote.collider.handle);
        this.world.scene.remove(remote.group);
        remote.dispose(this.world);
        this.remotes.delete(id);
      }
    }

    this.count = this.remotes.size;
    const k = 1 - Math.exp(-14 * dt);
    for (const remote of this.remotes.values()) remote.smooth(k);
  }
}

class Remote {
  group = new THREE.Group();
  target: NetPlayerState;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  private yaw: number;
  private visor: THREE.Mesh;
  private alive = true;

  constructor(world: World, initial: NetPlayerState) {
    this.target = initial;
    this.yaw = initial.yaw;

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HALF_HEIGHT * 2, 6, 16),
      new THREE.MeshStandardMaterial({ color: colorFromId(initial.id), roughness: 0.7 }),
    );
    body.castShadow = true;

    this.visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.12, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x1a2230, roughness: 0.25, metalness: 0.4 }),
    );
    this.visor.position.set(0, 0.62, -0.28); // eye height, facing -z like the camera

    this.group.add(body, this.visor);
    this.group.position.set(initial.x, initial.y, initial.z);

    // kinematic collider that follows the smoothed visual position
    this.body = world.physics.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        initial.x,
        initial.y,
        initial.z,
      ),
    );
    this.collider = world.physics.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS),
      this.body,
    );
  }

  setAlive(alive: boolean) {
    if (alive === this.alive) return;
    this.alive = alive;
    this.group.visible = alive;
    this.collider.setEnabled(alive); // can't shoot a corpse
  }

  smooth(k: number) {
    this.group.position.lerp(
      new THREE.Vector3(this.target.x, this.target.y, this.target.z),
      k,
    );
    this.yaw = lerpAngle(this.yaw, this.target.yaw, k);
    this.group.rotation.y = this.yaw;
    this.visor.rotation.x = -this.target.pitch * 0.6; // subtle look-up/down hint

    // keep the physics collider on the visible body
    this.body.setNextKinematicTranslation(
      new RAPIER.Vector3(this.group.position.x, this.group.position.y, this.group.position.z),
    );
  }

  dispose(world: World) {
    world.physics.removeRigidBody(this.body); // also removes its collider
    for (const child of this.group.children) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m.dispose();
      }
    }
  }
}

/** Interpolate angles along the shortest arc (so 359°→1° doesn't spin). */
function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/** Stable colour per player id. */
function colorFromId(id: string): THREE.Color {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.65, 0.55);
}

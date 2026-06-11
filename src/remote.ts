import * as THREE from 'three';
import type { World } from './world';
import type { NetPlayerState } from './net';

/**
 * Renders the other players: a coloured capsule per player with a dark visor
 * showing which way they're looking. Positions are smoothed between network
 * updates (20 Hz in, 60 Hz out). No physics body yet — remote players are
 * ghosts until the server-authoritative rewrite.
 */
export class RemotePlayers {
  count = 0;
  private remotes = new Map<string, Remote>();

  constructor(private world: World) {}

  fixedUpdate(dt: number, players: NetPlayerState[], selfId: string) {
    const seen = new Set<string>();

    for (const p of players) {
      if (p.id === selfId) continue;
      seen.add(p.id);
      let remote = this.remotes.get(p.id);
      if (!remote) {
        remote = new Remote(p);
        this.world.scene.add(remote.group);
        this.remotes.set(p.id, remote);
      }
      remote.target = p;
    }

    // remove players who left
    for (const [id, remote] of this.remotes) {
      if (!seen.has(id)) {
        this.world.scene.remove(remote.group);
        remote.dispose();
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
  private yaw: number;
  private visor: THREE.Mesh;

  constructor(initial: NetPlayerState) {
    this.target = initial;
    this.yaw = initial.yaw;

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, 1.1, 6, 16),
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
  }

  smooth(k: number) {
    this.group.position.lerp(
      new THREE.Vector3(this.target.x, this.target.y, this.target.z),
      k,
    );
    this.yaw = lerpAngle(this.yaw, this.target.yaw, k);
    this.group.rotation.y = this.yaw;
    this.visor.rotation.x = -this.target.pitch * 0.6; // subtle look-up/down hint
  }

  dispose() {
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

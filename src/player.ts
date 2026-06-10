import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Input } from './input';
import type { World } from './world';
import type { GameConfig } from './config';

// capsule: total height = 2 * (HALF_HEIGHT + RADIUS) = 1.8 m
const CAPSULE_HALF_HEIGHT = 0.55;
const CAPSULE_RADIUS = 0.35;
// eyes sit 0.75 m above the capsule centre → about 1.65 m above the feet
const EYE_HEIGHT = 0.75;

// client preference, not a game rule — stays out of GameConfig
const MOUSE_SENSITIVITY = 0.0022;
const RESPAWN_BELOW_Y = -25;

const SPAWN = new THREE.Vector3(0, 2, 14);
const UP = new THREE.Vector3(0, 1, 0);

/**
 * First-person player: a physics capsule moved by Rapier's character
 * controller (slides along walls, climbs stairs, walks ramps), with the
 * camera attached at eye height. All movement numbers come from the live
 * GameConfig — changing it mid-game changes how this feels immediately.
 */
export class Player {
  yaw = 0;
  pitch = 0;

  private velocityY = 0;
  private grounded = false;
  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;

  // previous/current physics positions, interpolated for smooth rendering
  private prevPos = new THREE.Vector3();
  private currPos = new THREE.Vector3();

  constructor(
    world: World,
    private input: Input,
    private camera: THREE.PerspectiveCamera,
    private config: GameConfig,
  ) {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      SPAWN.x,
      SPAWN.y,
      SPAWN.z,
    );
    this.body = world.physics.createRigidBody(bodyDesc);
    this.collider = world.physics.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS),
      this.body,
    );

    this.controller = world.physics.createCharacterController(0.02);
    this.controller.enableAutostep(0.5, 0.2, true); // walk up steps ≤ 0.5 m
    this.controller.enableSnapToGround(0.3); // stick to ground going downhill
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((55 * Math.PI) / 180);

    this.currPos.copy(SPAWN);
    this.prevPos.copy(SPAWN);
  }

  /** Every rendered frame: turn accumulated mouse motion into view angles. */
  updateLook() {
    const { dx, dy } = this.input.consumeMouse();
    this.yaw -= dx * MOUSE_SENSITIVITY;
    this.pitch -= dy * MOUSE_SENSITIVITY;
    const limit = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  }

  /** Every physics tick: move the capsule through the world. */
  fixedUpdate(dt: number) {
    const forward = (this.input.down('KeyW') ? 1 : 0) - (this.input.down('KeyS') ? 1 : 0);
    const strafe = (this.input.down('KeyD') ? 1 : 0) - (this.input.down('KeyA') ? 1 : 0);

    // movement direction in world space, rotated by where we're looking
    const dir = new THREE.Vector3(strafe, 0, -forward);
    if (dir.lengthSq() > 0) dir.normalize().applyAxisAngle(UP, this.yaw);

    const sprinting = this.input.down('ShiftLeft') || this.input.down('ShiftRight');
    const speed = sprinting ? this.config.sprintSpeed : this.config.walkSpeed;

    this.velocityY += this.config.gravity * dt;
    if (this.grounded) {
      if (this.velocityY < 0) this.velocityY = -2; // keep pressed onto the ground
      if (this.input.down('Space')) this.velocityY = this.config.jumpVelocity;
    }

    const desired = new RAPIER.Vector3(
      dir.x * speed * dt,
      this.velocityY * dt,
      dir.z * speed * dt,
    );
    this.controller.computeColliderMovement(this.collider, desired);
    this.grounded = this.controller.computedGrounded();
    const move = this.controller.computedMovement();

    const pos = this.body.translation();
    const next = new RAPIER.Vector3(pos.x + move.x, pos.y + move.y, pos.z + move.z);
    this.body.setNextKinematicTranslation(next);

    this.prevPos.copy(this.currPos);
    this.currPos.set(next.x, next.y, next.z);

    if (this.currPos.y < RESPAWN_BELOW_Y) this.respawn();
  }

  /** Every rendered frame, after physics: place the camera (interpolated). */
  updateCamera(alpha: number) {
    const p = this.prevPos.clone().lerp(this.currPos, alpha);
    this.camera.position.set(p.x, p.y + EYE_HEIGHT, p.z);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  respawn() {
    this.teleport(SPAWN.x, SPAWN.y, SPAWN.z);
  }

  /** Instantly move the player (also used by dev tools). */
  teleport(x: number, y: number, z: number) {
    this.body.setTranslation(new RAPIER.Vector3(x, y, z), true);
    this.velocityY = 0;
    this.currPos.set(x, y, z);
    this.prevPos.set(x, y, z);
  }

  get position(): { x: number; y: number; z: number } {
    return { x: this.currPos.x, y: this.currPos.y, z: this.currPos.z };
  }

  get isGrounded(): boolean {
    return this.grounded;
  }

  get verticalVelocity(): number {
    return this.velocityY;
  }
}

import * as THREE from 'three';
import * as mapstore from './mapstore';

const R = 5;

/**
 * A rough 3D planet where your named maps are pins. Spin it (drag), zoom (wheel),
 * click a pin to drop into that map, or click empty land to pin the current map
 * there. This is the first crude form of the north-star: a shared Earth of
 * player-made places. (Real photoreal imagery and browsing other people's pins
 * come later, with a map service.)
 */
export class Globe {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  onEnterMap: ((id: string) => void) | null = null;
  onPlaceMap: ((lat: number, lng: number) => void) | null = null;
  hoveredName = '';

  private group = new THREE.Group();
  private pins: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();
  private dist = 15;
  private dragging = false;
  private moved = 0;
  private lastX = 0;
  private lastY = 0;
  private velX = 0;
  private velY = 0;
  private cursor = new THREE.Vector2();
  private lastAspect = 0;

  private onDown = (e: MouseEvent) => this.handleDown(e);
  private onMove = (e: MouseEvent) => this.handleMove(e);
  private onUp = (e: MouseEvent) => this.handleUp(e);
  private onWheel = (e: WheelEvent) => this.handleWheel(e);

  constructor(private canvas: HTMLElement) {
    this.scene.background = new THREE.Color(0x05070d);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
    sun.position.set(8, 5, 10);
    this.scene.add(sun);

    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(R, 64, 48),
      new THREE.MeshStandardMaterial({ map: earthTexture(), roughness: 0.95, metalness: 0 }),
    );
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.06, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0x5b8cff, transparent: true, opacity: 0.12, side: THREE.BackSide }),
    );
    this.group.add(planet, atmosphere);
    this.scene.add(this.group);
    this.scene.add(makeStars());

    this.group.rotation.y = -1.2;
  }

  enter() {
    this.refreshPins();
    this.canvas.addEventListener('mousedown', this.onDown);
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('mouseup', this.onUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: true });
  }

  exit() {
    this.dragging = false;
    this.canvas.removeEventListener('mousedown', this.onDown);
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('mouseup', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  refreshPins() {
    for (const pin of this.pins) {
      this.group.remove(pin);
      pin.geometry.dispose();
      (pin.material as THREE.Material).dispose();
    }
    this.pins = [];
    for (const info of mapstore.listMaps()) {
      if (!info.location) continue;
      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xffd24a }),
      );
      pin.position.copy(latLngToVec(info.location.lat, info.location.lng, R + 0.08));
      pin.userData = { id: info.id, name: info.name };
      this.group.add(pin);
      this.pins.push(pin);
    }
  }

  update(dt: number) {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    if (aspect !== this.lastAspect) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
      this.lastAspect = aspect;
    }
    if (!this.dragging) {
      this.group.rotation.y += this.velX + 0.04 * dt; // gentle idle spin
      this.group.rotation.x += this.velY;
      this.velX *= 0.94;
      this.velY *= 0.94;
    }
    this.group.rotation.x = Math.max(-1.2, Math.min(1.2, this.group.rotation.x));
    this.camera.position.set(0, 0, this.dist);
    this.camera.lookAt(0, 0, 0);
  }

  // --- input ---------------------------------------------------------------

  private handleDown(e: MouseEvent) {
    if (e.button !== 0) return;
    this.dragging = true;
    this.moved = 0;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.velX = 0;
    this.velY = 0;
  }

  private handleMove(e: MouseEvent) {
    this.cursor.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1,
    );
    if (this.dragging) {
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.moved += Math.abs(dx) + Math.abs(dy);
      this.velX = dx * 0.005;
      this.velY = dy * 0.005;
      this.group.rotation.y += this.velX;
      this.group.rotation.x += this.velY;
    } else {
      this.updateHover();
    }
  }

  private handleUp(e: MouseEvent) {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.moved < 6) this.handleClick(); // a click, not a drag
  }

  private handleWheel(e: WheelEvent) {
    this.dist = Math.max(8, Math.min(30, this.dist + e.deltaY * 0.01));
  }

  private updateHover() {
    this.raycaster.setFromCamera(this.cursor, this.camera);
    const hit = this.raycaster.intersectObjects(this.pins, false)[0];
    this.hoveredName = hit ? (hit.object.userData.name as string) : '';
  }

  private handleClick() {
    this.raycaster.setFromCamera(this.cursor, this.camera);
    const pinHit = this.raycaster.intersectObjects(this.pins, false)[0];
    if (pinHit) {
      this.onEnterMap?.(pinHit.object.userData.id as string);
      return;
    }
    // empty land — place the current map here
    const ground = this.raycaster.intersectObject(this.group.children[0]!, false)[0];
    if (ground) {
      const local = this.group.worldToLocal(ground.point.clone());
      const { lat, lng } = vecToLatLng(local);
      this.onPlaceMap?.(lat, lng);
    }
  }
}

function latLngToVec(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lng + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function vecToLatLng(v: THREE.Vector3): { lat: number; lng: number } {
  const r = v.length() || 1;
  const lat = 90 - (Math.acos(v.y / r) * 180) / Math.PI;
  let lng = (Math.atan2(v.z, -v.x) * 180) / Math.PI - 180;
  while (lng < -180) lng += 360;
  while (lng > 180) lng -= 360;
  return { lat, lng };
}

/** A rough stylised Earth drawn on a canvas (no external assets). */
function earthTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#16335f');
  g.addColorStop(0.5, '#214f87');
  g.addColorStop(1, '#16335f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const xy = (lat: number, lng: number) => [((lng + 180) / 360) * W, ((90 - lat) / 180) * H];
  const land = (lat: number, lng: number, rxDeg: number, ryDeg: number, col: string) => {
    const [x, y] = xy(lat, lng);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(x!, y!, (rxDeg / 360) * W, (ryDeg / 180) * H, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  const a = '#3f7d4a';
  const b = '#4c8c5a';
  const t = '#7c8a48';
  land(50, -100, 26, 17, a); // N America
  land(62, -150, 10, 8, a);
  land(-12, -60, 12, 22, a); // S America
  land(52, 15, 13, 9, b); // Europe
  land(2, 20, 16, 26, a); // Africa
  land(48, 92, 34, 20, b); // Asia
  land(-25, 134, 13, 8, t); // Australia

  ctx.fillStyle = '#e6eef5';
  ctx.fillRect(0, 0, W, H * 0.05);
  ctx.fillRect(0, H * 0.95, W, H * 0.05);

  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (let lng = -180; lng <= 180; lng += 30) {
    const [x] = xy(0, lng);
    ctx.beginPath();
    ctx.moveTo(x!, 0);
    ctx.lineTo(x!, H);
    ctx.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const [, y] = xy(lat, 0);
    ctx.beginPath();
    ctx.moveTo(0, y!);
    ctx.lineTo(W, y!);
    ctx.stroke();
  }

  return new THREE.CanvasTexture(c);
}

function makeStars(): THREE.Points {
  const n = 600;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(40 + (i % 20));
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = v.y;
    pos[i * 3 + 2] = v.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.18 }));
}

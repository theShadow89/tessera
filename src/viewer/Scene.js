import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

const PART_COLORS = [
  0x4f8ef7, 0xf7844f, 0x5fc98a, 0xf75f9c, 0xc95fef,
  0xefd15f, 0x5fdfef, 0xa0a0a0, 0xef5f5f, 0x8aef5f,
];

/**
 * Thin three.js scene manager: renderer, camera, lights, and a set of meshes
 * that can be rendered as one whole model or as exploded parts.
 */
export class Scene {
  constructor(container) {
    this.container = container;
    this.parts = []; // { mesh, center }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1c22);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
    this.camera.position.set(150, 120, 200);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(1, 2, 1.5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-1, -0.5, -1);
    this.scene.add(fill);

    this.grid = new THREE.GridHelper(500, 20, 0x444444, 0x2a2a2a);
    this.scene.add(this.grid);

    // Gizmo for dragging manual cut planes along their normal axis.
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setMode('translate');
    this.transform.setTranslationSnap(1); // whole millimetres
    this.transform.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (!e.value) this._commitDrag();
    });
    // getHelper() returns the Object3D that actually holds the gizmo meshes.
    this._transformHelper = this.transform.getHelper();
    this.scene.add(this._transformHelper);
    this._planeMeshes = [];
    this._editable = false;
    this._onPlaneChange = null;
    this._ray = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._onPointerDown = this._onPointerDown.bind(this);
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._onResize();

    this._explode = 0;
    this._animate();
  }

  /** Register a callback fired when a plane is dragged: (index, offset) => void. */
  setPlaneChangeHandler(fn) {
    this._onPlaneChange = fn;
  }

  _onPointerDown(ev) {
    if (!this._editable || this.transform.dragging) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this._ray.setFromCamera(this._pointer, this.camera);
    const hits = this._ray.intersectObjects(this._planeMeshes, false);
    if (hits.length) {
      const mesh = hits[0].object;
      this.transform.attach(mesh);
      const axis = mesh.userData.axis;
      this.transform.showX = axis === 'x';
      this.transform.showY = axis === 'y';
      this.transform.showZ = axis === 'z';
    } else if (this.transform.axis === null) {
      // Clicked empty space and not on a gizmo handle: deselect.
      this.transform.detach();
    }
  }

  _commitDrag() {
    const mesh = this.transform.object;
    if (!mesh || !this._onPlaneChange) return;
    const axis = mesh.userData.axis;
    this._onPlaneChange(mesh.userData.index, mesh.position[axis]);
  }

  _onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h || 1;
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    this._raf = requestAnimationFrame(() => this._animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Draw translucent quads where the model will be cut. Sized to the model bbox
   * so the user sees each plane in context. Axis-aligned planes only.
   *
   * @param {Array<{normal:number[], offset:number, index?:number}>} planes
   * @param {{min:{x,y,z}, max:{x,y,z}}} bbox model bounding box
   * @param {boolean} [editable] when true, planes can be dragged via the gizmo
   */
  setCutPlanes(planes, bbox, editable = false) {
    this.clearCutPlanes();
    this._editable = editable && !!planes && planes.length > 0;
    if (!planes || !bbox) return;
    const size = {
      x: bbox.max.x - bbox.min.x,
      y: bbox.max.y - bbox.min.y,
      z: bbox.max.z - bbox.min.z,
    };
    const center = {
      x: (bbox.min.x + bbox.max.x) / 2,
      y: (bbox.min.y + bbox.max.y) / 2,
      z: (bbox.min.z + bbox.max.z) / 2,
    };
    const pad = 1.08; // slightly overhang the model so the plane reads as a full cut
    this.planesGroup = new THREE.Group();
    this._planeMeshes = [];
    planes.forEach((p, i) => {
      const axis = p.normal[0] ? 'x' : p.normal[1] ? 'y' : 'z';
      // PlaneGeometry lies in XY (normal +Z); size it to the two in-plane extents.
      const dims = { x: [size.y, size.z], y: [size.x, size.z], z: [size.x, size.y] }[axis];
      const geo = new THREE.PlaneGeometry(dims[0] * pad, dims[1] * pad);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x4f8ef7,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      if (axis === 'x') mesh.rotation.y = Math.PI / 2;
      else if (axis === 'y') mesh.rotation.x = Math.PI / 2;
      mesh.position.set(
        axis === 'x' ? p.offset : center.x,
        axis === 'y' ? p.offset : center.y,
        axis === 'z' ? p.offset : center.z
      );
      mesh.userData = { axis, index: p.index ?? i };
      this.planesGroup.add(mesh);
      this._planeMeshes.push(mesh);
    });
    this.scene.add(this.planesGroup);
  }

  clearCutPlanes() {
    // Detach the gizmo before disposing the mesh it may point at.
    if (this.transform) this.transform.detach();
    this._planeMeshes = [];
    if (!this.planesGroup) return;
    this.scene.remove(this.planesGroup);
    for (const mesh of this.planesGroup.children) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.planesGroup = null;
  }

  clearParts() {
    for (const { mesh } of this.parts) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.parts = [];
  }

  /**
   * Replace the displayed parts.
   * @param {THREE.BufferGeometry[]} geometries
   * @param {THREE.Vector3} modelCenter  overall model centroid, for explode direction
   */
  setParts(geometries, modelCenter) {
    this.clearParts();
    geometries.forEach((geo, i) => {
      const material = new THREE.MeshStandardMaterial({
        color: PART_COLORS[i % PART_COLORS.length],
        metalness: 0.1,
        roughness: 0.7,
        flatShading: false,
      });
      const mesh = new THREE.Mesh(geo, material);
      const center = geo.boundingBox.getCenter(new THREE.Vector3());
      this.parts.push({ mesh, center, base: center.clone() });
      this.scene.add(mesh);
    });
    this._modelCenter = modelCenter.clone();
    this.setExplode(this._explode);
  }

  /** @param {number} factor  0 = assembled, higher = parts pushed outward */
  setExplode(factor) {
    this._explode = factor;
    if (!this._modelCenter) return;
    for (const p of this.parts) {
      const dir = p.base.clone().sub(this._modelCenter);
      const offset = dir.multiplyScalar(factor);
      p.mesh.position.copy(offset);
    }
  }

  frameAll() {
    const box = new THREE.Box3();
    for (const { mesh } of this.parts) box.expandByObject(mesh);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z);
    this.controls.target.copy(center);
    const dist = radius * 2.2;
    this.camera.position.copy(center).add(new THREE.Vector3(dist, dist * 0.8, dist));
    this.camera.near = radius / 100;
    this.camera.far = radius * 100;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this.clearCutPlanes();
    // TransformControls.dispose() assumes it is an Object3D (it is not in this
    // three version), so disconnect listeners and dispose the helper directly.
    this.transform.detach();
    this.transform.disconnect();
    this.scene.remove(this._transformHelper);
    this._transformHelper.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
    this.clearParts();
    this.controls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}

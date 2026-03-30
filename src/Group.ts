import {
  Group as ThreeGroup,
  Mesh,
  PlaneGeometry,
  MeshBasicNodeMaterial,
  Color,
  Box3,
  Vector3,
} from "three/webgpu";

// 1×1 plane — scale drives the size each frame
const _geo = new PlaneGeometry(1, 1);

// Module-level temporaries to avoid per-frame allocations
const _box = new Box3();
const _v = new Vector3();
const _wBL = new Vector3();
const _wBR = new Vector3();
const _wTL = new Vector3();
const _wCenter = new Vector3();

export class Group extends ThreeGroup {
  private readonly _plane: Mesh;

  constructor() {
    super();

    this._plane = new Mesh(
      _geo,
      new MeshBasicNodeMaterial({ color: new Color(0xff2020), side: 2, depthWrite: false }),
    );
    this._plane.renderOrder = -1;

    this._plane.onBeforeRender = (_renderer, _scene, camera) => {
      // Billboard — copy camera orientation so the plane always faces it
      this._plane.quaternion.copy(camera.quaternion);

      // Compute world-space bounding box of all siblings (skip the plane itself)
      _box.makeEmpty();
      for (const child of this.children) {
        if (child !== this._plane) _box.expandByObject(child, true);
      }
      if (_box.isEmpty()) return;

      // Project all 8 corners of the box to NDC and track the 2D extents
      let nMinX = Infinity,
        nMaxX = -Infinity,
        nMinY = Infinity,
        nMaxY = -Infinity;
      const { min, max } = _box;
      for (let i = 0; i < 8; i++) {
        _v.set(
          i & 1 ? max.x : min.x,
          i & 2 ? max.y : min.y,
          i & 4 ? max.z : min.z,
        ).project(camera);
        if (_v.x < nMinX) nMinX = _v.x;
        if (_v.x > nMaxX) nMaxX = _v.x;
        if (_v.y < nMinY) nMinY = _v.y;
        if (_v.y > nMaxY) nMaxY = _v.y;
      }

      // NDC z from box center → plane is placed at the content's average depth
      _box.getCenter(_v).project(camera);
      const ndcZ = _v.z;

      // Unproject the 4 NDC bbox corners back to world space at that depth
      _wBL.set(nMinX, nMinY, ndcZ).unproject(camera);
      _wBR.set(nMaxX, nMinY, ndcZ).unproject(camera);
      _wTL.set(nMinX, nMaxY, ndcZ).unproject(camera);
      _wCenter
        .set((nMinX + nMaxX) * 0.5, (nMinY + nMaxY) * 0.5, ndcZ)
        .unproject(camera);

      // Convert to group-local space (accounts for group position/rotation/scale)
      this._plane.position.copy(this.worldToLocal(_wCenter));
      this.worldToLocal(_wBL);
      this.worldToLocal(_wBR);
      this.worldToLocal(_wTL);

      // Edge lengths in local space give the correct plane scale
      this._plane.scale.set(_wBL.distanceTo(_wBR), _wBL.distanceTo(_wTL), 1);
    };

    this.add(this._plane);
  }
}

import {
  Group as ThreeGroup,
  Mesh,
  PlaneGeometry,
  MeshBasicNodeMaterial,
  Color,
  Camera,
} from "three/webgpu";

const _planeGeometry = new PlaneGeometry(1.4, 1.4);

export class Group extends ThreeGroup {
  private readonly _plane: Mesh;

  constructor() {
    super();

    this._plane = new Mesh(
      _planeGeometry,
      new MeshBasicNodeMaterial({ color: new Color(0xff2020), side: 2 }),
    );

    this.add(this._plane);
  }

  /**
   * Call once per frame so the plane faces the camera.
   */
  updateCamera(camera: Camera): void {
    this._plane.quaternion.copy(camera.quaternion);
  }
}

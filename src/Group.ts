import {
  Group as ThreeGroup,
  Mesh,
  PlaneGeometry,
  MeshBasicNodeMaterial,
  Color,
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

    this._plane.onBeforeRender = (_renderer, _scene, camera) => {
      this._plane.quaternion.copy(camera.quaternion);
    };

    this.add(this._plane);
  }
}

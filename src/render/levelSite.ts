import * as THREE from 'three';
import { lit } from './models/materials';
import { waterMaterial } from './water';
import { KIND_COL, type Level, type LevelBox } from '../levels/levels';
import { levelBoxes, levelSize, levelSofts } from '../levels/setup';

// Escenario de un nivel: la obra (84 × 56 m con el color de suelo del nivel), las cajas de la referencia
// (edificios, muros, pilas, camiones, contenedores…) en un InstancedMesh con color por instancia, los depósitos
// como cilindros (otro InstancedMesh), el terreno blando, las zonas de destino y los cables de las líneas
// eléctricas. Pocos draw calls: 2 instanciados + zonas (2) + cables (1) + terreno blando.

const SOFT_COLOR = { mud: '#54432f', water: '#28465e' };
const ZONE_COLOR = '#4cc38a';

export function buildLevelSite(scene: THREE.Scene, L: Level) {
  // suelo de la obra, encima del terreno general, con un borde (fase 10: el nivel de tándem es más grande)
  const [WW, WD] = levelSize(L);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WW, WD), lit({
    color: lighten(L.ground), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(WW / 2, 0.005, WD / 2);
  ground.receiveShadow = true;
  scene.add(ground);
  const edge = [[0, 0], [WW, 0], [WW, WD], [0, WD], [0, 0]].map(([x, z]) => new THREE.Vector3(x, 0.03, z));
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(edge), new THREE.LineBasicMaterial({ color: '#f0bb27' })));

  for (const s of levelSofts(L)) {
    // agua con ondas (fase 16)
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.d), s.kind === 'water' ? waterMaterial(SOFT_COLOR.water, -2) : lit({
      color: SOFT_COLOR[s.kind], polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(s.x, 0.012, s.z);
    m.receiveShadow = true;
    scene.add(m);
  }

  const boxes = levelBoxes(L);
  const tanks = boxes.filter((b) => b.kind === 'tank'), rest = boxes.filter((b) => b.kind !== 'tank');
  scene.add(instanced(new THREE.BoxGeometry(1, 1, 1), rest));
  if (tanks.length) scene.add(instanced(new THREE.CylinderGeometry(0.5, 0.5, 1, 20), tanks));

  // zonas de destino: placa translúcida y contorno a su altura de apoyo
  const zoneMat = new THREE.MeshBasicMaterial({ color: ZONE_COLOR, transparent: true, opacity: 0.28, depthWrite: false });
  const zg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const zones = new THREE.InstancedMesh(zg, zoneMat, L.zones.length);
  const m4 = new THREE.Matrix4(), pts: number[] = [];
  L.zones.forEach((z, i) => {
    const y = z.y + 0.04;
    zones.setMatrixAt(i, m4.makeScale(z.w, 1, z.d).setPosition(z.x, y, z.z));
    const x0 = z.x - z.w / 2, x1 = z.x + z.w / 2, z0 = z.z - z.d / 2, z1 = z.z + z.d / 2;
    const c = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    for (let k = 0; k < 4; k++) pts.push(c[k][0], y, c[k][1], c[(k + 1) % 4][0], y, c[(k + 1) % 4][1]);
  });
  scene.add(zones);
  const zl = new THREE.BufferGeometry();
  zl.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.LineSegments(zl, new THREE.LineBasicMaterial({ color: ZONE_COLOR })));

  // cables de las líneas eléctricas
  if (L.lines?.length) {
    const wp: number[] = [];
    for (const l of L.lines) for (const off of [-0.5, 0, 0.5]) {
      const vertical = l.a[0] === l.b[0];
      const dx = vertical ? off : 0, dz = vertical ? 0 : off;
      wp.push(l.a[0] + dx, l.y, l.a[1] + dz, l.b[0] + dx, l.y, l.b[1] + dz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#1d1f22' })));
    // franja de seguridad: cilindro translúcido con el radio de la distancia mínima (`clear`) a lo largo del conductor
    const band = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: '#e8573f', transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }), L.lines.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3();
    L.lines.forEach((l, i) => {
      d.set(l.b[0] - l.a[0], 0, l.b[1] - l.a[1]);
      const len = d.length();
      q.setFromUnitVectors(up, d.normalize());
      m.compose(new THREE.Vector3((l.a[0] + l.b[0]) / 2, l.y, (l.a[1] + l.b[1]) / 2), q, new THREE.Vector3(l.clear, len, l.clear));
      band.setMatrixAt(i, m);
    });
    band.renderOrder = 1;
    scene.add(band);
  }
}

function instanced(geo: THREE.BufferGeometry, list: LevelBox[]) {
  const mesh = new THREE.InstancedMesh(geo, lit(), list.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  list.forEach((b, i) => {
    mesh.setMatrixAt(i, m4.makeScale(b.w, b.h, b.d).setPosition(b.x, b.h / 2, b.z));
    mesh.setColorAt(i, col.set(b.color ?? KIND_COL[b.kind]));
  });
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** Los suelos de la referencia son muy oscuros para una vista 3D con luz: se aclaran un poco */
function lighten(hex: string) {
  return '#' + new THREE.Color(hex).lerp(new THREE.Color('#8f8a7a'), 0.45).getHexString();
}

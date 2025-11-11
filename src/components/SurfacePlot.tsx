import { useEffect, useRef } from "react";
import * as THREE from "three";
import { compileExpression3 } from "../utils/compileExpression";

type Point3 = { x: number; y: number; z: number };
type DataSet = {
  name?: string;
  points: Point3[];
  color?: string;
  opacity?: number;
  size?: number; // for points
  type?: "points" | "mesh";
};

type Props =
  | {
      expression: string;
      range: number;
      resolution: number;
      dataSets?: undefined;
    }
  | {
      dataSets: DataSet[];
      // expression/range/resolution optional when using dataSets
      expression?: undefined;
      range?: number;
      resolution?: number;
    };

export default function Surface(props: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const fnRef = useRef<((x: number, y: number, t: number) => number) | null>(null);
  const RANGE_FALLBACK = 4;
  const RES_FALLBACK = 80;
  const isDataMode = Array.isArray((props as any).dataSets);
  const propExpression = (props as any).expression as string | undefined;
  const propRange = (props as any).range as number | undefined;
  const propResolution = (props as any).resolution as number | undefined;

  useEffect(() => {
    if (isDataMode) {
      fnRef.current = null;
      return;
    }
    const expression = propExpression ?? "0";
    fnRef.current = compileExpression3(expression);
  }, [propExpression, (props as any).dataSets, isDataMode]);

  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    const usedRange = propRange ?? RANGE_FALLBACK;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, -usedRange * 3, usedRange * 1.8);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    // lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, -5, 10);
    scene.add(dir);

    // grid helper (use provided range if available)
    const usedRangeForGrid = propRange ?? RANGE_FALLBACK;
    const grid = new THREE.GridHelper(usedRangeForGrid * 2, 10, 0x222222, 0x888888);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    // material
    const mat = new THREE.MeshStandardMaterial({
      side: THREE.DoubleSide,
      flatShading: false,
      vertexColors: true,
    });

    // geometry creation modes: expression-driven mesh OR dataSets-driven point clouds
    let mesh: THREE.Mesh | THREE.Points | THREE.Group | null = null;

    const makeExpressionGeometry = (t: number) => {
    const cols = propResolution ?? RES_FALLBACK;
    const rows = propResolution ?? RES_FALLBACK;
      const usedRange2 = propRange ?? RANGE_FALLBACK;
      const widthSpan = usedRange2 * 2;
      const heightSpan = usedRange2 * 2;
      const geometry = new THREE.BufferGeometry();

      const positions: number[] = [];
      const normals: number[] = [];
      const colors: number[] = [];
      const indices: number[] = [];
      const validity: boolean[] = [];

      for (let j = 0; j <= rows; j++) {
        for (let i = 0; i <= cols; i++) {
          const u = i / cols;
          const v = j / rows;
          const x = (u - 0.5) * widthSpan;
          const y = (v - 0.5) * heightSpan;

          const evaluator = fnRef.current;
          const rawZ = evaluator ? evaluator(x, y, t) : NaN;
          const isValid = Number.isFinite(rawZ);
          const z = isValid ? Number(rawZ) : 0;
          validity.push(isValid);

          positions.push(x, y, z);
          normals.push(0, 0, 1);

          const c = new THREE.Color();
          if (isValid) {
            const normalized = THREE.MathUtils.clamp((z + usedRange2) / (2 * usedRange2), 0, 1);
            c.setHSL(0.7 - normalized * 0.7, 0.8, 0.5);
          } else {
            c.setRGB(0.75, 0.75, 0.75);
          }
          colors.push(c.r, c.g, c.b);
        }
      }

      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const a = i + (cols + 1) * j;
          const b = i + (cols + 1) * (j + 1);
          const c = i + 1 + (cols + 1) * (j + 1);
          const d = i + 1 + (cols + 1) * j;
          if (validity[a] && validity[b] && validity[d]) {
            indices.push(a, b, d);
          }
          if (validity[b] && validity[c] && validity[d]) {
            indices.push(b, c, d);
          }
        }
      }

      geometry.setIndex(indices);
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      return geometry;
    };

    const makeFromDataSets = (dataSets: DataSet[]) => {
      const group = new THREE.Group();
      dataSets.forEach((ds) => {
        const pts = ds.points || [];
        if (pts.length === 0) return;
        // If points form a perfect square grid (n = (M+1)^2) we can build a mesh
        const n = pts.length;
        const k = Math.round(Math.sqrt(n));
        const color = new THREE.Color(ds.color || "#ff0000");
        if (k * k === n && (ds.type !== "points")) {
          // build mesh from grid points
          const cols = k - 1;
          const rows = k - 1;
          const positions: number[] = [];
          const colors: number[] = [];
          for (let j = 0; j < k; j++) {
            for (let i = 0; i < k; i++) {
              const p = pts[j * k + i];
              positions.push(p.x, p.y, p.z);
              colors.push(color.r, color.g, color.b);
            }
          }

          const indices: number[] = [];
          for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols; i++) {
              const a = i + (cols + 1) * j;
              const b = i + (cols + 1) * (j + 1);
              const c = i + 1 + (cols + 1) * (j + 1);
              const d = i + 1 + (cols + 1) * j;
              indices.push(a, b, d);
              indices.push(b, c, d);
            }
          }

          const geom = new THREE.BufferGeometry();
          geom.setIndex(indices);
          geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
          geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
          geom.computeVertexNormals();

          const matMesh = new THREE.MeshStandardMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
            transparent: ds.opacity !== undefined && ds.opacity < 1,
            opacity: ds.opacity ?? 1,
          });
          const meshObj = new THREE.Mesh(geom, matMesh);
          group.add(meshObj);
        } else {
          // fallback: render as points
          const positions: number[] = [];
          const colors: number[] = [];
          pts.forEach((p) => {
            positions.push(p.x, p.y, p.z);
            colors.push(color.r, color.g, color.b);
          });

          const geom = new THREE.BufferGeometry();
          geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
          geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

          const size = ds.size ?? 1.5;
          const material = new THREE.PointsMaterial({ size, vertexColors: true, transparent: ds.opacity !== undefined && ds.opacity < 1, opacity: ds.opacity ?? 1 });
          const points = new THREE.Points(geom, material);
          group.add(points);
        }
      });
      return group;
    };

    // initial object
    if (isDataMode) {
      mesh = makeFromDataSets((props as any).dataSets as DataSet[]);
      scene.add(mesh);
    } else {
      mesh = new THREE.Mesh(makeExpressionGeometry(0), mat);
      scene.add(mesh);
    }

    // orbit control minimal (manual)
    let isDown = false;
    let startX = 0, startY = 0;
    let rotX = 0, rotY = 0;

    const onPointerDown = (e: PointerEvent) => {
      isDown = true;
      startX = e.clientX;
      startY = e.clientY;
    };
    const onPointerUp = () => {
      isDown = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isDown) return;
      const dx = (e.clientX - startX) * 0.01;
      const dy = (e.clientY - startY) * 0.01;
      startX = e.clientX; startY = e.clientY;
      rotX += dy;
      rotY += dx;
    };

    container.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointermove", onPointerMove);

    let frame = 0;
    let lastRes = propResolution ?? RES_FALLBACK;
    let lastRange = propRange ?? RANGE_FALLBACK;
    let rafId = 0;
    const animate = () => {
      frame += 1;
      const t = frame / 60;

      // If using expression-driven mesh, rebuild when params change.
      if (!isDataMode) {
        const usedRes = propResolution ?? RES_FALLBACK;
        const usedRange2 = propRange ?? RANGE_FALLBACK;
        if (lastRes !== usedRes || lastRange !== usedRange2) {
          if (mesh && (mesh as any).geometry) {
            scene.remove(mesh);
            (mesh as any).geometry.dispose();
          }
          mesh = new THREE.Mesh(makeExpressionGeometry(t), mat);
          scene.add(mesh);
          lastRes = usedRes;
          lastRange = usedRange2;
        } else {
          if (mesh && (mesh as any).geometry) {
            const newGeo = makeExpressionGeometry(t);
            (mesh as any).geometry.dispose();
            (mesh as any).geometry = newGeo;
          }
        }
      }

      // simple rotation from pointer
      if (mesh) {
        mesh.rotation.x = rotX;
        mesh.rotation.z = rotY;
      }

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);

    // handle resize
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    // cleanup
    return () => {
  window.removeEventListener("resize", onResize);
  container.removeEventListener("pointerdown", onPointerDown);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointermove", onPointerMove);
  cancelAnimationFrame(rafId);
      container.removeChild(renderer.domElement);
      renderer.dispose();
      scene.traverse((o) => {
        // @ts-ignore
        if (o.geometry) o.geometry.dispose();
        // @ts-ignore
        if (o.material) {
          // @ts-ignore
          if (Array.isArray(o.material)) o.material.forEach((m:any)=>m.dispose());
          // @ts-ignore
          else o.material.dispose();
        }
      });
    };
  }, [propResolution, propRange, propExpression, (props as any).dataSets]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
}

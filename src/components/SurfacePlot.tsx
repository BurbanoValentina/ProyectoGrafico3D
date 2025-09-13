import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { compile, evaluate, parse } from "mathjs";

type Props = {
  expression: string;
  range: number;
  resolution: number;
};

export default function Surface({ expression, range, resolution }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const fnRef = useRef<any>(null);

  useEffect(() => {
    // compile expression safely with Math.* allowed by using raw JS eval fallback:
    // We'll compile into a function (x,y,t) -> number
    // Allow users to write using Math.* or shorthand like sin(x) -> Math.sin(x)
    // For simplicity here we transform common math names to Math.* if present
    const safeExpr = expression
      .replace(/\b(sin|cos|tan|sqrt|abs|pow|exp|log|min|max|floor|ceil)\b/g, (m) => `Math.${m}`);

    try {
      // Create a JS function that receives x,y,t and returns number
      // This uses the Function constructor; in product you'd restrict further.
      // Example produced function: (x,y,t) => Math.sin(x+y) - 0.5*Math.cos(t*2)
      // NOTE: keep in mind security if running arbitrary user code on server (here it's client-side)
      // eslint-disable-next-line no-new-func
      const f = new Function("x", "y", "t", `return ${safeExpr};`);
      fnRef.current = f;
    } catch (err) {
      console.error("Error compiling expression", err);
      fnRef.current = (x:number,y:number,t:number) => 0;
    }
  }, [expression]);

  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, -range * 3, range * 1.8);
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

    // grid helper
    const grid = new THREE.GridHelper(range * 2, 10, 0x222222, 0x888888);
    grid.rotation.x = Math.PI/2;
    scene.add(grid);

    // material
    const mat = new THREE.MeshStandardMaterial({
      side: THREE.DoubleSide,
      flatShading: false,
      vertexColors: true,
    });

    // geometry and mesh creation function
    let mesh: THREE.Mesh | null = null;
    const makeGeometry = (t: number) => {
      const cols = resolution;
      const rows = resolution;
      const widthSpan = range * 2;
      const heightSpan = range * 2;
      const geometry = new THREE.BufferGeometry();

      const positions: number[] = [];
      const normals: number[] = [];
      const colors: number[] = [];
      const indices: number[] = [];

      // create grid of vertices
      for (let j = 0; j <= rows; j++) {
        for (let i = 0; i <= cols; i++) {
          const u = i / cols;
          const v = j / rows;
          const x = (u - 0.5) * widthSpan;
          const y = (v - 0.5) * heightSpan;

          let z = 0;
          try {
            const f = fnRef.current;
            z = Number(f ? f(x, y, t) : 0) || 0;
          } catch (err) {
            z = 0;
          }

          positions.push(x, y, z);

          // temporary normals placeholder
          normals.push(0, 0, 1);

          // color gradient based on z
          const c = new THREE.Color();
          const normalized = (z + range) / (2 * range);
          c.setHSL(0.7 - normalized * 0.7, 0.8, 0.5);
          colors.push(c.r, c.g, c.b);
        }
      }

      // indices for triangles
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

      geometry.setIndex(indices);
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

      geometry.computeVertexNormals();
      return geometry;
    };

    // initial mesh
    mesh = new THREE.Mesh(makeGeometry(0), mat);
    scene.add(mesh);

    // orbit control minimal (manual)
    let isDown = false;
    let startX = 0, startY = 0;
    let rotX = 0, rotY = 0;

    container.addEventListener("pointerdown", (e) => {
      isDown = true;
      startX = e.clientX;
      startY = e.clientY;
    });
    window.addEventListener("pointerup", ()=> isDown = false);
    window.addEventListener("pointermove", (e) => {
      if (!isDown) return;
      const dx = (e.clientX - startX) * 0.01;
      const dy = (e.clientY - startY) * 0.01;
      startX = e.clientX; startY = e.clientY;
      rotX += dy;
      rotY += dx;
    });

    let frame = 0;
    let lastRes = resolution;
    let lastRange = range;
    const animate = () => {
      frame += 1;
      const t = frame / 60;

      // rebuild geometry if params changed
      if (lastRes !== resolution || lastRange !== range) {
        if (mesh) {
          scene.remove(mesh);
          mesh.geometry.dispose();
        }
        mesh = new THREE.Mesh(makeGeometry(t), mat);
        scene.add(mesh);
        lastRes = resolution;
        lastRange = range;
      } else {
        // update vertex z positions to animate (without full rebuild)
        // For simplicity we rebuild the geometry a bit less often:
        if (mesh) {
          const newGeo = makeGeometry(t);
          mesh.geometry.dispose();
          mesh.geometry = newGeo;
        }
      }

      // simple rotation from pointer
      if (mesh) {
        mesh.rotation.x = rotX;
        mesh.rotation.z = rotY;
      }

      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);

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
  }, [resolution, range, expression]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
}

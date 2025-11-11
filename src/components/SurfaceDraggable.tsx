// SurfaceDraggable.tsx
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

type Props = {
    /** expresión JS: puedes usar sin, cos, sqrt... (se transforman a Math.*) */
    expression: string;
    /** medio-lado del dominio cuadrado [-range, range] × [-range, range] */
    range: number;
    /** resolución de la malla */
    resolution: number;
};

type FnXYT = (x: number, y: number, t: number) => number;

function compileExpr(expr: string): FnXYT {
    const safeExpr = expr.replace(
        /\b(sin|cos|tan|asin|acos|atan|sqrt|abs|pow|exp|log|min|max|floor|ceil|sinh|cosh|tanh)\b/g,
        (m) => `Math.${m}`
    );
    try {
        // eslint-disable-next-line no-new-func
        const f = new Function("x", "y", "t", `return (${safeExpr});`) as FnXYT;
        return (x, y, t) => {
            const v = f(x, y, t);
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
        };
    } catch {
        return () => 0;
    }
}

export default function SurfaceDraggable({ expression, range, resolution }: Props) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const fn = useMemo(() => compileExpr(expression), [expression]);

    useEffect(() => {
        if (!mountRef.current) return;
        const container = mountRef.current;

        // tamaños
        const width = container.clientWidth;
        const height = container.clientHeight;

        // escena básica
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xffffff);

        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
        camera.position.set(0, -range * 3, range * 1.8);
        camera.up.set(0, 0, 1);
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(renderer.domElement);

        // luces
        const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
        scene.add(hemi);
        const dir = new THREE.DirectionalLight(0xffffff, 0.9);
        dir.position.set(5, -5, 10);
        scene.add(dir);

        // Grupo "mundo" que contiene TODO lo visible para poder panearlo junto
        const world = new THREE.Group();
        scene.add(world);

    // grilla (rotada a XY)
    let grid = new THREE.GridHelper(range * 2, 10, 0x222222, 0x888888);
        // @ts-ignore
        grid.rotation.x = Math.PI / 2;
        world.add(grid);

        // material
        const mat = new THREE.MeshStandardMaterial({
            side: THREE.DoubleSide,
            flatShading: false,
            vertexColors: true,
        });

        // crea geometría de la superficie
        const makeGeometry = (t: number) => {
            const cols = Math.max(8, resolution);
            const rows = Math.max(8, resolution);
            const widthSpan = range * 2;
            const heightSpan = range * 2;

            const positions: number[] = [];
            const colors: number[] = [];
            const indices: number[] = [];

            for (let j = 0; j <= rows; j++) {
                for (let i = 0; i <= cols; i++) {
                    const u = i / cols;
                    const v = j / rows;
                    const x = -range + u * widthSpan;
                    const y = -range + v * heightSpan;
                    const z = Number(fn(x, y, t)) || 0;

                    positions.push(x, y, z);

                    const normalized = Math.min(1, Math.max(0, (z + range) / (2 * range)));
                    const c = new THREE.Color().setHSL(0.7 - normalized * 0.7, 0.8, 0.5);
                    colors.push(c.r, c.g, c.b);
                }
            }

            for (let j = 0; j < rows; j++) {
                for (let i = 0; i < cols; i++) {
                    const a = i + (cols + 1) * j;
                    const b = i + (cols + 1) * (j + 1);
                    const c = i + 1 + (cols + 1) * (j + 1);
                    const d = i + 1 + (cols + 1) * j;
                    indices.push(a, b, d, b, c, d);
                }
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setIndex(indices);
            geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
            geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
            geometry.computeVertexNormals();
            return geometry;
        };

        // malla
        let mesh = new THREE.Mesh(makeGeometry(0), mat);
        world.add(mesh);

        // —— Interacción: pan (arrastrar), zoom (rueda), rotación (Shift + arrastrar)
        const raycaster = new THREE.Raycaster();
        const planeXY = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // z=0

        let isDragging = false;
        let isRotating = false;
        let grabStartWorld = new THREE.Vector3(); // punto inicial en plano
        let worldStartPos = new THREE.Vector3();  // posición inicial del grupo
        let startMouseX = 0, startMouseY = 0;
        let startRotX = world.rotation.x, startRotZ = world.rotation.z;

        const setCursor = (c: string) => {
            (renderer.domElement.style as any).cursor = c;
        };

        const getPlaneHit = (clientX: number, clientY: number) => {
            const rect = renderer.domElement.getBoundingClientRect();
            const ndc = new THREE.Vector2(
                ((clientX - rect.left) / rect.width) * 2 - 1,
                -(((clientY - rect.top) / rect.height) * 2 - 1)
            );
            raycaster.setFromCamera(ndc, camera);
            const hit = new THREE.Vector3();
            raycaster.ray.intersectPlane(planeXY, hit);
            return hit;
        };

        const onPointerDown = (e: PointerEvent) => {
            if (e.shiftKey) {
                // rotación
                isRotating = true;
                startMouseX = e.clientX;
                startMouseY = e.clientY;
                startRotX = world.rotation.x;
                startRotZ = world.rotation.z;
                setCursor("grabbing");
                return;
            }
            // pan
            isDragging = true;
            grabStartWorld = getPlaneHit(e.clientX, e.clientY);
            worldStartPos.copy(world.position);
            setCursor("grabbing");
        };

        const onPointerMove = (e: PointerEvent) => {
            if (isRotating) {
                const dx = e.clientX - startMouseX;
                const dy = e.clientY - startMouseY;
                // sensibilidad suave
                world.rotation.x = startRotX + dy * 0.005;
                world.rotation.z = startRotZ + dx * 0.005;
                return;
            }
            if (!isDragging) return;
            const p = getPlaneHit(e.clientX, e.clientY);
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
            const delta = new THREE.Vector3().subVectors(p, grabStartWorld);
            // mover en XY (dejamos Z igual)
            world.position.set(worldStartPos.x + delta.x, worldStartPos.y + delta.y, worldStartPos.z);
        };

        const onPointerUp = () => {
            isDragging = false;
            isRotating = false;
            setCursor("grab");
        };

        const onWheel = (e: WheelEvent) => {
            // zoom hacia/desde el origen (simple)
            const factor = Math.exp(-e.deltaY * 0.001);
            const dir = camera.position.clone().sub(new THREE.Vector3(0, 0, 0));
            const newPos = new THREE.Vector3().addVectors(new THREE.Vector3(0, 0, 0), dir.multiplyScalar(factor));
            // límites de zoom
            const minDist = 2;
            const maxDist = 2000;
            const dist = newPos.length();
            if (dist > minDist && dist < maxDist) {
                camera.position.copy(newPos);
                camera.updateProjectionMatrix();
            }
        };

        renderer.domElement.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        renderer.domElement.addEventListener("wheel", onWheel, { passive: true });

        // cursor por defecto
        setCursor("grab");

        // animación (reconstruye z para permitir dependencia en t)
        let frame = 0;
        let lastRes = resolution;
        let lastRange = range;

        const animate = () => {
            frame += 1;
            const t = frame / 60;

            if (lastRes !== resolution || lastRange !== range) {
                world.remove(mesh);
                mesh.geometry.dispose();
                mesh = new THREE.Mesh(makeGeometry(t), mat);
                world.add(mesh);
                // actualizar grid al nuevo range
                world.remove(grid);
                (grid.geometry as THREE.BufferGeometry).dispose();
                const newGrid = new THREE.GridHelper(range * 2, 10, 0x222222, 0x888888);
                // @ts-ignore
                newGrid.rotation.x = Math.PI / 2;
                world.add(newGrid);
                // @ts-ignore
                (grid as any) = newGrid;

                lastRes = resolution;
                lastRange = range;
            } else {
                // refresco más barato: reconstruir geometría (para animación en t)
                const newGeo = makeGeometry(t);
                mesh.geometry.dispose();
                mesh.geometry = newGeo;
            }

            renderer.render(scene, camera);
            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);

        // resize
        const onResize = () => {
            const w = container.clientWidth;
            const h = container.clientHeight;
            renderer.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        };
        window.addEventListener("resize", onResize);

        // limpieza
        return () => {
            window.removeEventListener("resize", onResize);
            renderer.domElement.removeEventListener("pointerdown", onPointerDown);
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
            renderer.domElement.removeEventListener("wheel", onWheel);
            container.removeChild(renderer.domElement);
            renderer.dispose();

            scene.traverse((o) => {
                const anyO = o as any;
                if (anyO.geometry) anyO.geometry.dispose();
                if (anyO.material) {
                    if (Array.isArray(anyO.material)) anyO.material.forEach((m: any) => m.dispose());
                    else anyO.material.dispose();
                }
            });
        };
    }, [expression, range, resolution, fn]);

    return (
        <div
            ref={mountRef}
            style={{ width: "100%", height: "100%", position: "relative", userSelect: "none" }}
        />
    );
}

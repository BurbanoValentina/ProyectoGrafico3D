// src/components/GradientField3D.tsx
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";


/**
 * Componente: GradientField3D
 * Muestra la superficie z = f(x,y,t) y el campo gradiente ∇f(x,y) en el plano z=0.
 *
 * Props:
 *  - expression: función f(x,y,t) -> number
 *  - range: mitad del intervalo en x,y (dominio = [-range, range])
 *  - resolution: cantidad de muestras por eje para la superficie
 *  - vectors: cantidad de flechas por eje (para el campo gradiente)
 *  - t: parámetro de tiempo t
 *  - vectorScale: factor de escala para el largo de las flechas
 *  - step: h para diferencias finitas (derivadas parciales)
 */
type Props = {
    expression: (x: number, y: number, t: number) => number;
    range?: number;
    resolution?: number;
    vectors?: number;
    t?: number;
    vectorScale?: number;
    step?: number;
    height?: number; // altura a la que se dibuja la superficie centrada (default 0)
};

export default function GradientField3D({
    expression,
    range = 4,
    resolution = 80,
    vectors = 16,
    t = 0,
    vectorScale = 0.5,
    step = 1e-3,
    height = 0,
}: Props) {
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // --- Escena básica ---
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xffffff);

        const width = containerRef.current.clientWidth;
        const heightPx = Math.max(360, containerRef.current.clientHeight);

        const camera = new THREE.PerspectiveCamera(45, width / heightPx, 0.1, 1000);
        camera.position.set(9, 9, 9);
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, heightPx);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        containerRef.current.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;

        // --- Luces ---
        const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
        scene.add(hemi);
        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(5, 6, 4);
        scene.add(dir);

        // --- Grupo mundo ---
        const world = new THREE.Group();
        scene.add(world);

        // --- Grid en el plano z=0, rotado a XY ---
        const grid = new THREE.GridHelper(range * 2, 20, 0x888888, 0xdddddd);
        (grid.material as THREE.Material).transparent = true;
        (grid.material as THREE.Material).opacity = 0.7;
        world.add(grid);

        // Ejes (opcional, sutiles)
        const axes = new THREE.AxesHelper(range * 1.2);
        (axes.material as THREE.Material).transparent = true;
        (axes.material as THREE.Material).opacity = 0.35;
        world.add(axes);

        // --- Superficie z = f(x,y,t) ---
        const surfaceGeom = new THREE.PlaneGeometry(
            range * 2,
            range * 2,
            resolution,
            resolution
        );
        // PlaneGeometry está centrada; la rotamos para que coincida con XY y luego desplazamos vértices al z=f.
        surfaceGeom.rotateX(-Math.PI / 2);

        const pos = surfaceGeom.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getZ(i); // tras la rotación, Z del geometry es Y del mundo
            const z = expression(x, y, t) + height;
            pos.setY(i, z);
        }
        surfaceGeom.computeVertexNormals();

        const surfaceMat = new THREE.MeshStandardMaterial({
            color: 0xffa24d,
            side: THREE.DoubleSide,
            flatShading: false,
            metalness: 0.1,
            roughness: 0.95,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
        });

        const surfaceMesh = new THREE.Mesh(surfaceGeom, surfaceMat);
        world.add(surfaceMesh);

        // --- Campo gradiente (flechas) en z=0 ---
        const arrowsGroup = new THREE.Group();
        world.add(arrowsGroup);

        // Malla regular para las flechas
        const n = Math.max(2, vectors);
        for (let i = 0; i < n; i++) {
            const xi = -range + (2 * range * i) / (n - 1);
            for (let j = 0; j < n; j++) {
                const yj = -range + (2 * range * j) / (n - 1);

                // Derivadas numéricas centrales
                const fx =
                    (expression(xi + step, yj, t) - expression(xi - step, yj, t)) /
                    (2 * step);
                const fy =
                    (expression(xi, yj + step, t) - expression(xi, yj - step, t)) /
                    (2 * step);

                // Vector en el plano (fx, fy, 0)
                const v = new THREE.Vector3(fx, 0, fy);
                const length = v.length();

                if (Number.isFinite(length) && length > 1e-9) {
                    const dirNorm = v.clone().normalize();
                    const arrow = new THREE.ArrowHelper(
                        dirNorm,
                        new THREE.Vector3(xi, 0, yj),
                        Math.min(range * 0.35, length * vectorScale),
                        0x0033cc,
                        // tamaños de cabeza: proporcionados al largo
                        Math.min(0.35, 0.15 + 0.6 * Math.tanh(length)),
                        Math.min(0.2, 0.08 + 0.4 * Math.tanh(length))
                    );
                    arrowsGroup.add(arrow);
                }
            }
        }

        // --- Render loop ---
        let raf = 0;
        const render = () => {
            controls.update();
            renderer.render(scene, camera);
            raf = requestAnimationFrame(render);
        };
        render();

        // --- Resize ---
        const onResize = () => {
            if (!containerRef.current) return;
            const w = containerRef.current.clientWidth;
            const h = Math.max(360, containerRef.current.clientHeight);
            renderer.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        };
        window.addEventListener("resize", onResize);

        // --- Limpieza ---
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", onResize);
            controls.dispose();
            renderer.dispose();
            surfaceGeom.dispose();
            (surfaceMat as THREE.Material).dispose();
            arrowsGroup.children.forEach((obj) => {
                const a = obj as THREE.ArrowHelper;
                (a.line.material as THREE.Material).dispose();
                (a.cone.material as THREE.Material).dispose();
                a.cone.geometry.dispose();
                a.line.geometry.dispose();
            });
            grid.geometry.dispose();
            (grid.material as THREE.Material).dispose();
            axes.geometry.dispose();
            (axes.material as THREE.Material).dispose();
            scene.clear();
            renderer.domElement.remove();
        };
    }, [expression, range, resolution, vectors, t, vectorScale, step, height]);

    return (
        <div
            ref={containerRef}
            style={{
                width: "100%",
                height: "100%",
                minHeight: 420,
                position: "relative",
            }}
        />
    );
}

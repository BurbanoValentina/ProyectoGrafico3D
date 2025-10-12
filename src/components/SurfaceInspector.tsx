// SurfaceInspector.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

type Props = {
    /** expresión JS: puedes usar sin, cos, sqrt... (se transforman a Math.*) */
    expression: string;
    /** medio-lado del dominio cuadrado [-range, range] × [-range, range] */
    range: number;
    /** resolución de la malla (también se usa para muestreo numérico) */
    resolution: number;
    /** densidad superficial σ(x,y) para masa/centro de masa; por defecto 1 */
    densityExpression?: string;
    /** restricción opcional g(x,y)=0 para reporte de Lagrange */
    constraintExpression?: string;
};

type FnXYT = (x: number, y: number, t: number) => number;
type FnXY = (x: number, y: number) => number;

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
            return Number.isFinite(n) ? n : NaN;
        };
    } catch {
        return () => NaN;
    }
}

function compileExprXY(expr: string | undefined): FnXY | null {
    if (!expr) return null;
    const safeExpr = expr.replace(
        /\b(sin|cos|tan|asin|acos|atan|sqrt|abs|pow|exp|log|min|max|floor|ceil|sinh|cosh|tanh)\b/g,
        (m) => `Math.${m}`
    );
    try {
        // eslint-disable-next-line no-new-func
        const f = new Function("x", "y", `return (${safeExpr});`) as FnXY;
        return (x, y) => {
            const v = f(x, y);
            const n = Number(v);
            return Number.isFinite(n) ? n : NaN;
        };
    } catch {
        return null;
    }
}

function clamp01(v: number) {
    return Math.min(1, Math.max(0, v));
}

export default function SurfaceInspector({
    expression,
    range,
    resolution,
    densityExpression,
    constraintExpression,
}: Props) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const fn = useMemo(() => compileExpr(expression), [expression]);
    const dens = useMemo(() => compileExprXY(densityExpression) ?? ((x: number, y: number) => 1), [densityExpression]);
    const gFun = useMemo(() => compileExprXY(constraintExpression), [constraintExpression]);

    // —— estado para panel flotante
    const [hover, setHover] = useState<{ x: number; y: number; z: number; t: number } | null>(null);
    const [globalStats, setGlobalStats] = useState<{
        zMin: number;
        zMax: number;
        volume: number;
        mass: number;
        com: { x: number; y: number; z: number };
    } | null>(null);

    // —— escena three básica (malla + raycaster plano XY)
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

        const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
        scene.add(hemi);
        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(5, -5, 10);
        scene.add(dir);

        const grid = new THREE.GridHelper(range * 2, 10, 0x222222, 0x888888);
        // GridHelper se crea en XZ; la giramos para que quede en XY
        // @ts-ignore
        grid.rotation.x = Math.PI / 2;
        scene.add(grid);

        // material con colores por altura
        const mat = new THREE.MeshStandardMaterial({
            side: THREE.DoubleSide,
            flatShading: false,
            vertexColors: true,
        });

        // ——— construir geometría
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
                const x = (u - 0.5) * widthSpan;
                const y = (v - 0.5) * heightSpan;
                const z = Number(fn(x, y, 0)) || 0;

                positions.push(x, y, z);

                const normalized = clamp01((z + range) / (2 * range));
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

        const mesh = new THREE.Mesh(geometry, mat);
        scene.add(mesh);

        // —— raycaster para plano XY (z=0)
        const raycaster = new THREE.Raycaster();
        const planeXY = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // z=0

        const onPointerMove = (e: PointerEvent) => {
            const rect = renderer.domElement.getBoundingClientRect();
            const ndc = new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -(((e.clientY - rect.top) / rect.height) * 2 - 1)
            );
            raycaster.setFromCamera(ndc, camera);
            const pt = new THREE.Vector3();
            raycaster.ray.intersectPlane(planeXY, pt);
            if (!isFinite(pt.x) || !isFinite(pt.y)) return;
            const t = performance.now() / 1000;
            const z = Number(fn(pt.x, pt.y, t));
            if (Number.isFinite(z)) {
                setHover({ x: pt.x, y: pt.y, z, t });
            } else {
                setHover(null);
            }
        };
        renderer.domElement.addEventListener("pointermove", onPointerMove);

        const onResize = () => {
            const w = container.clientWidth;
            const h = container.clientHeight;
            renderer.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        };
        window.addEventListener("resize", onResize);

        const render = () => {
            renderer.render(scene, camera);
            requestAnimationFrame(render);
        };
        render();

        // limpieza
        return () => {
            renderer.domElement.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("resize", onResize);
            container.removeChild(renderer.domElement);
            renderer.dispose();
            geometry.dispose();
            // @ts-ignore
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
            else mat.dispose();
        };
    }, [range, resolution, fn]);

    // —— precómputos globales (rango z, volumen, masa, centro de masa)
    useEffect(() => {
        // muestreo en grilla simple
        const N = Math.max(16, Math.min(200, resolution));
        let zMin = Infinity,
            zMax = -Infinity;
        let vol = 0; // ∫ max(f,0) dA
        let mass = 0; // ∫ σ * max(f,0) dA
        let mx = 0,
            my = 0,
            mz = 0; // para centro de masa

        const dx = (2 * range) / N;
        const dy = (2 * range) / N;
        const dA = dx * dy;

        for (let j = 0; j < N; j++) {
            const y = -range + (j + 0.5) * dy;
            for (let i = 0; i < N; i++) {
                const x = -range + (i + 0.5) * dx;
                const z = fn(x, y, 0);
                if (Number.isFinite(z)) {
                    zMin = Math.min(zMin, z);
                    zMax = Math.max(zMax, z);
                    const h = Math.max(0, z);
                    const sigma = dens(x, y);
                    const dV = h * dA;
                    const dM = sigma * dV;

                    vol += dV;
                    mass += dM;
                    mx += x * dM;
                    my += y * dM;
                    mz += (h * h * 0.5) * sigma * dA; // z medio local = h/2
                }
            }
        }
        const com = mass > 0 ? { x: mx / mass, y: my / mass, z: mz / mass } : { x: NaN, y: NaN, z: NaN };
        if (!Number.isFinite(zMin)) zMin = NaN;
        if (!Number.isFinite(zMax)) zMax = NaN;
        setGlobalStats({ zMin, zMax, volume: vol, mass, com });
    }, [fn, dens, range, resolution]);

    // —— utilidades numéricas locales (límites/derivadas) en punto hover
    const localInfo = useMemo(() => {
        if (!hover) return null;
        const { x, y, t } = hover;
        const h = Math.max(1e-4, range / 1000);

        const val = fn(x, y, t);

        const fx = (fn(x + h, y, t) - fn(x - h, y, t)) / (2 * h);
        const fy = (fn(x, y + h, t) - fn(x, y - h, t)) / (2 * h);
        const grad = { fx, fy, norm: Math.hypot(fx, fy) };

        // límite numérico por múltiples caminos hacia (x,y)
        const dirs = [
            [1, 0],
            [0, 1],
            [1, 1],
            [1, -1],
            [2, 1],
            [1, 2],
            [-1, 1],
            [-1, -1],
        ];
        const samples: number[] = [];
        for (const [ax, ay] of dirs) {
            let r = h;
            let acc = 0;
            let cnt = 0;
            for (let k = 0; k < 5; k++) {
                const vx = x + ax * r;
                const vy = y + ay * r;
                const vv = fn(vx, vy, t);
                if (Number.isFinite(vv)) {
                    acc += vv;
                    cnt++;
                    samples.push(vv);
                }
                r *= 0.5;
            }
        }
        const mean =
            samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : NaN;
        const variance =
            samples.length > 1
                ? samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (samples.length - 1)
                : NaN;

        // Lagrange (si hay g): λ ≈ (∇f · ∇g) / ||∇g||^2, y comprobamos |g| pequeño
        let lagrange: { g: number; lam: number; grad_g: { gx: number; gy: number } } | null = null;
        if (gFun) {
            const gx = (gFun(x + h, y) - gFun(x - h, y)) / (2 * h);
            const gy = (gFun(x, y + h) - gFun(x, y - h)) / (2 * h);
            const gg = gFun(x, y);
            const denom = gx * gx + gy * gy;
            const lam = denom > 0 ? (fx * gx + fy * gy) / denom : NaN;
            lagrange = { g: gg, lam, grad_g: { gx, gy } };
        }

        return {
            value: val,
            grad,
            limit: {
                approx: mean,
                variance,
                consistent: Number.isFinite(variance) ? variance < 1e-4 * (1 + Math.abs(mean)) : false,
                samples: samples.length,
            },
            lagrange,
        };
    }, [hover, fn, gFun, range]);

    const panel = (() => {
        if (!hover || !globalStats) return null;

        const domStr = `[-${range}, ${range}] × [-${range}, ${range}]`;
        const rngStr =
            Number.isFinite(globalStats.zMin) && Number.isFinite(globalStats.zMax)
                ? `[${globalStats.zMin.toFixed(4)}, ${globalStats.zMax.toFixed(4)}]`
                : "N/D";

        return (
            <div
                style={{
                    position: "absolute",
                    top: 8,
                    left: 8,
                    padding: "10px 12px",
                    background: "rgba(255,255,255,0.95)",
                    border: "1px solid #ddd",
                    borderRadius: 8,
                    fontFamily: "Arial, sans-serif",
                    fontSize: 12,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                    pointerEvents: "none",
                    maxWidth: 420,
                }}
            >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Inspector</div>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                    <tbody>
                        <tr>
                            <td style={{ padding: "2px 4px" }}>Punto (x,y)</td>
                            <td style={{ padding: "2px 4px" }}>
                                ({hover.x.toFixed(4)}, {hover.y.toFixed(4)})
                            </td>
                        </tr>
                        <tr>
                            <td style={{ padding: "2px 4px" }}>f(x,y,t)</td>
                            <td style={{ padding: "2px 4px" }}>{hover.z.toFixed(6)}</td>
                        </tr>
                        <tr>
                            <td style={{ padding: "2px 4px" }}>Dominio</td>
                            <td style={{ padding: "2px 4px" }}>{domStr}</td>
                        </tr>
                        <tr>
                            <td style={{ padding: "2px 4px" }}>Rango estimado z</td>
                            <td style={{ padding: "2px 4px" }}>{rngStr}</td>
                        </tr>
                        {localInfo && (
                            <>
                                <tr>
                                    <td style={{ padding: "2px 4px" }}>∂f/∂x, ∂f/∂y</td>
                                    <td style={{ padding: "2px 4px" }}>
                                        ({localInfo.grad.fx.toFixed(6)}, {localInfo.grad.fy.toFixed(6)})
                                    </td>
                                </tr>
                                <tr>
                                    <td style={{ padding: "2px 4px" }}>|grad f|</td>
                                    <td style={{ padding: "2px 4px" }}>{localInfo.grad.norm.toFixed(6)}</td>
                                </tr>
                                <tr>
                                    <td style={{ padding: "2px 4px" }}>Límite (multicamino)</td>
                                    <td style={{ padding: "2px 4px" }}>
                                        {Number.isFinite(localInfo.limit.approx) ? localInfo.limit.approx.toFixed(6) : "N/D"}
                                        {"  "}
                                        {localInfo.limit.consistent ? "≈ consistente" : "(inconcluso)"}
                                        {"  "}
                                        <span style={{ opacity: 0.6 }}>
                                            n={localInfo.limit.samples}, var={Number.isFinite(localInfo.limit.variance)
                                                ? localInfo.limit.variance.toExponential(2)
                                                : "N/D"}
                                        </span>
                                    </td>
                                </tr>
                                {localInfo.lagrange && (
                                    <tr>
                                        <td style={{ padding: "2px 4px" }}>Lagrange (g=0)</td>
                                        <td style={{ padding: "2px 4px" }}>
                                            g(x,y)={localInfo.lagrange.g.toExponential(2)}; λ≈{" "}
                                            {Number.isFinite(localInfo.lagrange.lam) ? localInfo.lagrange.lam.toFixed(6) : "N/D"}
                                            <span style={{ opacity: 0.6 }}>
                                                {" "}
                                                (∇g=({localInfo.lagrange.grad_g.gx.toFixed(4)},{localInfo.lagrange.grad_g.gy.toFixed(4)}))
                                            </span>
                                        </td>
                                    </tr>
                                )}
                            </>
                        )}
                        <tr>
                            <td style={{ padding: "2px 4px" }}>Volumen (z⁺)</td>
                            <td style={{ padding: "2px 4px" }}>{globalStats.volume.toFixed(6)}</td>
                        </tr>
                        <tr>
                            <td style={{ padding: "2px 4px" }}>Masa σ(x,y)</td>
                            <td style={{ padding: "2px 4px" }}>{globalStats.mass.toFixed(6)}</td>
                        </tr>
                        <tr>
                            <td style={{ padding: "2px 4px" }}>Centro de masa</td>
                            <td style={{ padding: "2px 4px" }}>
                                ({Number.isFinite(globalStats.com.x) ? globalStats.com.x.toFixed(4) : "N/D"},{" "}
                                {Number.isFinite(globalStats.com.y) ? globalStats.com.y.toFixed(4) : "N/D"},{" "}
                                {Number.isFinite(globalStats.com.z) ? globalStats.com.z.toFixed(4) : "N/D"})
                            </td>
                        </tr>
                    </tbody>
                </table>
                <div style={{ marginTop: 6, opacity: 0.7 }}>
                    *Cálculos numéricos: muestreo en grilla y diferencias finitas (h≈{(range / 1000).toExponential(1)}).
                </div>
            </div>
        );
    })();

    return (
        <div ref={mountRef} style={{ width: "100%", height: "100%", position: "relative" }}>
            {panel}
        </div>
    );
}

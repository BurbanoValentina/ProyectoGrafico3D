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
    /** NUEVO: dominio avanzado h(x,y) <= 0 (máscara de integración/contorno) */
    domainExpression?: string;
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

/** NUEVO: marching squares para contornos 2D en plano z=0 */
function marchingSquares(
    grid: number[][], // z[i][j]
    x0: number,
    y0: number,
    dx: number,
    dy: number,
    level: number
): Array<[THREE.Vector3, THREE.Vector3]> {
    const nx = grid.length;
    const ny = grid[0]?.length ?? 0;
    const segs: Array<[THREE.Vector3, THREE.Vector3]> = [];

    const v = (i: number, j: number) => grid[i][j] - level;

    const interp = (xA: number, yA: number, vA: number, xB: number, yB: number, vB: number) => {
        const t = vA === vB ? 0.5 : vA / (vA - vB);
        return new THREE.Vector3(xA + t * (xB - xA), yA + t * (yB - yA), 0);
    };

    for (let i = 0; i < nx - 1; i++) {
        for (let j = 0; j < ny - 1; j++) {
            const xA = x0 + (i + 0) * dx;
            const yA = y0 + (j + 0) * dy;
            const xB = x0 + (i + 1) * dx;
            const yB = y0 + (j + 1) * dy;

            const f00 = v(i, j);
            const f10 = v(i + 1, j);
            const f11 = v(i + 1, j + 1);
            const f01 = v(i, j + 1);

            const idx =
                (f00 > 0 ? 1 : 0) |
                (f10 > 0 ? 2 : 0) |
                (f11 > 0 ? 4 : 0) |
                (f01 > 0 ? 8 : 0);
            if (idx === 0 || idx === 15) continue;

            // aristas: 0: (00-10), 1: (10-11), 2: (11-01), 3: (01-00)
            const p: (THREE.Vector3 | null)[] = [null, null, null, null];
            // 00 -> (xA,yA), 10 -> (xB,yA), 11 -> (xB,yB), 01 -> (xA,yB)
            const p00 = [xA, yA, f00] as const;
            const p10 = [xB, yA, f10] as const;
            const p11 = [xB, yB, f11] as const;
            const p01 = [xA, yB, f01] as const;

            // Simpler explicit edges:
            p[0] = (f00 > 0) !== (f10 > 0) ? interp(p00[0], p00[1], p00[2], p10[0], p10[1], p10[2]) : null;
            p[1] = (f10 > 0) !== (f11 > 0) ? interp(p10[0], p10[1], p10[2], p11[0], p11[1], p11[2]) : null;
            p[2] = (f11 > 0) !== (f01 > 0) ? interp(p11[0], p11[1], p11[2], p01[0], p01[1], p01[2]) : null;
            p[3] = (f01 > 0) !== (f00 > 0) ? interp(p01[0], p01[1], p01[2], p00[0], p00[1], p00[2]) : null;

            const pts = p.filter(Boolean) as THREE.Vector3[];
            if (pts.length === 2) segs.push([pts[0], pts[1]]);
            else if (pts.length === 4) {
                // caso ambiguo: divídelo en 2 segmentos
                segs.push([pts[0], pts[1]]);
                segs.push([pts[2], pts[3]]);
            }
        }
    }
    return segs;
}

export default function SurfaceInspector({
    expression,
    range,
    resolution,
    densityExpression,
    constraintExpression,
    domainExpression, // NUEVO
}: Props) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const fn = useMemo(() => compileExpr(expression), [expression]);
    const dens = useMemo(
        () => compileExprXY(densityExpression) ?? ((_x: number, _y: number) => 1),
        [densityExpression]
    );
    const gFun = useMemo(() => compileExprXY(constraintExpression), [constraintExpression]);
    const domFun = useMemo(() => compileExprXY(domainExpression), [domainExpression]); // NUEVO

    // —— estado para panel flotante
    const [hover, setHover] = useState<{ x: number; y: number; z: number; t: number } | null>(null);
    const [globalStats, setGlobalStats] = useState<{
        zMin: number;
        zMax: number;
        volume: number;
        mass: number;
        com: { x: number; y: number; z: number };
    } | null>(null);

    // NUEVO: estado para extremos y botón
    const [extrema, setExtrema] = useState<
        Array<{ x: number; y: number; z: number; type: "max" | "min" | "saddle" }>
    >([]);
    const [scanKey, setScanKey] = useState(0); // para re-ejecutar búsqueda

    // —— escena three básica (malla + overlays)
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

        // ——— construir geometría de superficie
        const cols = Math.max(8, resolution);
        const rows = Math.max(8, resolution);
        const widthSpan = range * 2;
        const heightSpan = range * 2;
        const positions: number[] = [];
        const colors: number[] = [];
        const indices: number[] = [];

        const zGrid: number[][] = Array.from({ length: cols + 1 }, () => new Array(rows + 1).fill(NaN)); // para contornos
        const x0 = -range;
        const y0 = -range;
        const dxS = widthSpan / cols;
        const dyS = heightSpan / rows;

        for (let j = 0; j <= rows; j++) {
            for (let i = 0; i <= cols; i++) {
                const x = x0 + i * dxS;
                const y = y0 + j * dyS;

                // Si hay dominio, no bloqueamos visualización, pero guardamos z y NaN si fuera del dominio (para contornos)
                const inDom = domFun ? domFun(x, y) <= 0 : true;
                const z = Number(fn(x, y, 0));
                zGrid[i][j] = Number.isFinite(z) && inDom ? z : NaN;

                positions.push(x, y, Number.isFinite(z) ? z : 0);

                const normalized = clamp01(((Number.isFinite(z) ? z : 0) + range) / (2 * range));
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

        // —— overlays: contornos 2D (z=0) y contorno de dominio h=0
        const overlays = new THREE.Group();
        scene.add(overlays);

        const drawSegments = (segs: Array<[THREE.Vector3, THREE.Vector3]>, zLift = 0.001) => {
            if (segs.length === 0) return;
            const pos: number[] = [];
            for (const [a, b] of segs) {
                pos.push(a.x, a.y, zLift, b.x, b.y, zLift);
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
            const m = new THREE.LineBasicMaterial({ linewidth: 1 });
            const lines = new THREE.LineSegments(g, m);
            overlays.add(lines);
        };

        // contornos de z (10 niveles entre zMin/zMax válidos)
        const validVals: number[] = [];
        for (let i = 0; i <= cols; i++)
            for (let j = 0; j <= rows; j++) if (Number.isFinite(zGrid[i][j])) validVals.push(zGrid[i][j]);
        if (validVals.length > 0) {
            validVals.sort((a, b) => a - b);
            const zMin = validVals[0];
            const zMax = validVals[validVals.length - 1];
            const L = 10;
            for (let k = 1; k < L; k++) {
                const level = zMin + (k * (zMax - zMin)) / L;
                const segs = marchingSquares(zGrid, x0, y0, dxS, dyS, level);
                drawSegments(segs, 0.001 + 0.0001 * k);
            }
        }

        // contorno del dominio h(x,y)=0 (si hay)
        if (domFun) {
            // construimos una grilla de h en los nodos de zGrid
            const hGrid: number[][] = Array.from({ length: cols + 1 }, () => new Array(rows + 1).fill(1));
            for (let i = 0; i <= cols; i++)
                for (let j = 0; j <= rows; j++) hGrid[i][j] = domFun(x0 + i * dxS, y0 + j * dyS);
            const domSegs = marchingSquares(hGrid, x0, y0, dxS, dyS, 0);
            drawSegments(domSegs, 0.0005);
        }

        // —— raycaster para plano XY (z=0)
        const raycaster = new THREE.Raycaster();
        const planeXY = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // z=0

        // —— Slices (líneas de corte) que siguen al hover
        const sliceGroup = new THREE.Group();
        scene.add(sliceGroup);

        const updateSlices = (x0: number, y0: number) => {
            sliceGroup.clear();
            // x = x0: barrer y
            const Ny = Math.max(32, resolution);
            const linePtsX: number[] = [];
            for (let j = 0; j <= Ny; j++) {
                const y = -range + (2 * range * j) / Ny;
                const z = fn(x0, y, 0);
                if (Number.isFinite(z)) {
                    linePtsX.push(x0, y, z);
                }
            }
            if (linePtsX.length >= 6) {
                const g = new THREE.BufferGeometry();
                g.setAttribute("position", new THREE.Float32BufferAttribute(linePtsX, 3));
                const m = new THREE.LineBasicMaterial();
                const line = new THREE.Line(g, m);
                sliceGroup.add(line);
            }

            // y = y0: barrer x
            const Nx = Math.max(32, resolution);
            const linePtsY: number[] = [];
            for (let i = 0; i <= Nx; i++) {
                const x = -range + (2 * range * i) / Nx;
                const z = fn(x, y0, 0);
                if (Number.isFinite(z)) {
                    linePtsY.push(x, y0, z);
                }
            }
            if (linePtsY.length >= 6) {
                const g = new THREE.BufferGeometry();
                g.setAttribute("position", new THREE.Float32BufferAttribute(linePtsY, 3));
                const m = new THREE.LineBasicMaterial();
                const line = new THREE.Line(g, m);
                sliceGroup.add(line);
            }
        };

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
                updateSlices(pt.x, pt.y); // slices siguen al cursor
            } else {
                setHover(null);
                sliceGroup.clear();
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
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
            else mat.dispose();
        };
    }, [range, resolution, fn, domFun]);

    // —— precómputos globales (rango z, volumen, masa, centro de masa) con máscara de dominio
    useEffect(() => {
        const N = Math.max(16, Math.min(200, resolution));
        let zMin = Infinity,
            zMax = -Infinity;
        let vol = 0; // ∫ max(f,0) dA dentro del dominio
        let mass = 0; // ∫ σ * max(f,0) dA dentro del dominio
        let mx = 0,
            my = 0,
            mz = 0;

        const dx = (2 * range) / N;
        const dy = (2 * range) / N;
        const dA = dx * dy;

        for (let j = 0; j < N; j++) {
            const y = -range + (j + 0.5) * dy;
            for (let i = 0; i < N; i++) {
                const x = -range + (i + 0.5) * dx;

                // máscara de dominio
                if (domFun && !(domFun(x, y) <= 0)) continue;

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
    }, [fn, dens, range, resolution, domFun]);

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
            for (let k = 0; k < 5; k++) {
                const vx = x + ax * r;
                const vy = y + ay * r;
                const vv = fn(vx, vy, t);
                if (Number.isFinite(vv)) samples.push(vv);
                r *= 0.5;
            }
        }
        const mean = samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : NaN;
        const variance =
            samples.length > 1
                ? samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (samples.length - 1)
                : NaN;

        // Lagrange (si hay g)
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

    // —— NUEVO: búsqueda de extremos en la malla (click en botón)
    useEffect(() => {
        // solo dispara cuando cambia scanKey / parámetros
        const Nx = Math.max(24, Math.min(120, resolution));
        const Ny = Nx;
        const dx = (2 * range) / Nx;
        const dy = (2 * range) / Ny;
        const epsGrad = 1e-2 * Math.max(1, range); // umbral suave

        const found: Array<{ x: number; y: number; z: number; type: "max" | "min" | "saddle" }> = [];

        const f = (x: number, y: number) => fn(x, y, 0);
        const inside = (x: number, y: number) => (domFun ? domFun(x, y) <= 0 : true);

        for (let i = 1; i < Nx - 1; i++) {
            const x = -range + i * dx;
            for (let j = 1; j < Ny - 1; j++) {
                const y = -range + j * dy;
                if (!inside(x, y)) continue;

                // gradiente
                const fx = (f(x + dx, y) - f(x - dx, y)) / (2 * dx);
                const fy = (f(x, y + dy) - f(x, y - dy)) / (2 * dy);
                const gnorm = Math.hypot(fx, fy);
                if (!Number.isFinite(gnorm) || gnorm > epsGrad) continue;

                // Hessiano aproximado
                const fxx = (f(x + dx, y) - 2 * f(x, y) + f(x - dx, y)) / (dx * dx);
                const fyy = (f(x, y + dy) - 2 * f(x, y) + f(x, y - dy)) / (dy * dy);
                const fxy = (f(x + dx, y + dy) - f(x + dx, y - dy) - f(x - dx, y + dy) + f(x - dx, y - dy)) / (4 * dx * dy);

                const D = fxx * fyy - fxy * fxy;
                const z = f(x, y);
                if (!Number.isFinite(D) || !Number.isFinite(z)) continue;

                if (D > 0 && fxx < 0) found.push({ x, y, z, type: "max" });
                else if (D > 0 && fxx > 0) found.push({ x, y, z, type: "min" });
                else if (D < 0) found.push({ x, y, z, type: "saddle" });
            }
        }
        setExtrema(found);
    }, [scanKey, fn, range, resolution, domFun]);

    // —— panel
    const panel = (() => {
        if (!globalStats) return null;

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
                    maxWidth: 440,
                }}
            >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Inspector</div>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                    <tbody>
                        <tr>
                            <td style={{ padding: "2px 4px" }}>Punto (x,y)</td>
                            <td style={{ padding: "2px 4px" }}>
                                {hover ? `(${hover.x.toFixed(4)}, ${hover.y.toFixed(4)})` : "—"}
                            </td>
                        </tr>
                        <tr>
                            <td style={{ padding: "2px 4px" }}>f(x,y,t)</td>
                            <td style={{ padding: "2px 4px" }}>{hover ? hover.z.toFixed(6) : "—"}</td>
                        </tr>
                        <tr>
                            <td style={{ padding: "2px 4px" }}>Dominio (caja)</td>
                            <td style={{ padding: "2px 4px" }}>{domStr}</td>
                        </tr>
                        <tr>
                            <td style={{ padding: "2px 4px" }}>Rango estimado z</td>
                            <td style={{ padding: "2px 4px" }}>{rngStr}</td>
                        </tr>
                        {hover && (
                            <>
                                <tr>
                                    <td style={{ padding: "2px 4px" }}>∂f/∂x, ∂f/∂y</td>
                                    <td style={{ padding: "2px 4px" }}>
                                        ({(localInfo?.grad.fx ?? NaN).toFixed(6)}, {(localInfo?.grad.fy ?? NaN).toFixed(6)})
                                    </td>
                                </tr>
                                <tr>
                                    <td style={{ padding: "2px 4px" }}>|grad f|</td>
                                    <td style={{ padding: "2px 4px" }}>{(localInfo?.grad.norm ?? NaN).toFixed(6)}</td>
                                </tr>
                                <tr>
                                    <td style={{ padding: "2px 4px" }}>Límite (multicamino)</td>
                                    <td style={{ padding: "2px 4px" }}>
                                        {Number.isFinite(localInfo?.limit.approx!)
                                            ? localInfo!.limit.approx.toFixed(6)
                                            : "N/D"}{" "}
                                        {localInfo?.limit.consistent ? "≈ consistente" : "(inconcluso)"}{" "}
                                        <span style={{ opacity: 0.6 }}>
                                            n={localInfo?.limit.samples}, var={
                                                Number.isFinite(localInfo?.limit.variance!)
                                                    ? localInfo!.limit.variance.toExponential(2)
                                                    : "N/D"
                                            }
                                        </span>
                                    </td>
                                </tr>
                                {localInfo?.lagrange && (
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

                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                        onClick={() => setScanKey((k) => k + 1)}
                        style={{
                            padding: "6px 10px",
                            borderRadius: 6,
                            border: "1px solid #ccc",
                            background: "#f7f7f7",
                            cursor: "pointer",
                        }}
                        title="Escanear la malla y marcar máximos, mínimos y puntos silla"
                    >
                        Buscar extremos
                    </button>
                    <div style={{ alignSelf: "center", opacity: 0.7 }}>
                        {extrema.length > 0 ? `${extrema.length} puntos` : "—"}
                    </div>
                </div>

                <div style={{ marginTop: 6, opacity: 0.7 }}>
                    *Cálculos numéricos: muestreo en grilla y diferencias finitas (h≈{(range / 1000).toExponential(1)}).
                    Las líneas de corte siguen al cursor; contornos en z=0; dominio opcional h(x,y)≤0.
                </div>
            </div>
        );
    })();

    // —— dibujar marcadores de extremos como overlay DOM (tooltip simple)
    const markers = extrema.slice(0, 200).map((p, i) => {
        // solo UI textual; la marca visual 3D ya se ve como cambio en la superficie/contornos.
        const color = p.type === "max" ? "#d33" : p.type === "min" ? "#36c" : "#e6b800";
        return (
            <div key={i} style={{ color, fontSize: 12, marginTop: 2 }}>
                {p.type}: ({p.x.toFixed(2)},{p.y.toFixed(2)}) z={p.z.toFixed(2)}
            </div>
        );
    });

    return (
        <div ref={mountRef} style={{ width: "100%", height: "100%", position: "relative" }}>
            {panel}
            {/* Lista breve de extremos encontrados */}
            {extrema.length > 0 && (
                <div
                    style={{
                        position: "absolute",
                        right: 8,
                        top: 8,
                        maxWidth: 260,
                        maxHeight: 200,
                        overflow: "auto",
                        background: "rgba(255,255,255,0.92)",
                        border: "1px solid #ddd",
                        borderRadius: 8,
                        padding: 8,
                        fontFamily: "Arial, sans-serif",
                    }}
                >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Puntos críticos</div>
                    {markers}
                </div>
            )}
        </div>
    );
}

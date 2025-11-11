import React, { useMemo, useState } from "react";
import SurfacePlot from "./SurfacePlot";
import { create, all } from "mathjs";
const math = create(all, {});

/**
 * SurfaceIntersection
 * -------------------------------------------------
 * Goal: Plot two explicit surfaces z = f1(x,y) and z = f2(x,y)
 * and visualize their intersection curve by detecting sign changes
 * of g(x,y) = f1(x,y) - f2(x,y) on a regular grid and linearly
 * interpolating along cell edges. The intersection is rendered as
 * red points (dense enough to look like a curve).
 *
 * UI text is in Spanish (per user preference), code & comments in English.
 */
class Boundary extends React.Component<{children: React.ReactNode}, {hasError: boolean; msg?: string}> {
  constructor(props: any) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(err: unknown) { return { hasError: true, msg: String(err) }; }
  componentDidCatch(err: any, info: any) { console.error("SurfaceIntersection crashed:", err, info); }
  render() { return this.state.hasError ? <div className="text-red-600 text-sm">Falló el render: {this.state.msg}</div> : (this.props.children as any); }
}

export default function SurfaceIntersection() {
  // ----- UI state -----
  const [expr1, setExpr1] = useState("sin(x)*cos(y)");
  const [expr2, setExpr2] = useState("cos(x)*sin(y)");
  const [range, setRange] = useState(4); // domain: x,y in [-range, range]
  const [resolution, setResolution] = useState(80); // grid steps per axis (N)
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Optional: epsilon for zero tests in marching squares edge checks
  const EPS = 1e-8;

  // ----- Compile expressions (memoized) -----
  const compiled = useMemo(() => {
    try {
      const f1 = math.compile(expr1);
      const f2 = math.compile(expr2);
      setErrorMsg(null);
      return { f1, f2 } as const;
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Error al compilar expresiones");
      return null;
    }
  }, [expr1, expr2]);

  // ----- Helpers -----
  const evalReal = (fn: any, x: number, y: number): number => {
    try {
      let z = fn.evaluate({ x, y });
      if (math.typeOf(z) === "Complex") z = (z as any).re;
      const zn = Number(z);
      return Number.isFinite(zn) ? zn : NaN;
    } catch {
      return NaN;
    }
  };

  const signWithTol = (v: number) => (Math.abs(v) <= EPS ? 0 : v > 0 ? 1 : -1);

  // ----- Generate grid and intersection points (memoized) -----
  const { surf1Points, surf2Points, intersectionPts } = useMemo(() => {
    const surf1: Array<{ x: number; y: number; z: number }> = [];
    const surf2: Array<{ x: number; y: number; z: number }> = [];
    const inter: Array<{ x: number; y: number; z: number }> = [];

    if (!compiled) return { surf1Points: surf1, surf2Points: surf2, intersectionPts: inter };

    const { f1, f2 } = compiled;

    // Clamp resolution for performance/safety
    const N = Math.max(2, Math.min(200, Math.floor(resolution)));
    const step = (2 * range) / N;

    // Precompute axes
    const xs = new Array(N + 1).fill(0).map((_, i) => -range + i * step);
    const ys = new Array(N + 1).fill(0).map((_, j) => -range + j * step);

    // Precompute f1, f2 and diff g = f1 - f2 on grid
    const g: number[][] = Array.from({ length: N + 1 }, () => new Array(N + 1).fill(NaN));
    const z1: number[][] = Array.from({ length: N + 1 }, () => new Array(N + 1).fill(NaN));
    const z2: number[][] = Array.from({ length: N + 1 }, () => new Array(N + 1).fill(NaN));

    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const x = xs[i];
        const y = ys[j];
        const v1 = evalReal(f1, x, y);
        const v2 = evalReal(f2, x, y);
        z1[j][i] = v1;
        z2[j][i] = v2;
        g[j][i] = v1 - v2;
        // surfaces point clouds (dense grid)
        if (Number.isFinite(v1)) surf1.push({ x, y, z: v1 });
        if (Number.isFinite(v2)) surf2.push({ x, y, z: v2 });
      }
    }

    // Marching-squares style: detect sign changes across edges and interpolate
    const pushEdgeCross = (xA: number, yA: number, gA: number, xB: number, yB: number, gB: number) => {
      const sA = signWithTol(gA);
      const sB = signWithTol(gB);
      if (sA === 0 && sB === 0) return; // the whole edge is on the isocurve; skip to avoid floods
      if (sA === sB) return; // no crossing
      const denom = gB - gA;
      if (Math.abs(denom) <= EPS) return;
      const t = (0 - gA) / denom; // linear interpolation fraction in [0,1]
      if (t < 0 - 1e-6 || t > 1 + 1e-6) return; // guard
      const x = xA + t * (xB - xA);
      const y = yA + t * (yB - yA);
      // z on curve (evaluate one function for better accuracy)
      const z = evalReal(f1, x, y);
      if (Number.isFinite(z)) inter.push({ x, y, z });
    };

    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        // cell corners (i,j) ordering
        const x0 = xs[i], x1 = xs[i + 1];
        const y0 = ys[j], y1 = ys[j + 1];

        const g00 = g[j][i];
        const g10 = g[j][i + 1];
        const g11 = g[j + 1][i + 1];
        const g01 = g[j + 1][i];

        // bottom edge: (x0,y0) -> (x1,y0)
        pushEdgeCross(x0, y0, g00, x1, y0, g10);
        // right edge: (x1,y0) -> (x1,y1)
        pushEdgeCross(x1, y0, g10, x1, y1, g11);
        // top edge: (x1,y1) -> (x0,y1)
        pushEdgeCross(x1, y1, g11, x0, y1, g01);
        // left edge: (x0,y1) -> (x0,y0)
        pushEdgeCross(x0, y1, g01, x0, y0, g00);
      }
    }

    return { surf1Points: surf1, surf2Points: surf2, intersectionPts: inter };
  }, [compiled, range, resolution]);

  // Mostrar/ocultar coordenadas del corte
  const [showCoords, setShowCoords] = useState(false);
  const maxShow = 200; // limitar cantidad a mostrar

  // ----- Render -----
  // Layout: controls arriba y visor abajo que ocupa todo el espacio disponible.
  return (
    <div className="p-4" style={{ height: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <h2 className="text-lg font-semibold">Intersección de dos superficies</h2>

        <label className="block">
          Función 1: z₁ =
          <input
            value={expr1}
            onChange={(e) => setExpr1(e.target.value)}
            className="border p-1 rounded ml-2 w-full max-w-xl"
            placeholder="Ej: sin(x)*cos(y)"
          />
        </label>

        <label className="block">
          Función 2: z₂ =
          <input
            value={expr2}
            onChange={(e) => setExpr2(e.target.value)}
            className="border p-1 rounded ml-2 w-full max-w-xl"
            placeholder="Ej: cos(x)*sin(y)"
          />
        </label>

        <div className="flex flex-wrap items-center gap-4">
          <label className="block">
            Rango (±)
            <input
              type="number"
              value={range}
              onChange={(e) => setRange(Number(e.target.value))}
              className="border p-1 rounded ml-2 w-24"
              step={0.5}
            />
          </label>
          <label className="block">
            Resolución
            <input
              type="number"
              value={resolution}
              onChange={(e) => setResolution(Number(e.target.value))}
              className="border p-1 rounded ml-2 w-24"
              min={10}
              max={200}
            />
          </label>
        </div>

        {errorMsg ? (
          <div className="text-red-600 text-sm">Error: {errorMsg}</div>
        ) : (surf1Points.length === 0 && surf2Points.length === 0) ? (
          <div className="text-amber-600 text-sm">No se pudieron evaluar puntos válidos en el rango dado.</div>
        ) : null}

        <p className="text-sm text-gray-600">
          Los puntos rojos representan la curva de intersección aproximada de z₁ y z₂ (g(x,y)=0).
        </p>
      </div>

      {/* visor: ocupar el resto del espacio */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Boundary>
          <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: 8 }}>
              <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={showCoords} onChange={(e) => setShowCoords(e.target.checked)} />
                <span>Mostrar coordenadas del corte</span>
              </label>
              <span style={{ marginLeft: 12, color: "#666" }}>Puntos detectados: {intersectionPts.length}</span>
            </div>

            <div style={{ flex: 1, minHeight: 0 }}>
              <SurfacePlot
                {...({
                  dataSets: [
                    {
                      name: "z₁(x,y)",
                      points: surf1Points,
                      color: "green",
                      opacity: 0.6,
                    },
                    {
                      name: "z₂(x,y)",
                      points: surf2Points,
                      color: "blue",
                      opacity: 0.6,
                      },
                  ],
                } as any)}
              />
            </div>

            {showCoords && (
              <div style={{ maxHeight: 220, overflow: "auto", padding: 8, background: "rgba(255,255,255,0.9)", borderTop: "1px solid #ddd" }}>
                <strong>Coordenadas del corte (x, y, z) — mostrando hasta {maxShow}:</strong>
                <ol style={{ margin: "8px 0 0 16px", padding: 0 }}>
                  {intersectionPts.slice(0, maxShow).map((p, idx) => (
                    <li key={idx} style={{ fontFamily: "monospace", fontSize: 12, color: "#222", marginBottom: 4 }}>
                      {`x=${p.x.toFixed(4)}, y=${p.y.toFixed(4)}, z=${p.z.toFixed(4)}`}
                    </li>
                  ))}
                </ol>
                {intersectionPts.length > maxShow && (
                  <div style={{ color: "#666", fontSize: 12 }}>... y {intersectionPts.length - maxShow} puntos más</div>
                )}
              </div>
            )}
          </div>
        </Boundary>
      </div>
    </div>
  );
}

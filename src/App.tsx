import { useState, useMemo } from "react";
import SurfaceInspector from "./components/SurfaceInspector";
import SurfaceDraggable from "./components/SurfaceDraggable";
<<<<<<< HEAD
import GradientField3D from "./components/GradientField3D";
import SurfaceIntersection from "./components/SurfaceIntersection";
=======
import GradientField3D from "./components/GradientField3D"; 
>>>>>>> 63bf797 (Nuevo componente)

type Viewer = "inspector" | "draggable" | "gradient";
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
            return Number.isFinite(n) ? n : NaN;
        };
    } catch {
        return () => NaN;
    }
}

export default function App() {
   const [expr, setExpr] = useState<string>("sin(x*2 + y) - 0.5*sin(t*2)");
   const [range, setRange] = useState<number>(4);
   const [res, setRes] = useState<number>(80);

   // Opcionales para masa/centro de masa y Lagrange (solo Inspector):
   const [density, setDensity] = useState<string>("1");      // σ(x,y)
   const [constraint, setConstraint] = useState<string>(""); // g(x,y)=0

   // ⬇️ selector de visor (ahora con "gradient")
   const [viewer, setViewer] = useState<Viewer>("inspector");

   // Controles específicos para Gradient Field 3D
   const [vectors, setVectors] = useState<number>(18);     // flechas por eje
   const [vectorScale, setVectorScale] = useState<number>(0.55); // escala de largo
   const [step, setStep] = useState<number>(1e-3);         // h derivadas
   const [tParam, setTParam] = useState<number>(0);        // parámetro t

   // Compilar la expresión una vez
   const compiledFn = useMemo(() => compileExpr(expr), [expr]);

  return (
    <div className="app">
      <aside className="panel panel-celeste shadow-sm">
        <h2 className="neon-title mb-3">CALCULUS 3D - SUPERFICIE</h2>

        {/* Selector de visor */}
        <div className="mb-3">
          <label className="form-label">Visor</label>
          <select
            className="form-select form-select-sm"
            value={viewer}
            onChange={(e) => setViewer(e.target.value as Viewer)}
          >
            <option value="inspector">Inspector (stats, Lagrange, cortes)</option>
            <option value="draggable">Draggable (pan/zoom/rotar con mouse)</option>
            <option value="gradient">Campo gradiente 3D (flechas en z=0)</option>
            <option value="intersection">Intersección</option>
          </select>
          <div className="form-text">
            En <b>Draggable</b> no se calculan densidad/Lagrange; es para mover la gráfica.
          </div>
        </div>

        <div className="mb-3">
          <label className="form-label">Función z = f(x,y,t)</label>
          <input
            type="text"
            className="form-control form-control-sm"
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            placeholder="p.ej. sin(x+y) - 0.5*cos(t)"
          />
          <div className="form-text">
            Usa <code>x</code>, <code>y</code>, <code>t</code> y funciones tipo <code>sin</code>, <code>cos</code>, <code>sqrt</code>.
          </div>
        </div>

        <div className="mb-3">
          <label className="form-label d-flex justify-content-between">
            <span>Rango (±)</span>
            <span className="badge bg-dark-subtle text-dark-emphasis">±{range}</span>
          </label>
          <input
            type="range"
            min="1"
            max="8"
            step="0.5"
            className="form-range"
            value={range}
            onChange={(e) => setRange(Number(e.target.value))}
          />
        </div>

        <div className="mb-3">
          <label className="form-label d-flex justify-content-between">
            <span>Resolución</span>
            <span className="badge bg-dark-subtle text-dark-emphasis">{res} × {res}</span>
          </label>
          <input
            type="range"
            min="20"
            max="200"
            step="10"
            className="form-range"
            value={res}
            onChange={(e) => setRes(Number(e.target.value))}
          />
        </div>

        {/* Controles para Gradient Field 3D */}
        {viewer === "gradient" && (
          <>
            <hr className="my-3 opacity-50" />
            <div className="mb-3">
              <label className="form-label d-flex justify-content-between">
                <span>Vectores por eje</span>
                <span className="badge bg-dark-subtle text-dark-emphasis">{vectors} × {vectors}</span>
              </label>
              <input
                type="range"
                min="6"
                max="30"
                step="2"
                className="form-range"
                value={vectors}
                onChange={(e) => setVectors(Number(e.target.value))}
              />
            </div>

            <div className="mb-3">
              <label className="form-label d-flex justify-content-between">
                <span>Escala de flecha</span>
                <span className="badge bg-dark-subtle text-dark-emphasis">{vectorScale.toFixed(2)}</span>
              </label>
              <input
                type="range"
                min="0.1"
                max="1.5"
                step="0.05"
                className="form-range"
                value={vectorScale}
                onChange={(e) => setVectorScale(Number(e.target.value))}
              />
            </div>

            <div className="mb-3">
              <label className="form-label d-flex justify-content-between">
                <span>Paso h (derivadas)</span>
                <span className="badge bg-dark-subtle text-dark-emphasis">{step}</span>
              </label>
              <input
                type="number"
                className="form-control form-control-sm"
                value={step}
                step="0.0005"
                min="0.0001"
                onChange={(e) => setStep(Number(e.target.value))}
              />
              <div className="form-text">Se usa en diferencias finitas centrales para f<sub>x</sub>, f<sub>y</sub>.</div>
            </div>

            <div className="mb-3">
              <label className="form-label d-flex justify-content-between">
                <span>Parámetro t</span>
                <span className="badge bg-dark-subtle text-dark-emphasis">{tParam.toFixed(2)}</span>
              </label>
              <input
                type="range"
                min="-6"
                max="6"
                step="0.1"
                className="form-range"
                value={tParam}
                onChange={(e) => setTParam(Number(e.target.value))}
              />
            </div>
          </>
        )}

        <hr className="my-3 opacity-50" />

        {/* Estos solo aplican al Inspector */}
        <fieldset disabled={viewer !== "inspector"}>
          <div className="mb-3">
            <label className="form-label">Densidad σ(x,y) (opcional)</label>
            <input
              type="text"
              className="form-control form-control-sm"
              value={density}
              onChange={(e) => setDensity(e.target.value)}
              placeholder="p.ej. 1 + 0.2*x*x"
            />
          </div>

          <div className="mb-2">
            <label className="form-label">Restricción g(x,y)=0 (Lagrange, opcional)</label>
            <input
              type="text"
              className="form-control form-control-sm"
              value={constraint}
              onChange={(e) => setConstraint(e.target.value)}
              placeholder="p.ej. x*x + y*y - 9"
            />
          </div>

          {viewer !== "inspector" && (
            <div className="form-text">
              Cambia a <b>Inspector</b> para usar densidad y restricción.
            </div>
          )}
        </fieldset>
      </aside>

      <main className="canvasArea">
        {viewer === "inspector" ? (
          <SurfaceInspector
            expression={expr}
            range={range}
            resolution={res}
            densityExpression={density || undefined}
            constraintExpression={constraint || undefined}
          />
        ) : viewer === "draggable" ? (
          <SurfaceDraggable
            expression={expr}
            range={range}
            resolution={res}
          />
        ) : viewer === "gradient" ? (
          <GradientField3D
            expression={compiledFn}
            range={range}
            resolution={res}
            vectors={vectors}
            vectorScale={vectorScale}
            step={step}
            t={tParam}
          />
        ) : viewer === "intersection" ? (
          <SurfaceIntersection />
        ) : null}
      </main>
    </div>
  );
}

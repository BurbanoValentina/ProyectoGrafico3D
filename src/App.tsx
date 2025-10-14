import { useState } from "react";
import SurfaceInspector from "./components/SurfaceInspector";
import SurfaceDraggable from "./components/SurfaceDraggable"; // ⬅️ nuevo import

export default function App() {
  const [expr, setExpr] = useState<string>("sin(x*2 + y) - 0.5*sin(t*2)");
  const [range, setRange] = useState<number>(4);
  const [res, setRes] = useState<number>(80);

  // Opcionales para masa/centro de masa y Lagrange (solo los usa el Inspector):
  const [density, setDensity] = useState<string>("1");      // σ(x,y)
  const [constraint, setConstraint] = useState<string>(""); // g(x,y)=0

  // ⬇️ selector de visor
  const [viewer, setViewer] = useState<"inspector" | "draggable">("inspector");

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
            onChange={(e) => setViewer(e.target.value as any)}
          >
            <option value="inspector">Inspector (stats, Lagrange, cortes)</option>
            <option value="draggable">Draggable (pan/zoom/rotar con mouse)</option>
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

        <hr className="my-3 opacity-50" />

        {/* Estos solo aplican al Inspector */}
        <fieldset disabled={viewer === "draggable"}>
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
          {viewer === "draggable" && (
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
        ) : (
          <SurfaceDraggable
            expression={expr}
            range={range}
            resolution={res}
          />
        )}
      </main>
    </div>
  );
}

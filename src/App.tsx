import React, { useState } from "react";
import Surface from "./components/SurfacePlot";

export default function App() {
  const [expr, setExpr] = useState<string>("Math.sin(x*2 + y) - 0.5*Math.cos(t*2)");
  const [range, setRange] = useState<number>(4);
  const [res, setRes] = useState<number>(80);

  return (
    <div className="app">
      <aside className="panel">
        <h2>Calculus 3D — Superficie</h2>
        <label>Función z = f(x,y,t)</label>
        <input
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          placeholder="e.g. Math.sin(x+y)-0.5*Math.cos(t)"
        />
        <label>Rango (±)</label>
        <input type="range" min="1" max="8" step="0.5" value={range} onChange={(e)=>setRange(Number(e.target.value))}/>
        <div>±{range}</div>

        <label>Resolución</label>
        <input type="range" min="20" max="200" step="10" value={res} onChange={(e)=>setRes(Number(e.target.value))}/>
        <div>{res} x {res}</div>

        <p style={{fontSize:12}}>Usa `x`, `y`, `t` y funciones de Math (Math.sin, Math.cos, Math.sqrt, etc.).</p>
      </aside>

      <main className="canvasArea">
        <Surface expression={expr} range={range} resolution={res} />
      </main>
    </div>
  );
}

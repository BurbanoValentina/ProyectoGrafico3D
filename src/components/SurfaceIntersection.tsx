// src/components/SurfaceIntersection.tsx
import { useMemo, useState } from "react";
import SurfacePlot from "./SurfacePlot";
import * as math from "mathjs";

export default function SurfaceIntersection() {
  const [expr1, setExpr1] = useState("sin(x)*cos(y)");
  const [expr2, setExpr2] = useState("cos(x)*sin(y)");
  const [range, setRange] = useState(4);
  const [resolution, setResolution] = useState(60);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Compilar expresiones (memoizado)
  const compiled = useMemo(() => {
    try {
      const f1 = math.compile(expr1);
      const f2 = math.compile(expr2);
      setErrorMsg(null);
      return { f1, f2 };
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Error al compilar expresiones");
      return null;
    }
  }, [expr1, expr2]);

  // Generar malla y evaluar funciones (memoizado)
  const { data, intersections } = useMemo(() => {
    const resultData: Array<{ x: number; y: number; z1: number; z2: number }> = [];
    const resultIntersections: Array<{ x: number; y: number; z: number }> = [];

    if (!compiled) return { data: resultData, intersections: resultIntersections };

    const f1 = compiled.f1;
    const f2 = compiled.f2;

    const safeResolution = Math.max(1, Math.floor(resolution));
    const step = (2 * range) / safeResolution;

    for (let ix = 0; ix <= safeResolution; ix++) {
      const x = -range + ix * step;
      for (let iy = 0; iy <= safeResolution; iy++) {
        const y = -range + iy * step;
        try {
          // Crear scope nuevo para cada evaluación
          const scope1 = { x, y };
          const scope2 = { x, y };
          let z1 = f1.evaluate(scope1);
          let z2 = f2.evaluate(scope2);

          // mathjs puede devolver objetos complejos; convertir a número real si corresponde
          if (math.typeOf(z1) === "Complex") z1 = (z1 as any).re;
          if (math.typeOf(z2) === "Complex") z2 = (z2 as any).re;

          // forzar a número (si es otra cosa)
          z1 = Number(z1);
          z2 = Number(z2);

          if (!isFinite(z1) || !isFinite(z2) || Number.isNaN(z1) || Number.isNaN(z2)) {
            // saltar puntos no válidos
            continue;
          }

          resultData.push({ x, y, z1, z2 });

          const threshold = 0.05;
          if (Math.abs(z1 - z2) < threshold) {
            resultIntersections.push({ x, y, z: (z1 + z2) / 2 });
          }
        } catch (e) {
          // ignorar errores puntuales en evaluación (no romper toda la malla)
          continue;
        }
      }
    }

    return { data: resultData, intersections: resultIntersections };
  }, [compiled, range, resolution]);

  return (
    <div className="p-4 flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Intersección de dos superficies</h2>

      <label className="block">
        Función 1: z₁ =
        <input
          value={expr1}
          onChange={(e) => setExpr1(e.target.value)}
          className="border p-1 rounded ml-2"
        />
      </label>

      <label className="block">
        Función 2: z₂ =
        <input
          value={expr2}
          onChange={(e) => setExpr2(e.target.value)}
          className="border p-1 rounded ml-2"
        />
      </label>

      <label className="block">
        Rango (±) =
        <input
          type="number"
          value={range}
          onChange={(e) => setRange(Number(e.target.value))}
          className="border p-1 rounded ml-2 w-24"
        />
        Resolución =
        <input
          type="number"
          value={resolution}
          onChange={(e) => setResolution(Number(e.target.value))}
          className="border p-1 rounded ml-2 w-24"
        />
      </label>

      {errorMsg ? (
        <div className="text-red-600 text-sm">Error: {errorMsg}</div>
      ) : (
        <SurfacePlot
          {...({
            dataSets: [
              { points: data.map((p) => ({ x: p.x, y: p.y, z: p.z1 })), color: "green", opacity: 0.6 },
              { points: data.map((p) => ({ x: p.x, y: p.y, z: p.z2 })), color: "blue", opacity: 0.6 },
              { points: intersections, color: "red", size: 3, type: "points" },
            ],
          } as any)}
        />
      )}

      <p className="text-sm text-gray-600">
        Los puntos rojos indican la intersección aproximada entre z₁ y z₂.
      </p>
    </div>
  );
}

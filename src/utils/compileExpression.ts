export type Fn3 = (x: number, y: number, t: number) => number;
export type Fn2 = (x: number, y: number) => number;

const MATH_FUNCTIONS = [
  "abs",
  "acos",
  "acosh",
  "asin",
  "asinh",
  "atan",
  "atan2",
  "atanh",
  "cbrt",
  "ceil",
  "clz32",
  "cos",
  "cosh",
  "exp",
  "expm1",
  "floor",
  "fround",
  "hypot",
  "log",
  "log10",
  "log1p",
  "log2",
  "max",
  "min",
  "pow",
  "round",
  "sign",
  "sin",
  "sinh",
  "sqrt",
  "tan",
  "tanh",
  "trunc",
];

const CONSTANT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bpi\b/gi, "Math.PI"],
  [/π/g, "Math.PI"],
  [/\btau\b/gi, "(2*Math.PI)"],
  [/\bphi\b/gi, "((1+Math.sqrt(5))/2)"],
  [/\bdeg2rad\b/gi, "(Math.PI/180)"],
  [/\brad2deg\b/gi, "(180/Math.PI)"],
];

const FUNCTION_ALIAS_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bsen\s*\(/gi, "Math.sin("], // español
  [/\bln\s*\(/gi, "Math.log("],
  [/\btg\s*\(/gi, "Math.tan("],
  [/\bsign\s*\(/gi, "Math.sign("],
];

const HELPER_FUNCTION_DEFINITIONS = `
const cot = (v) => 1 / Math.tan(v);
const ctg = (v) => 1 / Math.tan(v);
const sec = (v) => 1 / Math.cos(v);
const csc = (v) => 1 / Math.sin(v);
const sech = (v) => 1 / Math.cosh(v);
const csch = (v) => 1 / Math.sinh(v);
const coth = (v) => 1 / Math.tanh(v);
`;

const FUNCTION_REGEXP = new RegExp(`\\b(${MATH_FUNCTIONS.join("|")})\\b`, "gi");

function sanitizeExpression(rawExpression: string): string {
  let expr = rawExpression.trim();

  if (!expr) {
    return "0";
  }

  // soportar expoentes con ^ -> ** (JS exponentiation operator)
  expr = expr.replace(/\^/g, "**");

  // reemplazos de constantes conocidos
  for (const [regex, value] of CONSTANT_REPLACEMENTS) {
    expr = expr.replace(regex, value);
  }

  // alias de funciones comunes (en español o abreviaturas)
  for (const [regex, value] of FUNCTION_ALIAS_REPLACEMENTS) {
    expr = expr.replace(regex, value);
  }

  // añadir Math. a funciones conocidas si no lo tienen ya
  expr = expr.replace(FUNCTION_REGEXP, (match, _fnName, offset, source) => {
    const index = Number(offset);
    let i = index - 1;
    while (i >= 0 && /\s/.test(source[i])) {
      i -= 1;
    }
    if (i >= 0 && source[i] === ".") {
      return match; // ya está como Math.fn
    }
    const lower = String(match).toLowerCase();
    return `Math.${lower}`;
  });

  return expr;
}

function wrapCallable(fn: Function): Fn3 {
  return (x: number, y: number, t: number) => {
    try {
      const result = fn(x, y, t);
      const value = Number(result);
      return Number.isFinite(value) ? value : NaN;
    } catch (_error) {
      return NaN;
    }
  };
}

export function compileExpression3(expr: string): Fn3 {
  const sanitized = sanitizeExpression(expr);
  try {
    // eslint-disable-next-line no-new-func
    const compiled = new Function(
      "x",
      "y",
      "t",
      `"use strict";\n${HELPER_FUNCTION_DEFINITIONS}return (${sanitized});`
    );
    return wrapCallable(compiled);
  } catch (_error) {
    return () => NaN;
  }
}

export function compileExpression2(expr: string | undefined): Fn2 | null {
  if (!expr || !expr.trim()) {
    return null;
  }
  const sanitized = sanitizeExpression(expr);
  try {
    // eslint-disable-next-line no-new-func
    const compiled = new Function("x", "y", `"use strict";\n${HELPER_FUNCTION_DEFINITIONS}return (${sanitized});`);
    const wrapped = (x: number, y: number) => {
      try {
        const result = compiled(x, y);
        const value = Number(result);
        return Number.isFinite(value) ? value : NaN;
      } catch (_error) {
        return NaN;
      }
    };
    return wrapped;
  } catch (_error) {
    return null;
  }
}

export function evalExpression3(expr: string, x: number, y: number, t: number): number {
  return compileExpression3(expr)(x, y, t);
}

export function sanitizeForPreview(expr: string): string {
  return sanitizeExpression(expr);
}

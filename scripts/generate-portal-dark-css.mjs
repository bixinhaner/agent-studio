#!/usr/bin/env node
/**
 * Generates the portal dark theme from the light stylesheets.
 *
 * Every rule that sets a colour is re-emitted under
 * `:root[data-portal-theme="dark"]`: light surfaces become dark surfaces, dark
 * text becomes light text, light borders become subtle dark lines, and
 * saturated brand/status colours are kept. Rules are emitted in source order
 * (including unchanged colours) so the original cascade between states such
 * as `.btn` and `.btn.is-active` is preserved.
 *
 * Usage: node scripts/generate-portal-dark-css.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "agent-ui", "src");
const SOURCES = [
  "styles.css",
  "features/portal/workbench/workbench.css",
  "features/portal/inline-composer.css",
  "features/portal/workbench/local-workspace.css",
  "features/artifacts/artifact-file-list.css",
  "features/portal/roadmap/roadmap.css"
];
const OUTPUT = "features/portal/roadmap/portal-dark.generated.css";
const PREFIX = ':root[data-portal-theme="dark"]';

const COLOR_PROPS = new Set([
  "background",
  "background-color",
  "background-image",
  "color",
  "border",
  "border-color",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline",
  "outline-color",
  "box-shadow",
  "fill",
  "stroke",
  "caret-color",
  "text-decoration-color",
  "-webkit-text-fill-color"
]);

// ---------- colour helpers ----------
const NAMED = { white: "#ffffff", black: "#000000" };

function parseColor(token) {
  const lower = token.toLowerCase();
  if (NAMED[lower]) return parseColor(NAMED[lower]);
  let match = /^#([0-9a-f]{3,8})$/i.exec(lower);
  if (match) {
    let hex = match[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
    if (hex.length !== 6 && hex.length !== 8) return null;
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a };
  }
  match = /^rgba?\(([^)]+)\)$/i.exec(lower);
  if (match) {
    const parts = match[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3 || parts.slice(0, 3).some((p) => p.includes("var("))) return null;
    const channel = (p) => (p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p));
    const alpha = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    const color = { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha };
    return [color.r, color.g, color.b, color.a].some(Number.isNaN) ? null : color;
  }
  return null;
}

function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function fromHsl({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((v) => Math.round((v + m) * 255));
}

function format([r, g, b], a) {
  if (a >= 0.999) return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

const lerp = (from, to, t) => from + (to - from) * t;

/** role: "surface" | "text" | "line" */
function mapColor(token, role) {
  const color = parseColor(token);
  if (!color) return token;
  const hsl = toHsl(color);
  const vivid = hsl.s > 0.45 && hsl.l > 0.25 && hsl.l < 0.72;
  // Translucent dark washes (hover fills, hairlines) become translucent light washes.
  if (role !== "text" && color.a < 0.5 && hsl.l < 0.35 && !vivid) {
    return format([255, 255, 255], Math.min(0.24, color.a * 1.4 + 0.02));
  }
  if (role === "text") {
    if (hsl.l >= 0.55) return token; // already light (text on coloured fills)
    if (vivid) return format(fromHsl({ ...hsl, l: Math.max(hsl.l, 0.62) }), color.a);
    // #0f172a → ~#e8eaee, #64748b → ~#a3abb8
    const l = lerp(0.93, 0.62, Math.min(1, hsl.l / 0.55));
    return format(fromHsl({ h: hsl.h, s: Math.min(hsl.s, 0.18), l }), color.a);
  }
  if (role === "line") {
    if (hsl.l < 0.6 || vivid) return vivid ? format(fromHsl({ ...hsl, l: Math.min(hsl.l, 0.5) }), color.a) : token;
    const l = lerp(0.2, 0.3, (1 - hsl.l) / 0.4);
    return format(fromHsl({ h: hsl.h, s: Math.min(hsl.s, 0.12), l }), color.a);
  }
  // surface
  if (vivid) return token;
  if (hsl.l < 0.55) {
    // Dark fills (tooltips, primary buttons in neutral) stay dark but lift slightly.
    return hsl.l < 0.2 ? format(fromHsl({ h: hsl.h, s: Math.min(hsl.s, 0.2), l: 0.26 }), color.a) : token;
  }
  // Pastel tints keep a hint of their hue: #eff6ff → deep blue-grey.
  const tinted = hsl.s > 0.3 && hsl.l < 0.985;
  const l = lerp(0.105, 0.2, Math.min(1, (1 - hsl.l) / 0.35));
  return format(fromHsl({ h: hsl.h, s: tinted ? Math.min(hsl.s, 0.35) : Math.min(hsl.s, 0.08), l }), color.a);
}

const COLOR_TOKEN = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/g;

function mapValue(value, role) {
  return value.replace(COLOR_TOKEN, (token) => mapColor(token, role));
}

function roleFor(prop) {
  if (prop === "color" || prop === "-webkit-text-fill-color" || prop === "caret-color" || prop === "fill" || prop === "stroke" || prop === "text-decoration-color") return "text";
  if (prop.startsWith("border") || prop.startsWith("outline")) return "line";
  if (prop === "box-shadow") return "shadow";
  return "surface";
}

function roleForCustomProperty(name, value) {
  const lower = name.toLowerCase();
  if (/(text|fg|ink|muted|strong|foreground|shimmer)/.test(lower)) return "text";
  if (/(line|border|divider|stroke|outline)/.test(lower)) return "line";
  if (/(bg|surface|background|panel|card|canvas|fill|soft|tint)/.test(lower)) return "surface";
  const color = parseColor((value.match(COLOR_TOKEN) || [""])[0]);
  if (!color) return null;
  return toHsl(color).l > 0.6 ? "surface" : "text";
}

function transformDeclaration(prop, value) {
  if (prop.startsWith("--")) {
    if (!COLOR_TOKEN.test(value)) return null;
    COLOR_TOKEN.lastIndex = 0;
    const role = roleForCustomProperty(prop, value);
    return role ? mapValue(value, role) : null;
  }
  if (!COLOR_PROPS.has(prop)) return null;
  const role = roleFor(prop);
  if (role === "shadow") {
    // Light glows read as haze on dark surfaces; darken any light shadow colour.
    return value.replace(COLOR_TOKEN, (token) => {
      const color = parseColor(token);
      if (!color) return token;
      const { l } = toHsl(color);
      return l > 0.6 ? `rgba(0, 0, 0, ${Number(Math.min(0.5, color.a + 0.15).toFixed(3))})` : token;
    });
  }
  return mapValue(value, role);
}

// ---------- tiny CSS walker ----------
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0, quote = "", current = "";
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    if (ch === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function prefixSelector(selector) {
  return splitTopLevel(selector, ",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (/^(html|:root)\b/.test(part)) return part.replace(/^(html|:root)/, PREFIX);
      return `${PREFIX} ${part}`;
    })
    .join(",\n");
}

/** Parses a block list; returns emitted CSS for the dark theme. */
function walk(css) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    // find matching close
    let depth = 1, j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth += 1;
      else if (css[j] === "}") depth -= 1;
      j += 1;
    }
    const body = css.slice(open + 1, j - 1);
    i = j;
    if (!head) continue;
    if (head.startsWith("@")) {
      if (/^@(media|supports|container|layer)\b/.test(head)) {
        const inner = walk(body);
        if (inner.trim()) out += `${head} {\n${inner}}\n`;
      }
      continue; // keyframes, font-face, property…
    }
    if (/::view-transition/.test(head)) continue;
    const declarations = [];
    for (const raw of splitTopLevel(body, ";")) {
      const colon = raw.indexOf(":");
      if (colon < 0) continue;
      const prop = raw.slice(0, colon).trim().toLowerCase();
      const value = raw.slice(colon + 1).trim();
      if (!value) continue;
      const mapped = transformDeclaration(prop, value);
      if (mapped === null) continue;
      declarations.push(`  ${prop}: ${mapped};`);
    }
    if (declarations.length) out += `${prefixSelector(head)} {\n${declarations.join("\n")}\n}\n`;
  }
  return out;
}

let output = `/* Generated by scripts/generate-portal-dark-css.mjs — do not edit by hand. */\n`;
for (const source of SOURCES) {
  const file = path.join(root, source);
  if (!fs.existsSync(file)) continue;
  const css = stripComments(fs.readFileSync(file, "utf8"));
  output += `\n/* ---- ${source} ---- */\n${walk(css)}`;
}
fs.writeFileSync(path.join(root, OUTPUT), output);
console.log(`wrote ${OUTPUT} (${(output.length / 1024).toFixed(1)} KB)`);

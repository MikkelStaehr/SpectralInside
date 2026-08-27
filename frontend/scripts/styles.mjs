/**
 * Fanger stilarter, der aldrig kom med.
 *
 * En manglende CSS-regel fejler stille. Koden får sin klasse, stilarket får
 * ingenting, og knappen står som en rå browserknap i Arial — det opdages
 * først, når nogen kigger på skærmen og synes, der er noget galt. Det skete,
 * og det er derfor den her findes.
 *
 * To kontroller:
 *
 *   1. Klassenavne i koden, som stilarket slet ikke kender.
 *   2. Knapper, der stadig har browserens standardudseende.
 *
 * Den anden er den vigtige. Den første kan larme om skabelonstrenge, hvor
 * klassen sættes sammen af stumper, så den er en advarsel og ikke en fejl.
 *
 * Kør med backenden oppe og frontenden bygget:
 *
 *     npm run styles
 *
 * BASE for en anden adresse.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE ?? "http://127.0.0.1:8000";
const CHROME =
  process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Alle .tsx under src, uanset hvor dybt. */
function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

function missingRules() {
  const css = readFileSync("src/styles.css", "utf-8");
  const known = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

  const used = new Map();
  for (const path of sources("src")) {
    const text = readFileSync(path, "utf-8");
    for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      // Udtryk inde i ${...} kan bære klassenavne. Behold ordene, smid
      // syntaksen væk.
      const raw = (m[1] ?? m[2] ?? "").replace(/\$\{([^}]*)\}/g, " $1 ");
      for (const token of raw.match(/[a-zA-Z][\w-]*/g) ?? []) {
        // Kun det, der ligner et klassenavn. En skabelonstreng, der ender på
        // "--", er et præfiks og har sin regel under et fuldt navn.
        if (!token.includes("__") && !token.includes("-")) continue;
        // Et præfiks fra en skabelonstreng, "pill--" i `pill--${state}`, har
        // sin regel under det fulde navn. Det er ikke en manglende stil.
        if (token.endsWith("-")) continue;
        if (known.has(token)) continue;
        used.set(token, (used.get(token) ?? new Set()).add(path));
      }
    }
  }
  return used;
}

/** Knapper, der stadig ser ud som browserens egne. */
const RAW_BUTTONS = `(() => {
  const out = [];
  for (const el of document.querySelectorAll("button, select")) {
    const c = getComputedStyle(el);
    if (el.getBoundingClientRect().width === 0) continue;
    // Et trykfelt uden tekst har ingen skrift at tage fejl af.
    const hasText = (el.textContent || "").trim().length > 0;
    const defaultFill = c.backgroundColor === "rgb(239, 239, 239)";
    const defaultBorder = c.borderTopStyle === "outset";
    const defaultFont = hasText && !c.fontFamily.includes("Inter");
    if (defaultFill || defaultBorder || defaultFont) {
      out.push({
        cls: el.className || "(uden klasse)",
        text: (el.textContent || "").trim().slice(0, 30),
        why: [
          defaultFill && "fyld",
          defaultBorder && "kant",
          defaultFont && "skrift",
        ].filter(Boolean).join(", "),
      });
    }
  }
  return out;
})()`;

const SCREENS = [
  ["produktionsbrættet", "/#/visning", null],
  ["operatørskærmen", "/#/visning/DEMO-4110", null],
  ["ordrebogen", "/#/ordrer", "Ordrekontoret"],
  ["lots", "/#/lots", "Mikkel"],
  ["arbejdsbordet", "/#/", "Mikkel"],
];

let problems = 0;

const missing = missingRules();
if (missing.size > 0) {
  console.log("Klasser uden regel i styles.css:");
  for (const [name, files] of [...missing].sort()) {
    console.log(`  ${name.padEnd(32)} ${[...files].join(", ")}`);
  }
  console.log("  (advarsel, ikke en fejl: nogle sættes sammen i koden)\n");
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--disable-gpu", "--no-sandbox"],
  defaultViewport: { width: 1900, height: 1250 },
});

for (const [name, path, signIn] of SCREENS) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => {
    console.log(`  ${name}: SIDEFEJL ${e.message}`);
    problems += 1;
  });

  await page.goto(BASE + path, { waitUntil: "networkidle2" });
  await pause(2000);

  if (signIn) {
    await page.evaluate((who) => {
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes(who))
        ?.click();
    }, signIn);
    await pause(2200);
    await page.goto(BASE + path, { waitUntil: "networkidle2" });
    await pause(2000);
  }

  const raw = await page.evaluate(RAW_BUTTONS);
  if (raw.length === 0) {
    console.log(`  ${name}: alle knapper er stylet`);
  } else {
    problems += raw.length;
    console.log(`  ${name}:`);
    for (const r of raw) {
      console.log(`     ${String(r.cls).slice(0, 34).padEnd(34)} "${r.text}"  (${r.why})`);
    }
  }
  await page.close();
}

await browser.close();

if (problems > 0) {
  console.log(`\n${problems} knapper eller fejl uden stil. Se ovenfor.`);
  process.exit(1);
}
console.log("\nIngen knapper står uden stil.");

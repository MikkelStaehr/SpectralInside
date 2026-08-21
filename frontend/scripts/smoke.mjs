/**
 * Røgtest af hele operatørforløbet: login, daglig opstart som guide,
 * arbejdsbordet og en vedligeholdelsesregistrering.
 *
 * Kører mod en kørende backend med den byggede frontend serveret fra samme
 * port. Bruger den Chrome, der allerede er installeret, der hentes ingen
 * browser ned.
 *
 *   cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
 *   cd frontend && npm run build && npm run smoke
 *
 * Sæt BASE for en anden adresse, og SHOTS for at gemme skærmbilleder.
 */

import puppeteer from "puppeteer-core";

const BASE = process.env.BASE ?? "http://127.0.0.1:8000";
const SHOTS = process.env.SHOTS ?? null;
const CHROME =
  process.env.CHROME_PATH ??
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const ok = (label, condition) => {
  console.log(`${condition ? "  ok  " : "  FEJL"}  ${label}`);
  if (!condition) process.exitCode = 1;
};

const note = (text) => console.log(`  --    ${text}`);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** Klik punktet i sidebaren og vent på, at siden er skiftet. */
const goto = async (page, label) => {
  await clickByText(page, ".nav", label);
  await pause(400);
};

/** Klik knappen i en container hvis tekst indeholder `label`. */
const clickByText = async (page, container, label) => {
  const clicked = await page.$$eval(
    `${container} button`,
    (buttons, text) => {
      const target = buttons.find((b) => b.textContent.includes(text));
      if (target) target.click();
      return Boolean(target);
    },
    label,
  );
  if (!clicked) throw new Error(`Fandt ingen knap med teksten "${label}"`);
  await pause(150);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--disable-gpu", "--hide-scrollbars", "--no-sandbox"],
  defaultViewport: { width: 1600, height: 1000 },
});

try {
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: "networkidle0" });

  console.log("\n1) Login vises som det første");
  await page.waitForSelector(".login__card");
  ok("login-kortet er synligt", (await page.$(".login__card")) !== null);
  ok("arbejdsbordet er ikke nået", (await page.$(".shell")) === null);

  const people = await page.$$(".login__people li button");
  const usesList = people.length > 0;
  note(
    usesList
      ? `operators.yaml giver ${people.length} at vælge imellem`
      : "operators.yaml er tom, login beder om fritekst",
  );
  await shot(page, usesList ? "login-liste" : "login");

  console.log("\n2) Vælg bruger");
  let chosen;
  if (usesList) {
    chosen = await page.$eval(
      ".login__people li:first-child .person__initials",
      (el) => el.textContent.trim(),
    );
    await people[0].click();
  } else {
    chosen = "MSM";
    await page.type("#initials", chosen);
    await page.click(".login__form button[type=submit]");
  }
  await page.waitForSelector(".shell", { timeout: 5000 });
  const badge = await page.$eval(".operator__initials", (el) =>
    el.textContent.trim(),
  );
  ok(`sidebaren viser "${badge}"`, badge === chosen);

  console.log("\n3) Daglig opstart møder én som guide");
  const wizard = await page.waitForSelector(".modal__card", { timeout: 5000 });
  ok("guiden åbner af sig selv", wizard !== null);
  const steps = await page.$$eval(".modal__progress .dot", (els) => els.length);
  ok(`guiden har ${steps} trin`, steps > 0);
  await shot(page, "guide");

  const firstStep = await page.$eval(".modal__step", (el) => el.textContent);
  await clickByText(page, ".modal__foot", "Næste");
  const secondStep = await page.$eval(".modal__step", (el) => el.textContent);
  ok(`"Næste" går videre (${firstStep} → ${secondStep})`, firstStep !== secondStep);

  await clickByText(page, ".modal__foot", "Forrige");
  const backStep = await page.$eval(".modal__step", (el) => el.textContent);
  ok('"Forrige" går tilbage', backStep === firstStep);

  console.log("\n4) Guiden kan lukkes uden at tælle som udført");
  await clickByText(page, ".modal__foot", "Ikke nu");
  await pause(250);
  ok("guiden er lukket", (await page.$(".modal__card")) === null);
  const stillPending = await fetch(`${BASE}/api/daily`).then((r) => r.json());
  ok(
    "den står stadig som ikke kørt",
    stillPending.every((d) => d.done === false),
  );
  ok(
    "arbejdsbordet minder om den",
    (await page.$(".notice--todo")) !== null,
  );

  console.log("\n5) Gennemfør guiden");
  await page.click(".notice--todo");
  await page.waitForSelector(".modal__card");

  for (let i = 0; i < steps - 1; i += 1) {
    // Trin med ventetid låser knappen, indtil nedtællingen er kørt.
    const countdown = await page.$(".countdown");
    if (countdown) {
      const locked = await page.$$eval(".modal__foot button", (buttons) => {
        const next = buttons.find((b) => b.textContent.includes("Næste"));
        return next ? next.disabled : false;
      });
      ok("ventetrin låser knappen", locked);
      const secs = await page.$eval(".countdown__number", (el) =>
        el.textContent.trim(),
      );
      note(`venter nedtællingen ud (${secs} tilbage)`);
      await page.waitForFunction(
        () =>
          document.querySelector(".countdown--done") !== null,
        { timeout: 90_000, polling: 500 },
      );
      ok("knappen låser op, når tiden er gået", true);
    }
    await clickByText(page, ".modal__foot", "Næste");
  }
  await clickByText(page, ".modal__foot", "Instrumentet er klar");
  // Påmindelsen forsvinder, når dagens opstart er registreret.
  await page.waitForFunction(
    () => document.querySelector(".notice--todo") === null,
    { timeout: 5000, polling: 200 },
  );
  const done = await fetch(`${BASE}/api/daily`).then((r) => r.json());
  ok("registreret serverside", done[0]?.done === true);
  ok(`registreret på "${done[0]?.done_by}"`, done[0]?.done_by === chosen);
  ok("påmindelsen er væk fra arbejdsbordet", true);

  console.log("\n6) Arbejdsbordet viser scanningerne");
  const counts = await page.$$eval(".counts__number", (els) =>
    els.map((el) => el.textContent.trim()),
  );
  ok(`tællingerne står der (i går, i dag, 7 dage: ${counts.join(", ")})`,
    counts.length === 3);
  const rows = await page.$$eval(".recent tbody tr", (els) => els.length);
  ok(`browseren viser ${rows} seneste scanninger`, rows > 0);
  await shot(page, "arbejdsbord");

  console.log("\n7) Wiki og Vedligehold er hver sin side");
  await goto(page, "Wiki");
  const wikiGuides = await page.$$eval(".wiki .guides li", (els) => els.length);
  ok(`wikien har ${wikiGuides} guides`, wikiGuides > 0);

  await goto(page, "Vedligehold");
  ok("vedligeholdssiden er åben", (await page.$(".maintenance")) !== null);
  const upkeepGuides = await page.$$eval(
    ".maintenance .guides li",
    (els) => els.length,
  );
  ok(`fremgangsmåderne følger med (${upkeepGuides})`, upkeepGuides > 0);

  console.log("\n8) Vedligehold beder kun om det, der haster");
  const countRows = () => page.$$eval(".tasks li", (els) => els.length);
  const before = await countRows();
  const settledToggle = await page.$(".settled__toggle");
  ok("opgaver uden hastværk ligger bag en knap", settledToggle !== null);
  note(`${before} kræver handling`);
  await settledToggle.click();
  await pause(200);
  const expanded = await countRows();
  ok(`de øvrige kan foldes ud (${before} → ${expanded})`, expanded > before);
  const usingSettled = before === 0;
  if (!usingSettled) await settledToggle.click();

  console.log("\n9) Registrering med baguddatering");
  await page.waitForSelector(".tasks li");
  const taskId = await page.$eval(".tasks li", (el) => el.dataset.taskId);
  await page.click(".tasks li:first-child .task__head");
  await page.waitForSelector(".task__register input[type=date]");

  const backdated = new Date(Date.now() - 3 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await page.$eval(
    ".task__register input[type=date]",
    (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    backdated,
  );
  await page.waitForSelector(".task__backdated");
  ok("baguddatering forklares for operatøren", true);
  await page.click(".task__register .btn");
  await pause(900);

  const log = await fetch(`${BASE}/api/maintenance/${taskId}/log`).then((r) =>
    r.json(),
  );
  ok(`loggen viser afsender "${log[0]?.done_by}"`, log[0]?.done_by === chosen);
  ok(
    `loggen viser den valgte dato ${log[0]?.done_at?.slice(0, 10)}`,
    log[0]?.done_at?.slice(0, 10) === backdated,
  );

  console.log("\n10) Et frø kan åbnes og lægges under en spektral linse");
  await goto(page, "Scanninger");
  await page.waitForSelector(".scan-list .scan");
  await page.click(".scan-list .scan");
  await page.waitForSelector(".blob-grid img");
  await pause(800);
  await page.click(".blob-grid .blob");
  await page.waitForSelector(".seed__canvas");
  await pause(600);

  const bandChips = await page.$$eval(".seed__bands .chip--button", (els) =>
    els.map((el) => el.textContent.trim()),
  );
  const wavelengths = bandChips.filter((t) => t.endsWith("nm"));
  ok(`${wavelengths.length} bånd kan vælges`, wavelengths.length > 1);

  const size = await page.$eval(".seed__canvas", (c) => {
    const box = c.getBoundingClientRect();
    return { data: c.width, shown: Math.round(box.width) };
  });
  ok(
    `frøet skaleres op (${size.data} px data vist som ${size.shown} px)`,
    size.shown > size.data,
  );

  const pick = async (label) => {
    await page.$$eval(
      ".seed__bands .chip--button",
      (els, text) => {
        const target = els.find((el) => el.textContent.trim() === text);
        if (target) target.click();
      },
      label,
    );
    await pause(700);
  };

  await pick(wavelengths[Math.floor(wavelengths.length / 2)]);
  const grey = await page.$eval(".seed__canvas", (c) => {
    const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let coloured = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] !== px[i + 1] || px[i + 1] !== px[i + 2]) coloured += 1;
    }
    return coloured;
  });
  ok("gråtone er faktisk gråtone", grey === 0);

  await pick("Jet");
  const painted = await page.$eval(".seed__canvas", (c) => {
    const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let coloured = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] !== px[i + 1] || px[i + 1] !== px[i + 2]) coloured += 1;
    }
    return coloured;
  });
  ok(`linsen farvelægger billedet (${painted} pixels)`, painted > 0);
  await shot(page, "froe-jet");

  await page.keyboard.press("Escape");
  await pause(300);
  ok("Esc lukker frøet", (await page.$(".seed__canvas")) === null);

  console.log("\n11) Genindlæsning: valget huskes, guiden kommer ikke igen");
  await goto(page, "Arbejdsbord");
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".shell");
  ok("stadig valgt", (await page.$(".operator__initials")) !== null);
  await pause(600);
  ok("guiden dukker ikke op igen", (await page.$(".modal__card")) === null);

  console.log("\n12) Skift bruger fører tilbage til login");
  await page.click(".operator");
  await page.waitForSelector(".login__card", { timeout: 5000 });
  ok("login vises igen", (await page.$(".login__card")) !== null);

  console.log("\n13) Et valg fra i går accepteres ikke");
  await page.evaluate(() =>
    localStorage.setItem(
      "ubs.operator",
      JSON.stringify({ initials: "AB", date: "2020-01-01" }),
    ),
  );
  await page.reload({ waitUntil: "networkidle0" });
  ok("login vises efter datoskift", (await page.$(".login__card")) !== null);
} finally {
  await browser.close();
  console.log("");
}

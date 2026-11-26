import { expect, test, type Page } from '@playwright/test';

// Pruebas en el navegador (fase 14): el menú, los 14 niveles, las 11 pruebas libres y el tándem se abren, dibujan y
// corren sin mensajes en la consola. Se prueba el juego compilado (ver playwright.config.ts).

const CRANES = ['small', 'medium', 'rt', 'large', 'at300', 'at450', 'xl', 'at650', 'crawler', 'lr', 'sk'];
const LEVELS = Array.from({ length: 14 }, (_, i) => i + 1);

/**
 * Avisos del WebGL por software de la prueba (SwiftShader), no del juego: el driver avisa de rendimiento cuando
 * Chrome lee la imagen para componer la página.
 */
const DRIVER_NOISE = /GL Driver Message \(OpenGL, Performance/;

/** Todo lo que sale en la consola (salvo depuración y el ruido del driver) y los errores sin capturar */
function watchConsole(page: Page) {
  const out: string[] = [];
  page.on('console', (m) => { if (m.type() !== 'debug' && !DRIVER_NOISE.test(m.text())) out.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => out.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => out.push(`requestfailed: ${r.url()}`));
  return out;
}

/**
 * Abre una página del juego con calidad baja (sin sombras ni antialias, a 3/4 de resolución): con WebGL por software
 * el dibujo es casi todo el tiempo de las pruebas, y aquí no se mira la imagen.
 */
const open = (page: Page, q = '') => page.goto(`./?${q ? `${q}&` : ''}calidad=bajo`);

/** Espera a la partida montada y a que se hayan dibujado cuadros (la pantalla de carga se quita al primero) */
async function ready(page: Page) {
  await page.waitForFunction(() => performance.getEntriesByName('gruas-partida').length > 0);
  await page.waitForFunction(() => performance.getEntriesByName('gruas-listo').length > 0);
  await expect(page.locator('#boot')).toHaveCount(0);
  // unos cuantos cuadros más
  await page.evaluate(() => new Promise<void>((r) => { let n = 0; const f = () => (++n >= 10 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
}

/** Tarjetas de los niveles del menú (sin las de la escuela, fase 19) */
const JOBS = '.levels:not(.school) a.lvl';

test('menú: los 14 trabajos, las dos pruebas libres y las 6 lecciones de la escuela', async ({ page }) => {
  const log = watchConsole(page);
  await open(page);
  await ready(page);
  await expect(page.locator(JOBS)).toHaveCount(16);
  await expect(page.locator('.levels.school a.lvl')).toHaveCount(6);
  await expect(page.locator('#lcard h2')).toHaveText('Elige un trabajo');
  expect(log).toEqual([]);
});

test('ir a un nivel desde el menú no recarga la página', async ({ page }) => {
  const log = watchConsole(page);
  await open(page);
  await ready(page);
  await page.evaluate(() => { (window as unknown as { marca: number }).marca = 1; });
  await page.locator(JOBS).first().click();
  await expect(page).toHaveURL(/nivel=1/);
  await expect(page.locator('#l-start')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { marca?: number }).marca)).toBe(1);
  await page.goBack();
  await expect(page.locator(JOBS)).toHaveCount(16);
  expect(log).toEqual([]);
});

for (const n of LEVELS) {
  test(`nivel ${n}: ficha, turno y consola limpia`, async ({ page }) => {
    const log = watchConsole(page);
    await open(page, `nivel=${n}`);
    await ready(page);
    const start = page.locator('#l-start');
    await expect(start).toBeVisible();
    await start.click();
    await expect(page.locator('#overlay')).toBeHidden();
    await expect(page.locator('#clock')).toBeVisible();
    await expect(page.locator('#data')).toContainText('LMI');
    // el reloj corre (con WebGL por software, despacio: el bucle da como mucho 4 pasos por cuadro)
    const t0 = await page.locator('#clock .clock-text > b').textContent();
    await expect(page.locator('#clock .clock-text > b')).not.toHaveText(t0!, { timeout: 30_000 });
    expect(log).toEqual([]);
  });
}

for (const id of CRANES) {
  test(`prueba libre ${id}: dibuja y responde a las teclas`, async ({ page }) => {
    const log = watchConsole(page);
    await open(page, `grua=${id}`);
    await ready(page);
    await expect(page.locator('#data')).toContainText('LMI');
    // R sube el gancho: el largo del cable cambia (la SK 60 sin montar no mueve nada: avisa). No F: el gancho de las
    // orugas empieza cerca del suelo y el cable no se alarga más allá (falló así en la acción con la LR 3000)
    const cable = async () => /Cable ([\d,]+) m/.exec(await page.locator('#data').innerText())?.[1];
    const before = await cable();
    expect(before).toBeTruthy();
    // se mantiene pulsada hasta que cambie: con pocos cuadros por segundo la simulación avanza despacio
    await page.keyboard.down('KeyR');
    if (id === 'sk') await expect(page.locator('#msg')).toContainText('Monta la grúa torre primero (M)');
    else await expect.poll(cable, { timeout: 60_000 }).not.toBe(before);
    await page.keyboard.up('KeyR');
    expect(log).toEqual([]);
  });
}

test('prueba libre en tándem: dos grúas y Tab cambia de grúa', async ({ page }) => {
  const log = watchConsole(page);
  await open(page, 'tandem=1');
  await ready(page);
  await expect(page.locator('#other')).toBeVisible();
  const title = await page.locator('#data .title').innerText();
  await page.keyboard.press('Tab');
  await expect(page.locator('#data .title')).not.toHaveText(title);
  expect(log).toEqual([]);
});

test('teclas configurables: se cambian en la ayuda, se guardan y la grúa las obedece', async ({ page }) => {
  const log = watchConsole(page);
  await open(page, 'grua=medium');
  await ready(page);
  await page.keyboard.press('KeyH');
  await page.locator('#help-edit').click();
  await page.locator('.kbtn[data-a="outriggers"]').click();
  await page.keyboard.press('KeyU');
  await expect(page.locator('.kbtn[data-a="outriggers"]')).toHaveText('U');
  await page.keyboard.press('Escape');
  await expect(page.locator('#help')).toBeHidden();
  // O ya no hace nada; U despliega los estabilizadores
  await page.keyboard.press('KeyO');
  await expect(page.locator('#msg')).not.toContainText('Desplegando');
  await page.keyboard.press('KeyU');
  await expect(page.locator('#msg')).toHaveText('Desplegando estabilizadores');
  // al recargar sigue igual
  await page.reload();
  await ready(page);
  expect(await page.evaluate(() => localStorage.getItem('gruas-teclas'))).toBe('{"outriggers":"KeyU"}');
  expect(log).toEqual([]);
});

test('tabla de cargas (C) y plan de izaje en la ficha', async ({ page }) => {
  const log = watchConsole(page);
  await open(page, 'nivel=1');
  await ready(page);
  // plan de izaje: la planta, una fila por carga y volver a la ficha
  await page.locator('#l-plan').click();
  await expect(page.locator('.plan-cv')).toBeVisible();
  await expect(page.locator('.plan-table tr[data-k]')).toHaveCount(2);
  const before = await page.locator('.plan-table').innerText();
  // arrastrar el fantasma cambia los radios
  const box = (await page.locator('.plan-cv').boundingBox())!;
  const sx = box.width / 84, x0 = box.x + 10 * sx, y0 = box.y + 46 * sx;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 20 * sx, y0 - 6 * sx, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.plan-table')).not.toHaveText(before);
  await page.locator('#p-back').click();
  await page.locator('#l-start').click();
  await expect(page.locator('#overlay')).toBeHidden();
  // tabla de cargas: C la abre con la casilla actual marcada y la vuelve a cerrar
  await page.keyboard.press('KeyC');
  await expect(page.locator('.chart')).toBeVisible();
  await expect(page.locator('.chart td.now')).toHaveCount(1);
  await expect(page.locator('.chart-now')).toContainText('capacidad');
  await page.keyboard.press('KeyC');
  await expect(page.locator('.chart')).toBeHidden();
  expect(log).toEqual([]);
});

test('pausa al perder el foco: no se acumulan pasos de física', async ({ page }) => {
  const log = watchConsole(page);
  await open(page, 'grua=medium');
  await ready(page);
  await page.evaluate(() => dispatchEvent(new Event('blur')));
  await expect(page.locator('.pause-card')).toBeVisible();
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await expect(page.locator('.pause-card')).toBeHidden();
  expect(log).toEqual([]);
});

// Fase 15: rebobinar (prueba libre) y guardar a mitad de un nivel
test('prueba libre: rebobinar con Retroceso', async ({ page }) => {
  const log = watchConsole(page);
  await open(page, 'grua=medium');
  await ready(page);
  // instantánea al empezar y una por segundo: se vuelve a la de hace 10 s o, si no hay, a la primera
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyA');
  await page.keyboard.press('Backspace');
  await expect(page.locator('#msg')).toContainText('Rebobinado');
  expect(log).toEqual([]);
});

test('nivel: guardar a mitad y continuar desde la ficha', async ({ page }) => {
  const log = watchConsole(page);
  await open(page, 'nivel=1');
  await ready(page);
  await page.locator('#l-start').click();
  const clock = page.locator('#clock .clock-text > b');
  const t0 = await clock.textContent();
  await expect(clock).not.toHaveText(t0!, { timeout: 30_000 });
  await page.locator('#l-save').click();
  await expect(page.locator('#msg')).toContainText('Partida guardada');
  const saved = await clock.textContent();
  // al volver a abrir el nivel, la ficha ofrece continuar, y continuar sigue con el reloj donde quedó
  await page.reload();
  await ready(page);
  await expect(page.locator('#l-cont')).toBeVisible();
  await page.locator('#l-cont').click();
  await expect(page.locator('#msg')).toContainText('recuperada', { timeout: 30_000 });
  await expect(page.locator('#overlay')).toBeHidden();
  const [mm, ss] = saved!.split(':').map(Number);
  const now = await clock.textContent();
  const [m2, s2] = now!.split(':').map(Number);
  expect(m2 * 60 + s2).toBeGreaterThanOrEqual(mm * 60 + ss);
  await expect(page).not.toHaveURL(/continuar/);
  expect(log).toEqual([]);
});

test('escuela: la lección 2 se pasa con el teclado, se guarda y lleva a la siguiente sin recargar', async ({ page }) => {
  const log = watchConsole(page);
  await open(page, 'escuela=2');
  await ready(page);
  await page.evaluate(() => { (window as unknown as { marca: number }).marca = 1; });
  await page.locator('#s-start').click();
  await expect(page.locator('#lesson')).toContainText('Paso 1 de 3');
  // O tres veces: sacar, recoger y volver a sacar los estabilizadores (cada uno cuando termina el anterior)
  for (const n of [2, 3]) {
    await page.keyboard.press('KeyO');
    await expect(page.locator('#lesson')).toContainText(`Paso ${n} de 3`, { timeout: 20_000 });
  }
  await page.keyboard.press('KeyO');
  await expect(page.locator('#lcard h2')).toHaveText('Lección 2 superada', { timeout: 20_000 });
  expect(await page.evaluate(() => localStorage.getItem('gruas-escuela'))).toBe('[2]');
  await page.locator('#s-next').click();
  await expect(page).toHaveURL(/escuela=3/);
  await expect(page.locator('#s-start')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { marca?: number }).marca)).toBe(1);
  expect(log).toEqual([]);
});

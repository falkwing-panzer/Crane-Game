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

/** Espera a la partida montada y a que se hayan dibujado cuadros (la pantalla de carga se quita al primero) */
async function ready(page: Page) {
  await page.waitForFunction(() => performance.getEntriesByName('gruas-partida').length > 0);
  await page.waitForFunction(() => performance.getEntriesByName('gruas-listo').length > 0);
  await expect(page.locator('#boot')).toHaveCount(0);
  // unos cuantos cuadros más
  await page.evaluate(() => new Promise<void>((r) => { let n = 0; const f = () => (++n >= 10 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
}

test('menú: los 14 trabajos y las dos pruebas libres', async ({ page }) => {
  const log = watchConsole(page);
  await page.goto('./');
  await ready(page);
  await expect(page.locator('a.lvl')).toHaveCount(16);
  await expect(page.locator('#lcard h2')).toHaveText('Elige un trabajo');
  expect(log).toEqual([]);
});

test('ir a un nivel desde el menú no recarga la página', async ({ page }) => {
  const log = watchConsole(page);
  await page.goto('./');
  await ready(page);
  await page.evaluate(() => { (window as unknown as { marca: number }).marca = 1; });
  await page.locator('a.lvl').first().click();
  await expect(page).toHaveURL(/nivel=1/);
  await expect(page.locator('#l-start')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { marca?: number }).marca)).toBe(1);
  await page.goBack();
  await expect(page.locator('a.lvl')).toHaveCount(16);
  expect(log).toEqual([]);
});

for (const n of LEVELS) {
  test(`nivel ${n}: ficha, turno y consola limpia`, async ({ page }) => {
    const log = watchConsole(page);
    await page.goto(`./?nivel=${n}`);
    await ready(page);
    const start = page.locator('#l-start');
    await expect(start).toBeVisible();
    await start.click();
    await expect(page.locator('#overlay')).toBeHidden();
    await expect(page.locator('#clock')).toBeVisible();
    await expect(page.locator('#data')).toContainText('LMI');
    // el reloj corre (con WebGL por software, despacio: el bucle da como mucho 4 pasos por cuadro)
    const t0 = await page.locator('#clock > b').textContent();
    await expect(page.locator('#clock > b')).not.toHaveText(t0!, { timeout: 30_000 });
    expect(log).toEqual([]);
  });
}

for (const id of CRANES) {
  test(`prueba libre ${id}: dibuja y responde a las teclas`, async ({ page }) => {
    const log = watchConsole(page);
    await page.goto(`./?grua=${id}`);
    await ready(page);
    await expect(page.locator('#data')).toContainText('LMI');
    // R sube el gancho: el largo del cable cambia (la SK 60 sin montar no mueve nada: avisa). No F: el gancho de las
    // orugas empieza cerca del suelo y el cable no se alarga más allá (falló así en la acción con la LR 3000)
    const cable = async () => /Cable ([\d,]+) m/.exec(await page.locator('#data').innerText())?.[1];
    const before = await cable();
    expect(before).toBeTruthy();
    await page.keyboard.down('KeyR');
    await page.waitForTimeout(800);
    await page.keyboard.up('KeyR');
    if (id === 'sk') await expect(page.locator('#msg')).toContainText('Monta la grúa torre primero (M)');
    else await expect.poll(cable).not.toBe(before);
    expect(log).toEqual([]);
  });
}

test('prueba libre en tándem: dos grúas y Tab cambia de grúa', async ({ page }) => {
  const log = watchConsole(page);
  await page.goto('./?tandem=1');
  await ready(page);
  await expect(page.locator('#other')).toBeVisible();
  const title = await page.locator('#data .title').innerText();
  await page.keyboard.press('Tab');
  await expect(page.locator('#data .title')).not.toHaveText(title);
  expect(log).toEqual([]);
});

test('teclas configurables: se cambian en la ayuda, se guardan y la grúa las obedece', async ({ page }) => {
  const log = watchConsole(page);
  await page.goto('./?grua=medium');
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

test('pausa al perder el foco: no se acumulan pasos de física', async ({ page }) => {
  const log = watchConsole(page);
  await page.goto('./?grua=medium');
  await ready(page);
  await page.evaluate(() => dispatchEvent(new Event('blur')));
  await expect(page.locator('.pause-card')).toBeVisible();
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await expect(page.locator('.pause-card')).toBeHidden();
  expect(log).toEqual([]);
});

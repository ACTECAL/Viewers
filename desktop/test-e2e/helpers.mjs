// Shared by the end-to-end checks: the list of results, and whether the viewer drew the test phantom.

export function checker() {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(Boolean(ok));
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  return { check, results };
}

export const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
export const studiesInUrl = (page) => new URL(page.url()).searchParams.getAll('StudyInstanceUIDs');

/** The share of the first viewport showing the phantom's water (mid grey at window 40/400), decoded in the page. */
export async function viewportStats(page) {
  const canvas = page.locator('canvas.cornerstone-canvas').first();
  if (!(await canvas.count())) return { grey: 0, views: 0 };
  const png = (await canvas.screenshot()).toString('base64');
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const board = document.createElement('canvas');
    board.width = image.width;
    board.height = image.height;
    const context = board.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, board.width, board.height).data;
    let grey = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 70 && pixels[i] < 140) grey += 1;
    return { grey: Math.round((grey / (pixels.length / 4)) * 100) / 100, views: document.querySelectorAll('canvas.cornerstone-canvas').length };
  }, png);
}

/** Waits for the viewer route and for the phantom to be drawn; returns viewportStats. */
export async function waitForImage(page, { timeout = 60000 } = {}) {
  await page.waitForURL(/\/viewer\/dicomlocal\?/, { timeout });
  await page.locator('canvas.cornerstone-canvas').first().waitFor({ timeout });
  let stats = { grey: 0 };
  for (let i = 0; i < 40 && stats.grey < 0.1; i += 1) {
    await page.waitForTimeout(750);
    stats = await viewportStats(page);
  }
  return stats;
}

/** Console errors, page errors and requests that left the app (or `origin`), recorded from now on. */
export function watch(page, isOwn) {
  const session = { errors: [], outside: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') session.errors.push(message.text().slice(0, 240));
  });
  page.on('pageerror', (error) => session.errors.push(`pageerror: ${String(error.message).slice(0, 240)}`));
  page.on('request', (request) => {
    const url = request.url();
    if (!/^(blob|data):/.test(url) && !isOwn(url)) session.outside.push(url);
  });
  session.clean = () => !session.errors.length && !session.outside.length;
  session.problems = () => [...session.errors, ...session.outside.map((url) => `outside: ${url}`)].slice(0, 3).join(' | ');
  return session;
}

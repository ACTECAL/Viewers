// The web edition, which shares the home page and loaders with Spectra Desktop: the build in app/viewer served
// at "/" with the app's Content-Security-Policy and the CloudFront rewrite rule, in Chrome (CHROME_PATH or the
// usual install). These are the checks that were run by hand on the standalone edition (TASK_PLAN 3).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { sameSet, studiesInUrl, viewportStats, waitForImage, watch } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { CSP, contentType, resolveViewerPath } = require('../src/main/protocol.js');
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((file) => file && fs.existsSync(file));

function serve(root) {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const file = resolveViewerPath(root, new URL(request.url, 'http://local').pathname);
      if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('Not found');
        return;
      }
      response.writeHead(200, { 'content-type': contentType(file), 'content-security-policy': CSP, 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(response);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

export default async function webChecks({ check, data, viewerDir }) {
  if (!CHROME) {
    console.log('SKIP the web edition: Chrome was not found (set CHROME_PATH).');
    return;
  }
  const server = await serve(viewerDir);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const isOwn = (url) => url.startsWith(`${origin}/`);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--enable-unsafe-swiftshader'] });
  const open = async (options = {}) => {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, ...options });
    const page = await context.newPage();
    const session = watch(page, isOwn);
    await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
    return { context, page, session };
  };
  const pick = (page, files) => page.setInputFiles('#offline-open-files', files);
  try {
    {
      const { context, page, session } = await open();
      const heading = await page.locator('h1').innerText();
      check('Web: title and heading', (await page.title()) === 'Free DICOM viewer · Actecal Spectra' && heading === 'Free DICOM viewer');
      const links = await page.$$eval('a', (anchors) => anchors.map((a) => [a.textContent.trim(), a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')]));
      const demo = links.find(([label]) => label.startsWith('Book a demo'));
      check('Web: "Book a demo" opens the contact form in a new tab', demo && demo[1].startsWith('https://actecal.com/contact?interest=spectra') && demo[2] === '_blank' && /noopener/.test(demo[3] || ''));
      check('Web: nothing links to self-service onboarding', !links.some(([label, href]) => /erp\.actecal\.com/.test(href || '') || label.startsWith('Get started')));
      check('Web: no desktop buttons in the browser', !(await page.getByRole('button', { name: 'Open a CD, DVD or USB drive' }).count()) && (await page.locator('#offline-open-files').count()) === 1);
      await pick(page, [data.notes]);
      const notDicom = await page.getByRole('alert').filter({ hasText: '1 file was not DICOM images and was skipped' }).waitFor({ timeout: 20000 }).then(() => true, () => false);
      check('Web: a text file is refused with a reason', notDicom);
      await pick(page, [data.zips.encrypted]);
      check('Web: a password-protected ZIP is refused with a reason', await page.getByRole('alert').filter({ hasText: 'Password-protected ZIP entries were skipped' }).waitFor({ timeout: 20000 }).then(() => true, () => false));
      check('Web: home page without errors or outside requests', session.clean(), session.problems());
      await context.close();
    }
    {
      const { context, page, session } = await open();
      await pick(page, data.ct.files.map((entry) => entry.file));
      const stats = await waitForImage(page);
      check('Web: 24 slices open and render', stats.grey >= 0.1 && sameSet(studiesInUrl(page), [data.ct.studyUID]), `grey ${stats.grey}`);
      const body = await page.locator('body').innerText();
      check('Web: the series is listed, with no placeholder doctor name', body.includes('Axial 5 mm') && !body.includes('DR BHARAT GUPTA'));
      await page.click('[data-cy="SpectraPremiumAI"]');
      const dialog = await page.getByText('AI analysis is part of Actecal Spectra').waitFor({ timeout: 10000 }).then(() => true, () => false);
      const dialogLinks = await page.$$eval('[role="dialog"] a[href^="https://"]', (anchors) => anchors.map((a) => [a.textContent.trim(), a.getAttribute('target')]));
      check('Web: a locked button opens the Spectra dialog with one "Book a demo" link', dialog && dialogLinks.length === 1 && dialogLinks[0][0].startsWith('Book a demo') && dialogLinks[0][1] === '_blank', JSON.stringify(dialogLinks));
      await page.getByRole('button', { name: 'Not now' }).click();
      await page.click('[data-cy="MPR"]');
      let views = 0;
      for (let i = 0; i < 40 && views < 3; i += 1) {
        await page.waitForTimeout(750);
        views = await page.locator('canvas.cornerstone-canvas').count();
      }
      const mpr = await viewportStats(page);
      check('Web: MPR builds the volume and shows three views', views >= 3 && mpr.grey > 0.02, `${views} views, grey ${mpr.grey}`);
      check('Web: viewer without errors or outside requests', session.clean(), session.problems());
      await page.reload({ waitUntil: 'networkidle' });
      check('Web: a reload lands on the "study cleared" notice', await page.getByText('The study was cleared when the page reloaded').waitFor({ timeout: 20000 }).then(() => new URL(page.url()).pathname === '/notfoundstudy', () => false));
      await page.goto(`${origin}/no-such-page`, { waitUntil: 'networkidle' });
      check('Web: an unknown address shows the home page with a notice', await page.getByText('That page does not exist').waitFor({ timeout: 20000 }).then(() => true, () => false));
      await context.close();
    }
    for (const kind of ['stored', 'deflate', 'zip64']) {
      const { context, page, session } = await open();
      await pick(page, [data.zips[kind]]);
      const stats = await waitForImage(page).catch(() => ({ grey: 0 }));
      check(`Web: ZIP (${kind}) opens and renders`, stats.grey >= 0.1 && session.clean(), `grey ${stats.grey} ${session.problems()}`);
      await context.close();
    }
    {
      const { context, page, session } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check('Web, phone: no sideways scrolling on the home page', sideways <= 0, `${sideways}px`);
      await pick(page, [data.zips.deflate]);
      const stats = await waitForImage(page);
      check('Web, phone: the viewer renders without the Actecal mobile menu', stats.grey >= 0.1 && !(await page.locator('.mobile-nav-bar').count()), `grey ${stats.grey}`);
      check('Web, phone: no errors or outside requests', session.clean(), session.problems());
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

import { chromium, type Browser } from "playwright-core";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Drive Playwright to print the deck's /print view to a PDF.
 *
 * Strategy: navigate to `${baseUrl}/print`, where the web app renders every slide
 * stacked with `page-break-after: always` and a `<style>@page { size: w h; }`
 * matching `deck.size`. Playwright's `page.pdf` with `preferCSSPageSize: true`
 * then produces one slide per page at exact dimensions.
 */
export async function exportDeckPdf(opts: {
  baseUrl: string;
  deckSize: { w: number; h: number };
}): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(`${opts.baseUrl}/print`, { waitUntil: "networkidle" });
    await waitForAssets(page);

    const pdf = await page.pdf({
      width: `${opts.deckSize.w}px`,
      height: `${opts.deckSize.h}px`,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

/**
 * Render a single slide (by id) to a PNG buffer.
 * Drives Playwright through `/print?slide=<id>` and screenshots the slide div.
 */
export async function renderSlidePng(opts: {
  baseUrl: string;
  deckSize: { w: number; h: number };
  slideId: string;
}): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: opts.deckSize.w, height: opts.deckSize.h },
      deviceScaleFactor: 2,
    });
    await page.goto(
      `${opts.baseUrl}/print?slide=${encodeURIComponent(opts.slideId)}`,
      { waitUntil: "networkidle" }
    );
    await waitForAssets(page);

    const png = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: opts.deckSize.w, height: opts.deckSize.h },
      omitBackground: false,
    });
    return png;
  } finally {
    await browser.close();
  }
}

async function waitForAssets(page: import("playwright-core").Page) {
  // PrintView signals readiness on a wrapper div once fonts + Konva paint settle.
  await page.waitForSelector('[data-print-ready="1"]', { timeout: 10000 });
  await page.evaluate(async () => {
    const fonts = (document as any).fonts;
    if (fonts && typeof fonts.ready?.then === "function") {
      await fonts.ready;
    }
    const imgs = Array.from(document.images);
    await Promise.all(
      imgs.map((img) =>
        img.complete ? Promise.resolve() : new Promise<void>((r) => {
          img.addEventListener("load", () => r());
          img.addEventListener("error", () => r());
        })
      )
    );
    // Two paint frames so Konva text remeasures with loaded fonts and redraws.
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
}

async function launchBrowser(): Promise<Browser> {
  // Order: explicit env override → playwright's expected version → any version in
  // the playwright cache → common system locations.
  const candidates = [
    process.env.MINERVA_CHROMIUM,
    ...discoverPlaywrightChromium(),
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean) as string[];

  let firstError: unknown;
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    firstError = err;
  }
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        return await chromium.launch({ headless: true, executablePath: path });
      } catch { /* keep trying */ }
    }
  }
  throw new Error(
    "Chromium not found. Install via:\n  npx playwright install chromium\nor set MINERVA_CHROMIUM=/path/to/chrome.\n\nOriginal error: " + (firstError as Error).message
  );
}

/** Find any chrome/headless_shell binaries in the Playwright cache, newest revision first. */
function discoverPlaywrightChromium(): string[] {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(root)) return [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const matches = entries
    .filter((e) => e.startsWith("chromium-") || e.startsWith("chromium_headless_shell-") || e.startsWith("chromium-headless-shell-"))
    .map((e) => {
      const m = e.match(/(\d+)/);
      return { name: e, rev: m ? parseInt(m[1], 10) : 0 };
    })
    .sort((a, b) => b.rev - a.rev);
  const paths: string[] = [];
  for (const { name } of matches) {
    paths.push(join(root, name, "chrome-linux", "chrome"));
    paths.push(join(root, name, "chrome-linux", "headless_shell"));
  }
  return paths;
}

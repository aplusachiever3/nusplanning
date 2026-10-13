import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
let server;
let browser;
let origin;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

before(async () => {
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const requested = resolve(root, "." + pathname);
      if (requested !== root && !requested.startsWith(root + sep)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      const path = pathname === "/" ? resolve(root, "index.html") : requested;
      const body = await readFile(path);
      res.writeHead(200, { "content-type": mime[extname(path)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await new Promise(resolveClose => server?.close(resolveClose));
});

async function openCleanPage() {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(origin);
  await page.locator("#smartReviewPanel").waitFor();
  return { context, page };
}

async function fillFirstEntry(page, title = "Community science project") {
  await page.locator("#title-0").fill(title);
  await page.locator("#category-0").selectOption("Community Involvement");
  await page.locator("#start-0").fill("01/25");
  await page.locator("#end-0").fill("06/25");
  await page.locator("#description-0").fill("I designed a water-filter prototype and tested three designs.");
  await page.locator("#organisation-0").fill("School community project");
}

test("BR-001 review runs, persists after reload, and does not rewrite planner fields", async () => {
  const { context, page } = await openCleanPage();
  try {
    await fillFirstEntry(page);
    const beforeText = await page.locator("#description-0").inputValue();
    await page.locator("#srRun").click();
    await page.getByText("Review saved for 1 non-empty entry.").waitFor();
    const records = await page.evaluate(() => JSON.parse(localStorage.getItem("nusmedicine-smart-review-history-v1") || "[]"));
    assert.equal(records.length, 1);
    assert.equal(records[0].inputSnapshot.description, beforeText);
    assert.ok(records[0].rubricVersion && records[0].ruleSetVersion && records[0].engineVersion);
    await page.reload();
    await page.locator("#smartReviewPanel").waitFor();
    await page.getByText(/Achievement 1: Community science project/).waitFor();
    assert.equal(await page.locator("#description-0").inputValue(), beforeText);
  } finally {
    await context.close();
  }
});

test("BR-002 editing content marks the previous review stale; rerun links review history", async () => {
  const { context, page } = await openCleanPage();
  try {
    await fillFirstEntry(page);
    await page.locator("#srRun").click();
    await page.getByText("Review saved for 1 non-empty entry.").waitFor();
    const firstId = await page.evaluate(() => JSON.parse(localStorage.getItem("nusmedicine-smart-review-history-v1"))[0].reviewId);
    await page.locator("#description-0").fill("I designed and tested three water-filter prototypes for our school project.");
    await page.getByText("Content changed since this review").waitFor();
    const staleRecord = await page.evaluate(() => JSON.parse(localStorage.getItem("nusmedicine-smart-review-history-v1"))[0]);
    assert.equal(staleRecord.stale, true);
    const originalSnapshot = staleRecord.inputSnapshot.description;
    await page.locator("#srRun").click();
    await page.getByText("Review saved for 1 non-empty entry.").waitFor();
    const records = await page.evaluate(() => JSON.parse(localStorage.getItem("nusmedicine-smart-review-history-v1")));
    assert.equal(records.length, 2);
    assert.equal(records[0].inputSnapshot.description, originalSnapshot);
    assert.equal(records[1].previousReviewId, firstId);
    assert.equal(records[1].stale, false);
  } finally {
    await context.close();
  }
});

test("BR-003 uploaded attachment is stored in IndexedDB and linked as metadata", async () => {
  const { context, page } = await openCleanPage();
  try {
    await fillFirstEntry(page);
    await page.locator("#files-0").setInputFiles({
      name: "project-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Sample project notes for browser acceptance.")
    });
    await page.getByText("project-notes.txt").waitFor();
    await page.waitForFunction(() => {
      const planner = JSON.parse(localStorage.getItem("nusmedicine-top10-v1") || "{}");
      return planner.data?.[0]?.attachments?.some(file => file.name === "project-notes.txt");
    });
    const attachment = await page.evaluate(() => JSON.parse(localStorage.getItem("nusmedicine-top10-v1")).data[0].attachments[0]);
    const blobCheck = await page.evaluate(async id => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("nusmedicine-planner-files", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return await new Promise((resolve, reject) => {
        const request = db.transaction("attachments", "readonly").objectStore("attachments").get(id);
        request.onsuccess = () => resolve({ found: !!request.result, isBlob: request.result?.blob instanceof Blob });
        request.onerror = () => reject(request.error);
      });
    }, attachment.id);
    assert.deepEqual(blobCheck, { found: true, isBlob: true });
    await page.locator("#srRun").click();
    await page.getByText("Review saved for 1 non-empty entry.").waitFor();
    const record = await page.evaluate(() => JSON.parse(localStorage.getItem("nusmedicine-smart-review-history-v1"))[0]);
    assert.equal(record.inputSnapshot.attachments[0].name, "project-notes.txt");
    assert.notEqual(record.authenticityVerified, true);
  } finally {
    await context.close();
  }
});

test("BR-004 CSV and JSON backup downloads still work with Smart Review installed", async () => {
  const { context, page } = await openCleanPage();
  try {
    await fillFirstEntry(page, "CSV Acceptance Entry");
    const csvWait = page.waitForEvent("download");
    await page.locator("#csv").click();
    const csv = await csvWait;
    const csvStream = await csv.createReadStream();
    let csvText = "";
    for await (const chunk of csvStream) csvText += chunk.toString("utf8");
    assert.match(csvText, /title,category,start,end,description/);
    assert.match(csvText, /CSV Acceptance Entry/);

    const backupWait = page.waitForEvent("download");
    await page.locator("#export").click();
    const backup = await backupWait;
    const backupStream = await backup.createReadStream();
    let backupText = "";
    for await (const chunk of backupStream) backupText += chunk.toString("utf8");
    const parsed = JSON.parse(backupText);
    assert.equal(parsed.data[0].title, "CSV Acceptance Entry");
    assert.ok(Array.isArray(parsed.data));
    assert.equal(Object.hasOwn(parsed, "smartReviewHistory"), false);
  } finally {
    await context.close();
  }
});

test("BR-005 print media hides Smart Review and empty achievement cards", async () => {
  const { context, page } = await openCleanPage();
  try {
    await fillFirstEntry(page, "Print Acceptance Entry");
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    await page.emulateMedia({ media: "print" });
    const panelDisplay = await page.locator("#smartReviewPanel").evaluate(el => getComputedStyle(el).display);
    assert.equal(panelDisplay, "none");
    assert.equal(await page.locator('.item[data-print-empty="false"]').count(), 1);
    assert.equal(await page.locator('.item[data-print-empty="true"]').count(), 9);
    const emptyTitleDisplay = await page.locator('.field[data-print-empty="true"]').first().evaluate(el => getComputedStyle(el).display);
    assert.equal(emptyTitleDisplay, "none");
  } finally {
    await context.close();
  }
});

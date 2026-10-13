import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";

const browserName = process.env.BROWSER || "chromium";
const browserTypes = { chromium, firefox, webkit };
if (!browserTypes[browserName]) throw new Error(`Unsupported BROWSER=${browserName}`);

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
  browser = await browserTypes[browserName].launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await new Promise(resolveClose => server?.close(resolveClose));
});

async function openCleanPage(seed = null, viewport = null) {
  const context = await browser.newContext({ acceptDownloads: true, ...(viewport ? { viewport } : {}) });
  if (seed) await context.addInitScript(({ planner, history }) => {
    localStorage.setItem("nusmedicine-top10-v1", JSON.stringify(planner));
    if (history !== undefined) localStorage.setItem("nusmedicine-smart-review-history-v1", JSON.stringify(history));
  }, seed);
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
    const uploadDiagnostics = { dialogs: [], pageErrors: [] };
    page.on("dialog", async dialog => {
      uploadDiagnostics.dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    page.on("pageerror", error => uploadDiagnostics.pageErrors.push(error.message));
    await page.locator("#files-0").setInputFiles({
      name: "project-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Sample project notes for browser acceptance.")
    });
    await page.waitForFunction(() => {
      const planner = JSON.parse(localStorage.getItem("nusmedicine-top10-v1") || "{}");
      return planner.data?.[0]?.attachments?.some(file => file.name === "project-notes.txt");
    }, null, { timeout: 5000 }).catch(() => {});
    const uploadState = await page.evaluate(() => ({
      attachments: JSON.parse(localStorage.getItem("nusmedicine-top10-v1") || "{}").data?.[0]?.attachments || [],
      fileListText: document.querySelector("#file-list-0")?.innerText || ""
    }));
    assert.ok(uploadState.attachments.some(file => file.name === "project-notes.txt"),
      `Attachment upload failed in ${browserName}: state=${JSON.stringify(uploadState)}, dialogs=${JSON.stringify(uploadDiagnostics.dialogs)}, pageErrors=${JSON.stringify(uploadDiagnostics.pageErrors)}`);
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
    assert.equal(await page.locator("#description-0 + .print-value").count(), 1);
    assert.equal(await page.locator("#description-0").evaluate(el => getComputedStyle(el).display), "none");
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
  } finally {
    await context.close();
  }
});


test("BR-006 removing an attachment marks the prior review stale without deleting the review", async () => {
  const { context, page } = await openCleanPage();
  try {
    await fillFirstEntry(page);
    await page.locator("#files-0").setInputFiles({
      name: "remove-me.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Attachment removal regression check.")
    });
    await page.getByText("remove-me.txt").waitFor();
    await page.locator("#srRun").click();
    await page.getByText("Review saved for 1 non-empty entry.").waitFor();
    const oldRecord = await page.evaluate(() => JSON.parse(localStorage.getItem("nusmedicine-smart-review-history-v1"))[0]);
    await page.getByRole("button", { name: "Remove remove-me.txt" }).click();
    await page.locator("#file-list-0").getByText("No files attached yet.").waitFor();
    await page.getByText("Content changed since this review").waitFor();
    const history = await page.evaluate(() => JSON.parse(localStorage.getItem("nusmedicine-smart-review-history-v1")));
    assert.equal(history.length, 1);
    assert.equal(history[0].reviewId, oldRecord.reviewId);
    assert.equal(history[0].stale, true);
    assert.equal(history[0].inputSnapshot.attachments[0].name, "remove-me.txt");
    const currentAttachments = await page.evaluate(() => JSON.parse(localStorage.getItem("nusmedicine-top10-v1")).data[0].attachments);
    assert.equal(currentAttachments.length, 0);
  } finally {
    await context.close();
  }
});

test("BR-007 clearing planner entries preserves review history and marks it stale", async () => {
  const { context, page } = await openCleanPage();
  try {
    await fillFirstEntry(page, "Reset Regression Entry");
    await page.locator("#srRun").click();
    await page.getByText("Review saved for 1 non-empty entry.").waitFor();
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem("nusmedicine-smart-review-history-v1"))[0]);
    page.once("dialog", dialog => dialog.accept());
    await page.locator("#reset").click();
    await page.getByText("Content changed since this review").waitFor();
    const planner = await page.evaluate(() => JSON.parse(localStorage.getItem("nusmedicine-top10-v1")));
    const history = await page.evaluate(() => JSON.parse(localStorage.getItem("nusmedicine-smart-review-history-v1")));
    assert.equal(planner.data.length, 10);
    assert.equal(planner.data[0].title, "");
    assert.equal(history.length, 1);
    assert.equal(history[0].reviewId, before.reviewId);
    assert.equal(history[0].inputSnapshot.title, "Reset Regression Entry");
    assert.equal(history[0].stale, true);
    assert.equal(await page.locator("#smartReviewPanel").count(), 1);
    assert.equal(await page.locator("#srRun").count(), 1);
  } finally {
    await context.close();
  }
});

test("BR-008 existing legacy planner data and checklist survive Smart Review initialization", async () => {
  const legacyEntry = {
    title: "Legacy saved achievement",
    category: "Research",
    start: "02/24",
    end: "11/24",
    description: "Original description remains untouched.",
    award: "School award",
    appointment: "Research assistant",
    organisation: "School laboratory",
    participationLevel: "School / Class",
    evidence: "Original evidence note",
    attachments: [],
    ready: true,
    legacyCustomField: "preserve existing data"
  };
  const { context, page } = await openCleanPage({
    planner: { data: [legacyEntry], checks: { dates: true, proof: false }, updatedAt: "2026-01-01T00:00:00.000Z" }
  });
  try {
    assert.equal(await page.locator("#title-0").inputValue(), legacyEntry.title);
    assert.equal(await page.locator("#description-0").inputValue(), legacyEntry.description);
    assert.equal(await page.locator("#ready-0").count(), 0); // readiness is represented by the card checkbox
    assert.equal(await page.locator('.item input[data-k="ready"]').first().isChecked(), true);
    assert.equal(await page.locator('[data-check="dates"]').isChecked(), true);
    await page.locator("#srRun").click();
    await page.getByText("Review saved for 1 non-empty entry.").waitFor();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("nusmedicine-top10-v1")));
    assert.equal(saved.data[0].title, legacyEntry.title);
    assert.equal(saved.data[0].description, legacyEntry.description);
    assert.equal(saved.data[0].legacyCustomField, "preserve existing data");
    assert.deepEqual(saved.checks, { dates: true, proof: false });
    const reviewHistory = await page.evaluate(() => JSON.parse(localStorage.getItem("nusmedicine-smart-review-history-v1")));
    assert.equal(reviewHistory.length, 1);
    assert.equal(reviewHistory[0].inputSnapshot.title, legacyEntry.title);
  } finally {
    await context.close();
  }
});

test("BR-009 mobile viewport has no horizontal page overflow and one responsive review panel", async () => {
  const { context, page } = await openCleanPage(null, { width: 375, height: 812 });
  try {
    await fillFirstEntry(page, "Mobile Acceptance Entry");
    await page.locator("#srRun").click();
    await page.getByText("Review saved for 1 non-empty entry.").waitFor();
    const layout = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      panels: document.querySelectorAll("#smartReviewPanel").length,
      columns: getComputedStyle(document.querySelector("#smartReviewPanel .sr-dimensions")).gridTemplateColumns
    }));
    assert.equal(layout.panels, 1);
    assert.ok(layout.scrollWidth <= layout.viewportWidth, JSON.stringify(layout));
    assert.ok(!layout.columns.includes(" "), "Expected a single review column on mobile");
  } finally {
    await context.close();
  }
});

test("BR-010 repeated review panel interactions do not duplicate handlers or mutate saved achievement text", async () => {
  const { context, page } = await openCleanPage();
  try {
    await fillFirstEntry(page, "Interaction Regression Entry");
    const original = await page.locator("#description-0").inputValue();
    await page.locator("#srRefresh").click();
    await page.locator("#srRefresh").click();
    await page.locator("#srRun").click();
    await page.getByText("Review saved for 1 non-empty entry.").waitFor();
    let history = await page.evaluate(() => JSON.parse(localStorage.getItem("nusmedicine-smart-review-history-v1")));
    assert.equal(history.length, 1);
    await page.locator("#srRefresh").click();
    await page.locator("#srRun").click();
    await page.getByText("Review saved for 1 non-empty entry.").waitFor();
    history = await page.evaluate(() => JSON.parse(localStorage.getItem("nusmedicine-smart-review-history-v1")));
    assert.equal(history.length, 2);
    assert.equal(history[1].previousReviewId, history[0].reviewId);
    assert.equal(await page.locator("#smartReviewPanel").count(), 1);
    assert.equal(await page.locator("#srRun").count(), 1);
    assert.equal(await page.locator("#description-0").inputValue(), original);
  } finally {
    await context.close();
  }
});


test("BR-011 failed review-history storage write preserves the previous record and reports failure", async () => {
  const { context, page } = await openCleanPage();
  try {
    await fillFirstEntry(page, "Storage Failure Regression Entry");
    await page.locator("#srRun").click();
    await page.getByText("Review saved for 1 non-empty entry.").waitFor();
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem("nusmedicine-smart-review-history-v1"))[0]);
    await page.locator("#description-0").fill("Updated text before simulating a history storage failure.");
    await page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "nusmedicine-smart-review-history-v1" && window.__failReviewWrite) {
          throw new DOMException("Simulated quota failure", "QuotaExceededError");
        }
        return originalSetItem.call(this, key, value);
      };
      window.__failReviewWrite = true;
    });
    await page.locator("#srRun").click();
    await page.getByText(/Could not save the review\. Existing review history was retained\./).waitFor();
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem("nusmedicine-smart-review-history-v1")));
    assert.equal(after.length, 1);
    assert.equal(after[0].reviewId, before.reviewId);
    assert.equal(after[0].inputSnapshot.description, before.inputSnapshot.description);
  } finally {
    await context.close();
  }
});


if (browserName === "chromium") test("BR-012 print-to-PDF produces an inspectable A4 artifact with long-text coverage", async () => {
  const { context, page } = await openCleanPage();
  try {
    await fillFirstEntry(page, "PDF Layout Acceptance Entry");
    const longDescription = Array.from({ length: 18 }, (_, i) => `Project log ${i + 1}: I documented the planning, testing, results, limitations and next steps for this activity. The team compared multiple approaches, recorded observations in a shared log, discussed unexpected results, and revised the process before the next session. This paragraph intentionally tests long-text wrapping and page breaks in the printed portfolio.`).join("\n\n");
    await page.locator("#description-0").fill(longDescription);
    await page.locator("#evidence-0").fill("A concise evidence note for the printed portfolio.");
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    await page.emulateMedia({ media: "print" });
    const panelDisplay = await page.locator("#smartReviewPanel").evaluate(el => getComputedStyle(el).display);
    const emptyCardDisplay = await page.locator('.item[data-print-empty="true"]').first().evaluate(el => getComputedStyle(el).display);
    assert.equal(panelDisplay, "none");
    assert.equal(emptyCardDisplay, "none");
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.ok(pdf.length > 1500, `Unexpectedly small PDF: ${pdf.length} bytes`);
    await mkdir(resolve(root, "artifacts"), { recursive: true });
    await writeFile(resolve(root, "artifacts/smart-review-acceptance.pdf"), pdf);
    await writeFile(resolve(root, "artifacts/smart-review-acceptance-metadata.json"), JSON.stringify({ browser: browserName, viewport: page.viewportSize(), pdfBytes: pdf.length, fixtureCharacters: longDescription.length, format: "A4" }, null, 2));
  } finally {
    await context.close();
  }
});


test("BR-013 reassessing an older rubric version creates a new record and preserves the old one", async () => {
  const entry = {
    title: "Version migration acceptance entry",
    category: "Research",
    start: "01/25",
    end: "06/25",
    description: "I designed a water-filter prototype and tested three designs.",
    award: "",
    appointment: "Project member",
    organisation: "School community project",
    participationLevel: "",
    evidence: "",
    attachments: [],
    ready: false
  };
  const oldSnapshot = {
    title: entry.title,
    category: entry.category,
    start: entry.start,
    end: entry.end,
    description: entry.description,
    award: entry.award,
    appointment: entry.appointment,
    organisation: entry.organisation,
    participationLevel: entry.participationLevel,
    evidence: entry.evidence,
    attachments: []
  };
  const oldRecord = {
    reviewId: "previous-rubric-review",
    achievementId: "entry-1",
    entryIndex: 0,
    contentRevision: "1",
    rubricVersion: "0.9.0",
    ruleSetVersion: "0.9.0",
    engineVersion: "0.9.0",
    reviewedAt: "2025-01-01T00:00:00.000Z",
    inputSnapshot: oldSnapshot,
    status: "partial",
    scores: {},
    totalScore: null,
    suggestions: [],
    previousReviewId: null,
    stale: false
  };
  const { context, page } = await openCleanPage({
    planner: { data: [entry], checks: { dates: true }, updatedAt: "2025-01-01T00:00:00.000Z" },
    history: [oldRecord]
  });
  try {
    await page.locator("#srRun").click();
    await page.getByText("Review saved for 1 non-empty entry.").waitFor();
    const history = await page.evaluate(() => JSON.parse(localStorage.getItem("nusmedicine-smart-review-history-v1")));
    assert.equal(history.length, 2);
    assert.equal(history[0].reviewId, "previous-rubric-review");
    assert.equal(history[0].rubricVersion, "0.9.0");
    assert.equal(history[0].ruleSetVersion, "0.9.0");
    assert.equal(history[0].engineVersion, "0.9.0");
    assert.deepEqual(history[0].inputSnapshot, oldSnapshot);
    assert.equal(history[1].previousReviewId, "previous-rubric-review");
    assert.equal(history[1].rubricVersion, "1.0.0");
    assert.equal(history[1].ruleSetVersion, "1.0.0");
    assert.equal(history[1].engineVersion, "1.0.0");
  } finally {
    await context.close();
  }
});

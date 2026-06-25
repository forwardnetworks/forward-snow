#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function env(name, fallback) {
  return process.env[name] || fallback;
}

function boolEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return /^(1|true|yes)$/i.test(value);
}

function cleanBaseUrl(raw) {
  return String(raw || "").replace(/\/+$/, "");
}

async function maybeLogin(page, portalUrl, username, password) {
  await page.goto(portalUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

  const userInput = page
    .locator('input#user_name, input[name="user_name"], input[name="username"], input[type="email"]')
    .first();
  if (!(await userInput.count())) return;

  await userInput.fill(username);
  await page
    .locator('input#user_password, input[name="user_password"], input[name="password"], input[type="password"]')
    .first()
    .fill(password);

  const submit = page.locator('#sysverb_login, button[type="submit"], input[type="submit"]').first();
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
    submit.click(),
  ]);
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

  if (!page.url().includes("/sp")) {
    await page.goto(portalUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  }
}

async function waitForWidgetReady(page) {
  await page.waitForSelector("text=Forward Workflow Demo for ServiceNow", { timeout: 60000 });
  await page.locator(".fwd-status-card").first().waitFor({ state: "visible", timeout: 60000 });

  const error = await page
    .locator(".alert-danger")
    .first()
    .textContent({ timeout: 1000 })
    .catch(() => "");
  if (String(error || "").trim()) {
    throw new Error(`widget error: ${String(error).trim()}`);
  }

  await page.waitForFunction(
    () => {
      const cards = Array.from(document.querySelectorAll(".fwd-status-card"));
      return cards.some((card) => /Forward networks\s+\d+/i.test(card.innerText)) &&
        cards.some((card) => /ServiceNow CIs\s+\d+/i.test(card.innerText));
    },
    null,
    { timeout: 30000 },
  );
}

async function statusCards(page) {
  return page.$$eval(".fwd-status-card", (cards) =>
    cards.map((card) => card.innerText.replace(/\s+/g, " ").trim()),
  );
}

async function selectNetwork(page, networkId) {
  if (!networkId) return "";
  const select = page.locator("select.form-control").nth(0);
  await select.waitFor({ state: "visible", timeout: 30000 });
  const options = await select.locator("option").evaluateAll((items) =>
    items.map((item) => ({ value: item.value, text: item.textContent || "" })),
  );
  const match = options.find(
    (item) => item.value.includes(networkId) || item.text.includes(networkId),
  );
  if (!match) return "";
  await select.selectOption(match.value);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return match.text.trim();
}

async function selectCiByIp(page, selectIndex, ip) {
  const select = page.locator("select.form-control").nth(selectIndex);
  await select.waitFor({ state: "visible", timeout: 30000 });
  const options = await select.locator("option").evaluateAll((items) =>
    items.map((item) => ({ value: item.value, text: item.textContent || "" })),
  );
  const match = options.find((item) => item.text.includes(ip));
  if (!match) return "";
  await select.selectOption(match.value);
  await page.waitForTimeout(500);
  return match.text.trim();
}

async function fillPathForm(page, srcIp, dstIp) {
  await page.locator('input[placeholder="10.0.0.10"]').fill(srcIp);
  await page.locator('input[placeholder="10.0.0.20"]').fill(dstIp);
}

async function analyzePath(page) {
  await page.getByRole("button", { name: /Analyze in Forward/i }).click();
  await page.waitForFunction(
    () => {
      const err = document.querySelector(".alert-danger");
      const verdict = document.querySelector(".fwd-verdict");
      return (err && err.innerText.trim()) || (verdict && verdict.innerText.trim());
    },
    null,
    { timeout: 120000 },
  );

  const error = await page
    .locator(".alert-danger")
    .first()
    .textContent({ timeout: 1000 })
    .catch(() => "");
  if (String(error || "").trim()) {
    throw new Error(`analysis error: ${String(error).trim()}`);
  }

  const verdict = await page.locator(".fwd-verdict").first().innerText();
  if (/ANALYSIS FAILED/i.test(verdict)) {
    const reason = await page.locator(".fwd-evidence-body").first().innerText().catch(() => "");
    throw new Error(`analysis failed: ${reason || verdict}`);
  }
  return verdict.trim();
}

async function createTicket(page) {
  const button = page.getByRole("button", { name: /Create workflow ticket/i });
  await button.waitFor({ state: "visible", timeout: 30000 });
  if (await button.isDisabled()) return "";
  await button.click();
  await page.waitForFunction(
    () => /Workflow ticket\s+\S+/i.test(document.body.innerText),
    null,
    { timeout: 60000 },
  );
  const text = await page.locator(".fwd-artifacts").innerText();
  const match = text.match(/Workflow ticket\s+(\S+)/i);
  return match ? match[1] : text.trim();
}

async function createIncident(page) {
  const button = page.getByRole("button", { name: /^Create incident$/i });
  await button.waitFor({ state: "visible", timeout: 30000 });
  if (await button.isDisabled()) return "";
  await button.click();
  await page.waitForFunction(
    () => {
      const artifacts = document.querySelector(".fwd-artifacts");
      return artifacts && /(^|\n)\s*Incident\s+\S+/i.test(artifacts.innerText || "");
    },
    null,
    { timeout: 60000 },
  );
  const text = await page.locator(".fwd-artifacts").innerText();
  const match = text.match(/(^|\n)\s*Incident\s+(\S+)/i);
  return match ? match[2] : text.trim();
}

async function validateChange(page, changeNumber, expectedOutcome) {
  if (!changeNumber) return { number: "", status: "" };
  await page.locator('input[placeholder="CHG0030001"]').fill(changeNumber);
  await page.locator("select.form-control").last().selectOption(expectedOutcome || "blocked");
  await page.getByRole("button", { name: /Validate change/i }).click();
  await page.waitForFunction(
    () => /Change validation\s+\S+/i.test(document.body.innerText),
    null,
    { timeout: 60000 },
  );
  const text = await page.locator(".fwd-artifacts").innerText();
  const match = text.match(/Change validation\s+(\S+)\s+(\S+)/i);
  return match ? { number: match[1], status: match[2] } : { number: text.trim(), status: "" };
}

async function main() {
  const instanceUrl = cleanBaseUrl(required("SN_INSTANCE_URL"));
  const username = required("SN_USERNAME");
  const password = required("SN_PASSWORD");
  const networkId = env("NETWORK_ID", "235937");
  const sourceIp = env("SN_VERIFY_SRC_IP", "192.168.100.57");
  const destinationIp = env("SN_VERIFY_DST_IP", "203.0.113.10");
  const changeNumber = env("SN_VERIFY_CHANGE_NUMBER", "");
  const expectedOutcome = env("SN_VERIFY_EXPECTED_OUTCOME", "blocked");
  const headless = boolEnv("SN_HEADLESS", true);
  const portalUrl = `${instanceUrl}/sp?id=connectivity_ticket`;
  const outputDir = path.resolve(__dirname, "..", "output", "playwright");
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({
    channel: env("SN_PLAYWRIGHT_CHANNEL", "chrome"),
    headless,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const result = {
    portalUrl,
    networkId,
    sourceIp,
    destinationIp,
    statusCards: [],
    selectedNetwork: "",
    selectedSourceCi: "",
    verdict: "",
    ticketNumber: "",
    incidentNumber: "",
    validationNumber: "",
    validationStatus: "",
    screenshot: "",
  };

  try {
    await maybeLogin(page, portalUrl, username, password);
    await waitForWidgetReady(page);
    result.statusCards = await statusCards(page);
    result.selectedNetwork = await selectNetwork(page, networkId);
    result.selectedSourceCi = await selectCiByIp(page, 2, sourceIp);
    await fillPathForm(page, sourceIp, destinationIp);
    result.verdict = await analyzePath(page);
    result.ticketNumber = await createTicket(page);
    if (!result.ticketNumber) {
      throw new Error(`expected blocked path to enable workflow ticket, got verdict ${result.verdict}`);
    }
    result.incidentNumber = await createIncident(page);
    if (!result.incidentNumber) {
      throw new Error("expected incident creation to produce an incident number");
    }
    const validation = await validateChange(page, changeNumber, expectedOutcome);
    result.validationNumber = validation.number;
    result.validationStatus = validation.status;
    if (changeNumber && result.validationStatus && !/^pass$/i.test(result.validationStatus)) {
      throw new Error(`expected change validation to pass, got ${result.validationStatus}`);
    }

    result.screenshot = path.join(outputDir, "servicenow-demo-verified.png");
    await page.screenshot({ path: result.screenshot, fullPage: true });
    fs.writeFileSync(
      path.join(outputDir, "servicenow-demo-result.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    const failedScreenshot = path.join(outputDir, "servicenow-demo-failed.png");
    const failedHtml = path.join(outputDir, "servicenow-demo-failed.html");
    await page.screenshot({ path: failedScreenshot, fullPage: true }).catch(() => {});
    fs.writeFileSync(failedHtml, await page.content().catch(() => ""));
    result.screenshot = failedScreenshot;
    fs.writeFileSync(
      path.join(outputDir, "servicenow-demo-result.json"),
      JSON.stringify({ ...result, error: err && err.message ? err.message : String(err) }, null, 2),
    );
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

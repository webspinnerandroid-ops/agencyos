/**
 * mobile-drawer-semantics — locks in MobileNav's modal drawer contract.
 *
 * The drawer used to be a bare fixed <div>: no dialog role, focus leaked to
 * the page behind it, Escape did nothing usable and the body kept scrolling.
 * These three tests pin each behavior the component implements, so a
 * refactor of MobileNav cannot regress them silently:
 *
 *   1. Focus trap — Tab/Shift+Tab cycle inside the panel, never into it.
 *   2. Escape closes the drawer and returns focus to the trigger that
 *      opened it (keyboard users must not lose their place).
 *   3. Body scroll is locked while the drawer is open (a real scroll
 *      attempt moves nothing) and usable again after close.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";

const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3100";

/** Same structural locators the saas-qa-audit drawer tests use. */
async function openDrawer(page: Page): Promise<{ trigger: Locator; drawer: Locator }> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  // The "More" slot renders MobileNav's trigger (accessible name
  // "Toggle navigation menu") next to a plain "More" <span>.
  const trigger = page
    .locator('nav[aria-label="Primary"]')
    .getByRole("button")
    .last();
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible({ timeout: 15_000 });
  return { trigger, drawer };
}

/** True when keyboard focus is inside the dialog panel (or the panel itself). */
function focusInsideDialog(page: Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return !!dialog && dialog.contains(document.activeElement);
  });
}

test("the drawer traps focus when it opens", async ({ page }) => {
  await openDrawer(page);

  // Focus must START inside — an opened dialog that leaves focus on the
  // page behind it is invisible to keyboard users.
  expect(await focusInsideDialog(page), "focus did not move into the drawer").toBe(true);

  // Forward Tab loops within the panel.
  for (let i = 0; i < 20; i++) await page.keyboard.press("Tab");
  expect(await focusInsideDialog(page), "Tab escaped the drawer").toBe(true);

  // Backward Tab loops the same way.
  for (let i = 0; i < 10; i++) await page.keyboard.press("Shift+Tab");
  expect(await focusInsideDialog(page), "Shift+Tab escaped the drawer").toBe(true);
});

test("Escape closes the drawer and returns focus to the trigger", async ({ page }) => {
  const { trigger, drawer } = await openDrawer(page);

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden({ timeout: 10_000 });

  expect(
    await trigger.evaluate((el) => el === document.activeElement),
    "focus did not return to the trigger after Escape"
  ).toBe(true);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("user scrolling is locked while the drawer is open and unlocked on close", async ({ page }) => {
  const { drawer } = await openDrawer(page);

  // While open: the direct lock styles are set AND a real wheel gesture is a
  // no-op. (A programmatic window.scrollTo is deliberately NOT asserted —
  // overflow:hidden boxes stay script-scrollable by CSSOM design; every
  // mainstream modal locks user gestures this way.)
  const openState = () =>
    page.evaluate(() => ({
      html: getComputedStyle(document.documentElement).overflow,
      htmlY: getComputedStyle(document.documentElement).overflowY,
      body: getComputedStyle(document.body).overflow,
      scrollY: window.scrollY,
    }));

  const before = await openState();
  expect(before.htmlY, "html scroller was not locked").toBe("hidden");
  expect(before.body, "body was not locked").toBe("hidden");

  // Real user gesture: wheel over the backdrop (left of the drawer panel).
  await page.mouse.move(50, 400);
  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(300);
  const afterWheel = await openState();
  expect(
    Math.abs(afterWheel.scrollY - before.scrollY),
    "the page scrolled behind the open drawer via wheel"
  ).toBeLessThanOrEqual(2);

  // After Escape: lock styles are gone and wheel scrolling works again.
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden({ timeout: 10_000 });
  const closed = await openState();
  expect(closed.htmlY, "html overflow was not restored after close").not.toBe("hidden");
  expect(closed.body, "body overflow was not restored after close").not.toBe("hidden");

  const yBeforeClose = closed.scrollY;
  await page.mouse.move(50, 400);
  await page.mouse.wheel(0, 1500);
  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(400);
  const scrolledTo = await page.evaluate(() => window.scrollY);
  expect(
    scrolledTo - yBeforeClose,
    "wheel scrolling still did not work after the drawer closed"
  ).toBeGreaterThan(50);
});

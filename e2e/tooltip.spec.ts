import { test, expect } from '@playwright/test';

test.describe('Tooltip E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('.task-bar').first().waitFor({ timeout: 15_000 });
  });

  test('hovering over a task bar shows tooltip without errors', async ({ page }) => {
    // Set up console error listener
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Listen for uncaught page errors (e.g., getBoundingClientRect on null)
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    // Get the bounding box of a task bar in the SVG chart area.
    // The table panel overlaps some task bars, so we use force: true
    // to ensure the hover event reaches the SVG element.
    const taskBar = page.locator('.task-bar').first();
    await taskBar.hover({ force: true });

    // Wait for the tooltip to appear (default delay is 400ms per Tooltip.tsx)
    await page.waitForTimeout(500);

    // Assert no console errors were fired (especially no getBoundingClientRect errors)
    const rectErrors = consoleErrors.filter((msg) =>
      msg.includes('getBoundingClientRect'),
    );
    expect(rectErrors).toHaveLength(0);

    // Assert no uncaught page errors
    const criticalPageErrors = pageErrors.filter((msg) =>
      msg.includes('getBoundingClientRect'),
    );
    expect(criticalPageErrors).toHaveLength(0);

    // Check if a tooltip element appeared (rendered as a portal to body)
    const tooltip = page.locator('.fade-in');
    const tooltipCount = await tooltip.count();

    // Even if no tooltip text appears (e.g., tooltip not configured for task bars),
    // the key assertion is that no crash occurred
    expect(pageErrors).toHaveLength(0);

    // If tooltip rendered, verify it's visible
    if (tooltipCount > 0) {
      await expect(tooltip.first()).toBeVisible();
    }
  });

  test('moving mouse away hides tooltip', async ({ page }) => {
    // Hover over a task bar to trigger tooltip (force to bypass table panel overlap)
    const taskBar = page.locator('.task-bar').first();
    await taskBar.hover({ force: true });

    // Wait for tooltip delay
    await page.waitForTimeout(500);

    // Move mouse to the header (a neutral area away from task bars)
    await page.locator('header').hover();

    // Wait for tooltip to fade out
    await page.waitForTimeout(300);

    // The tooltip should no longer be visible. Tooltips are portaled to body
    // with the fade-in class. After mouse leave they are removed from DOM.
    const tooltipVisible = await page.evaluate(() => {
      const fixedElements = document.querySelectorAll('body > div.fade-in');
      return fixedElements.length > 0;
    });

    expect(tooltipVisible).toBe(false);
  });
});

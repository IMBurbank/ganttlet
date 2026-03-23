import { test, expect } from './fixtures';

test.describe('Tooltips', () => {
  test('hovering over a task bar shows tooltip without errors', async ({ sandboxPage: gantt }) => {
    const consoleErrors: string[] = [];
    gantt.page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    const pageErrors: string[] = [];
    gantt.page.on('pageerror', (err) => pageErrors.push(err.message));

    // Hover a task bar (force: true needed — table panel overlaps SVG bars)
    await gantt.taskBars.first().hover({ force: true });

    // Wait for tooltip delay (400ms per Tooltip.tsx) then check for errors
    await expect(async () => {
      const rectErrors = consoleErrors.filter((msg) => msg.includes('getBoundingClientRect'));
      expect(rectErrors).toHaveLength(0);
    }).toPass({ timeout: 1_000 });

    expect(pageErrors.filter((msg) => msg.includes('getBoundingClientRect'))).toHaveLength(0);
    expect(pageErrors).toHaveLength(0);
  });

  test('moving mouse away hides tooltip', async ({ sandboxPage: gantt }) => {
    await gantt.taskBars.first().hover({ force: true });

    // Move to header (neutral area)
    await gantt.page.locator('header').hover();

    // Tooltip portals to body with fade-in class — should be removed from DOM
    await expect(async () => {
      const tooltipVisible = await gantt.page.evaluate(() => {
        return document.querySelectorAll('body > div.fade-in').length > 0;
      });
      expect(tooltipVisible).toBe(false);
    }).toPass({ timeout: 1_000 });
  });
});

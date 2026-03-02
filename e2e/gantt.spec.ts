import { test, expect } from '@playwright/test';

test.describe('Ganttlet E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the app to fully render (task bars appear in the SVG)
    await page.locator('.task-bar').first().waitFor({ timeout: 15_000 });
  });

  test('cell editing works', async ({ page }) => {
    // Find a task name cell with "Double-click to edit" title
    const nameCell = page.getByTitle('Double-click to edit').first();
    await nameCell.waitFor();

    // Read the original text
    const originalText = await nameCell.textContent();

    // Double-click to enter edit mode
    await nameCell.dblclick();

    // Wait for the inline edit input to appear
    const input = page.locator('input.inline-edit-input');
    await input.waitFor({ timeout: 5_000 });

    // Clear and type a new name
    const newName = 'E2E Test Task Name';
    await input.fill(newName);

    // Blur to save (click somewhere else)
    await page.locator('header').click();

    // Verify the new name appears and the input is gone
    await expect(input).toBeHidden();
    await expect(page.getByTitle('Double-click to edit').filter({ hasText: newName })).toBeVisible();

    // Restore original name to avoid side effects
    if (originalText) {
      const editedCell = page.getByTitle('Double-click to edit').filter({ hasText: newName });
      await editedCell.dblclick();
      const restoreInput = page.locator('input.inline-edit-input');
      await restoreInput.waitFor({ timeout: 5_000 });
      await restoreInput.fill(originalText.trim());
      await page.locator('header').click();
    }
  });

  test('critical path highlights task bars', async ({ page }) => {
    // Toggle critical path on
    const cpButton = page.getByRole('button', { name: 'Critical Path' });
    await cpButton.click();

    // Open scope dropdown and select the project to scope computation
    const scopeButton = page.locator('button[title="Scope"]');
    await scopeButton.click();

    // Select "Q2 Product Launch" project from the scope menu
    await page.getByRole('button', { name: 'Q2 Product Launch' }).click();

    // Wait for WASM computation and re-render
    // Critical elements (task bars or milestones) get fill="#ef4444"
    // Use page.evaluate since SVG elements may be off-viewport
    await page.waitForFunction(() => {
      return document.querySelectorAll('.task-bar[fill="#ef4444"]').length > 0;
    }, { timeout: 5_000 });

    const count = await page.evaluate(() =>
      document.querySelectorAll('.task-bar[fill="#ef4444"]').length
    );
    expect(count).toBeGreaterThanOrEqual(1);

    // Verify the button is visually in its active state (red styling)
    await expect(cpButton).toHaveClass(/bg-red-600/);

    // Toggle off to restore state
    await cpButton.click();
  });

  test('workstream scope does not crash', async ({ page }) => {
    // Enable critical path first
    const cpButton = page.getByRole('button', { name: 'Critical Path' });
    await cpButton.click();
    await page.waitForTimeout(500);

    // Open the scope dropdown (the small arrow next to Critical Path)
    // The scope button is adjacent to the Critical Path button
    const scopeButton = page.locator('button[title="Scope"]');

    // If scope button doesn't have a title, look for the dropdown arrow near Critical Path
    if ((await scopeButton.count()) === 0) {
      // Fallback: click the dropdown arrow in the critical path section
      const cpSection = cpButton.locator('..');
      const dropdownArrow = cpSection.locator('button').last();
      await dropdownArrow.click();
    } else {
      await scopeButton.click();
    }

    await page.waitForTimeout(500);

    // Look for workstream items in the dropdown menu
    // The scope menu has sections: PROJECTS, WORKSTREAMS, MILESTONES
    const workstreamItems = page.locator('button').filter({ hasText: /^(Platform Engineering|UX Redesign|Go-to-Market)/ });

    if ((await workstreamItems.count()) > 0) {
      // Click the first workstream to scope to it
      await workstreamItems.first().click();
      await page.waitForTimeout(1_000);
    }

    // Verify the app is still responsive — page should have task bars
    // (not an error screen)
    await expect(page.locator('.task-bar').first()).toBeVisible({ timeout: 5_000 });

    // Verify no crash: check document.title is still present (page didn't blank out)
    const title = await page.title();
    expect(title).toBeTruthy();

    // Toggle off critical path to restore state
    await cpButton.click();
  });

  test('dependency arrows are connected', async ({ page }) => {
    // Check that dependency arrow SVG groups exist
    const arrows = page.locator('g.dependency-arrow');
    const arrowCount = await arrows.count();
    expect(arrowCount).toBeGreaterThan(0);

    // Verify the dep-stroke paths have actual path data (not empty or degenerate)
    const firstStroke = arrows.first().locator('.dep-stroke');
    const pathD = await firstStroke.getAttribute('d');
    expect(pathD).toBeTruthy();

    // The path should have reasonable coordinates (not all zeros)
    // A valid Bézier path has M (moveto) and C (curveto) with non-zero coords
    expect(pathD).toMatch(/[MC]/);
    // Ensure there are coordinates that aren't all zero
    const coords = pathD!.match(/[\d.]+/g)?.map(Number) ?? [];
    const hasNonZero = coords.some((c) => c > 1);
    expect(hasNonZero).toBe(true);

    // Check that arrowheads exist too
    const firstHead = arrows.first().locator('.dep-head');
    const headD = await firstHead.getAttribute('d');
    expect(headD).toBeTruthy();
  });
});

import { test, expect } from '@playwright/test';

test.describe('Ganttlet E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Enter sandbox mode via the real user flow
    await page.getByTestId('try-demo-button').click();
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
    await expect(
      page.getByTitle('Double-click to edit').filter({ hasText: newName })
    ).toBeVisible();

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
    await page.waitForFunction(
      () => {
        return document.querySelectorAll('.task-bar[fill="#ef4444"]').length > 0;
      },
      { timeout: 5_000 }
    );

    const count = await page.evaluate(
      () => document.querySelectorAll('.task-bar[fill="#ef4444"]').length
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
    const workstreamItems = page
      .locator('button')
      .filter({ hasText: /^(Platform Engineering|UX Redesign|Go-to-Market)/ });

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

  test('constraint set via popover cascades to dependent tasks', async ({ page }) => {
    // Open a task bar popover by double-clicking
    const taskBar = page.locator('.task-bar').first();
    await taskBar.dispatchEvent('dblclick');

    // Wait for popover to appear
    const popover = page.locator('.fade-in');
    await popover.waitFor({ timeout: 5_000 });

    // Find the constraint dropdown and change to SNET
    const constraintSelect = popover.locator('select').last();
    await constraintSelect.selectOption('SNET');

    // Set a constraint date (a date in the future)
    const dateInput = popover.locator('input[type="date"]').last();
    await dateInput.fill('2026-06-01');

    // Close the popover by pressing Escape
    await page.keyboard.press('Escape');

    // Wait for WASM recalculation
    await page.waitForTimeout(500);

    // Verify the app didn't crash — task bars still visible
    await expect(page.locator('.task-bar').first()).toBeVisible({ timeout: 5_000 });

    // Verify constraint was applied: reopen the same task and check the value
    await taskBar.dispatchEvent('dblclick');
    const reopenedPopover = page.locator('.fade-in');
    await reopenedPopover.waitFor({ timeout: 5_000 });
    const updatedSelect = reopenedPopover.locator('select').last();
    await expect(updatedSelect).toHaveValue('SNET');
  });

  test('dependency arrow heads render as triangles', async ({ page }) => {
    // Verify dependency arrows exist
    const arrows = page.locator('g.dependency-arrow');
    const arrowCount = await arrows.count();
    expect(arrowCount).toBeGreaterThan(0);

    // Check each arrow's structure: must have dep-stroke and dep-head paths
    for (let i = 0; i < Math.min(arrowCount, 5); i++) {
      const arrow = arrows.nth(i);
      const stroke = arrow.locator('.dep-stroke');
      const head = arrow.locator('.dep-head');

      const strokeD = await stroke.getAttribute('d');
      const headD = await head.getAttribute('d');

      expect(strokeD).toBeTruthy();
      expect(headD).toBeTruthy();

      // Arrow head should be a triangle (3 points: M, L, L, Z)
      expect(headD).toMatch(/M.*L.*L.*Z/);
    }
  });

  test('SF dependency renders correct arrow path', async ({ page }) => {
    // pe-3 has a FS dependency on pe-1 in demo data.
    // We'll change it to SF and verify the arrow renders correctly.

    // Find the pe-3 task's predecessors cell and click to open the dependency editor.
    // The predecessors cell for pe-3 shows "pe-1+2" (FS is hidden, lag=2 shown).
    const predCell = page.locator('button').filter({ hasText: /^pe-1\+2$/ });
    await predCell.click();

    // Wait for the dependency editor modal to appear
    const modal = page.locator('.fade-in');
    await modal.waitFor({ timeout: 5_000 });

    // Find the dependency type dropdown (second select in the row) and change to SF
    const typeSelect = modal.locator('select').nth(1);
    await typeSelect.selectOption('SF');

    // Close modal by pressing Escape
    await page.keyboard.press('Escape');

    // Wait for re-render with new arrow
    await page.waitForTimeout(500);

    // Verify dependency arrows still exist and have valid path data
    const arrows = page.locator('g.dependency-arrow');
    const arrowCount = await arrows.count();
    expect(arrowCount).toBeGreaterThan(0);

    // Find the SF arrow by checking all arrows for the one with an arrowhead
    // pointing left (tip x < base x). SF arrows point toward the successor's finish.
    let foundSfArrow = false;
    for (let i = 0; i < arrowCount; i++) {
      const arrow = arrows.nth(i);
      const headD = await arrow.locator('.dep-head').getAttribute('d');
      if (!headD) continue;

      // Parse arrowhead triangle path: M x1 y1 L x2 y2 L x3 y3 Z
      // Extract x coordinates
      const coords = headD.match(/[-\d.]+/g)?.map(Number);
      if (!coords || coords.length < 6) continue;

      // Triangle has 3 points: (x1,y1), (x2,y2), (x3,y3)
      // For a left-pointing arrowhead, the tip x is the minimum x
      const xs = [coords[0], coords[2], coords[4]];
      const tipX = Math.min(...xs);
      const baseXs = xs.filter((x) => x !== tipX);

      // Left-pointing: tip x is less than both base x values
      if (baseXs.length === 2 && tipX < baseXs[0] && tipX < baseXs[1]) {
        foundSfArrow = true;

        // Verify the stroke path is also valid
        const strokeD = await arrow.locator('.dep-stroke').getAttribute('d');
        expect(strokeD).toBeTruthy();
        expect(strokeD).toMatch(/[MC]/);
        break;
      }
    }

    expect(foundSfArrow).toBe(true);

    // Restore: reopen and change back to FS
    const restoredPredCell = page.locator('button').filter({ hasText: /pe-1/ }).first();
    await restoredPredCell.click();
    const restoreModal = page.locator('.fade-in');
    await restoreModal.waitFor({ timeout: 5_000 });
    const restoreTypeSelect = restoreModal.locator('select').nth(1);
    await restoreTypeSelect.selectOption('FS');
    await page.keyboard.press('Escape');
  });

  test('MSO constraint with past date does not crash the app', async ({ page }) => {
    // Set MSO on a task to a date in the past — verifies the app handles
    // constraint violations gracefully without crashing
    const taskBar = page.locator('.task-bar').first();
    await taskBar.dispatchEvent('dblclick');

    const popover = page.locator('.fade-in');
    await popover.waitFor({ timeout: 5_000 });

    // Set MSO constraint (Must Start On) — a hard constraint
    const constraintSelect = popover.locator('select').last();
    await constraintSelect.selectOption('MSO');

    // Set constraint date to far in the past to force a conflict
    const dateInput = popover.locator('input[type="date"]').last();
    await dateInput.fill('2020-01-01');

    // Close popover
    await page.keyboard.press('Escape');

    // Wait for WASM conflict detection
    await page.waitForTimeout(1000);

    // Look for conflict indicators: red circles (warning icons) or
    // red dashed outlines (stroke="#ef4444" with strokeDasharray)
    const conflictCircles = page.locator('circle[fill="#ef4444"]');
    const conflictOutlines = await page.evaluate(() => {
      return document.querySelectorAll('rect[stroke="#ef4444"]').length;
    });

    // Verify the app is still functioning — task bars visible, no crash
    await expect(page.locator('.task-bar').first()).toBeVisible({ timeout: 5_000 });

    // If the task has dependencies, MSO with a past date should produce
    // at least one conflict indicator (red circle or dashed outline)
    const conflictCount = (await conflictCircles.count()) + conflictOutlines;
    expect(conflictCount).toBeGreaterThan(0);

    // Reset: remove constraint to clean up
    await taskBar.dispatchEvent('dblclick');
    const resetPopover = page.locator('.fade-in');
    await resetPopover.waitFor({ timeout: 5_000 });
    const resetSelect = resetPopover.locator('select').last();
    await resetSelect.selectOption('ASAP');
    await page.keyboard.press('Escape');
  });
});

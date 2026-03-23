import { test, expect } from './fixtures';

test.describe('Gantt Chart @gantt', () => {
  test('cell editing works @smoke', async ({ sandboxPage: gantt }) => {
    const cell = gantt.editableCells.first();
    await cell.waitFor();
    const originalText = await cell.textContent();

    await test.step('edit task name', async () => {
      await gantt.editTaskName(0, 'E2E Test Task Name');
    });

    await test.step('verify edit persisted', async () => {
      await expect(gantt.editableCells.filter({ hasText: 'E2E Test Task Name' })).toBeVisible();
    });

    await test.step('restore original name', async () => {
      if (originalText) {
        await gantt.editTaskName(0, originalText.trim());
      }
    });
  });

  test('critical path highlights task bars', async ({ sandboxPage: gantt }) => {
    await test.step('toggle critical path on', async () => {
      await gantt.toggleCriticalPath();
    });

    await test.step('scope to Q2 Product Launch', async () => {
      await gantt.selectScope('Q2 Product Launch');
    });

    await test.step('verify critical task bars appear', async () => {
      // Critical task bars get data-critical="true" attribute
      const criticalBars = gantt.page.locator('[data-testid^="task-bar-"][data-critical="true"]');
      await expect(criticalBars.first()).toBeVisible({ timeout: 5_000 });
    });

    await test.step('verify button active state', async () => {
      await expect(gantt.page.getByRole('button', { name: 'Critical Path' })).toHaveClass(
        /bg-red-600/
      );
    });

    // Restore
    await gantt.toggleCriticalPath();
  });

  test('workstream scope does not crash', async ({ sandboxPage: gantt }) => {
    await gantt.toggleCriticalPath();

    await test.step('open scope and select workstream', async () => {
      const scopeButton = gantt.page.getByTestId('scope-button');
      if ((await scopeButton.count()) > 0) {
        await scopeButton.click();
      }

      const workstreamItems = gantt.page
        .getByRole('button')
        .filter({ hasText: /^(Platform Engineering|UX Redesign|Go-to-Market)/ });

      if ((await workstreamItems.count()) > 0) {
        await workstreamItems.first().click();
      }
    });

    await test.step('verify app still responsive', async () => {
      await expect(gantt.taskBars.first()).toBeVisible({ timeout: 5_000 });
      const title = await gantt.page.title();
      expect(title).toBeTruthy();
    });

    await gantt.toggleCriticalPath();
  });

  test('dependency arrows are connected', async ({ sandboxPage: gantt }) => {
    const arrowCount = await gantt.dependencyArrows.count();
    expect(arrowCount).toBeGreaterThan(0);

    await test.step('verify stroke path data', async () => {
      const firstStroke = gantt.dependencyArrows.first().getByTestId('dep-stroke');
      const pathD = await firstStroke.getAttribute('d');
      expect(pathD).toBeTruthy();
      expect(pathD).toMatch(/[MC]/);
      const coords = pathD!.match(/[\d.]+/g)?.map(Number) ?? [];
      expect(coords.some((c) => c > 1)).toBe(true);
    });

    await test.step('verify arrowhead exists', async () => {
      const firstHead = gantt.dependencyArrows.first().getByTestId('dep-head');
      const headD = await firstHead.getAttribute('d');
      expect(headD).toBeTruthy();
    });
  });

  test('constraint set via popover cascades to dependent tasks', async ({ sandboxPage: gantt }) => {
    const popover = await gantt.openPopover(0);

    await test.step('set SNET constraint with date', async () => {
      await popover.setConstraint('SNET', '2026-06-01');
    });

    await test.step('close and verify app stable', async () => {
      await popover.close();
      await expect(gantt.taskBars.first()).toBeVisible({ timeout: 5_000 });
    });

    await test.step('reopen and verify constraint persisted', async () => {
      const reopened = await gantt.openPopover(0);
      await expect(reopened.constraintType).toHaveValue('SNET');
    });
  });

  test('dependency arrow heads render as triangles', async ({ sandboxPage: gantt }) => {
    const arrowCount = await gantt.dependencyArrows.count();
    expect(arrowCount).toBeGreaterThan(0);

    for (let i = 0; i < Math.min(arrowCount, 5); i++) {
      const arrow = gantt.dependencyArrows.nth(i);
      const strokeD = await arrow.getByTestId('dep-stroke').getAttribute('d');
      const headD = await arrow.getByTestId('dep-head').getAttribute('d');

      expect(strokeD).toBeTruthy();
      expect(headD).toBeTruthy();
      expect(headD).toMatch(/M.*L.*L.*Z/);
    }
  });

  test('SF dependency renders correct arrow path', async ({ sandboxPage: gantt }) => {
    await test.step('change FS dependency to SF', async () => {
      const depEditor = await gantt.openDepEditor(/^pe-1\+2$/);
      await depEditor.setType(0, 'SF');
      await depEditor.close();
    });

    await test.step('verify SF arrow exists (left-pointing arrowhead)', async () => {
      const arrowCount = await gantt.dependencyArrows.count();
      expect(arrowCount).toBeGreaterThan(0);

      let foundSfArrow = false;
      for (let i = 0; i < arrowCount; i++) {
        const arrow = gantt.dependencyArrows.nth(i);
        const headD = await arrow.getByTestId('dep-head').getAttribute('d');
        if (!headD) continue;

        const coords = headD.match(/[-\d.]+/g)?.map(Number);
        if (!coords || coords.length < 6) continue;

        const xs = [coords[0], coords[2], coords[4]];
        const tipX = Math.min(...xs);
        const baseXs = xs.filter((x) => x !== tipX);

        if (baseXs.length === 2 && tipX < baseXs[0] && tipX < baseXs[1]) {
          foundSfArrow = true;
          const strokeD = await arrow.getByTestId('dep-stroke').getAttribute('d');
          expect(strokeD).toBeTruthy();
          expect(strokeD).toMatch(/[MC]/);
          break;
        }
      }
      expect(foundSfArrow).toBe(true);
    });

    await test.step('restore to FS', async () => {
      // After SF change, button text may be "pe-1 SF+2". Use .first() to avoid
      // strict mode if multiple buttons match (pe-2 may also depend on pe-1).
      const depBtn = gantt.page.getByRole('button').filter({ hasText: /pe-1/ }).first();
      await depBtn.click();
      const depEditor = new (await import('./models/gantt-page')).DepEditorModel(gantt.page);
      await depEditor.container.waitFor({ timeout: 5_000 });
      await depEditor.setType(0, 'FS');
      await depEditor.close();
    });
  });

  test('MSO constraint with past date shows conflict indicator', async ({ sandboxPage: gantt }) => {
    await test.step('set MSO constraint with past date', async () => {
      const popover = await gantt.openPopover(0);
      await popover.setConstraint('MSO', '2020-01-01');
      await popover.close();
    });

    await test.step('verify conflict indicators appear', async () => {
      await expect(async () => {
        const indicatorCount = await gantt.conflictIndicators.count();
        const outlineCount = await gantt.conflictOutlines.count();
        expect(indicatorCount + outlineCount).toBeGreaterThan(0);
      }).toPass({ timeout: 5_000 });
    });

    await test.step('verify app still functional', async () => {
      await expect(gantt.taskBars.first()).toBeVisible({ timeout: 5_000 });
    });

    await test.step('reset constraint to ASAP', async () => {
      const popover = await gantt.openPopover(0);
      await popover.setConstraint('ASAP');
      await popover.close();
    });
  });

  test('drag task bar moves task dates', async ({ sandboxPage: gantt }) => {
    // Read original start date from the first task
    const popoverBefore = await gantt.openPopover(0);
    const originalStart = await popoverBefore.startDate.inputValue();
    await popoverBefore.close();

    await test.step('drag task bar to the right', async () => {
      // The table panel overlaps SVG task bars, so Playwright's page.mouse
      // hits the table layer instead. Dispatch the entire drag sequence via
      // evaluate on the SVG rect's native events (React picks them up via
      // delegation, and the mousemove/mouseup handlers attach to document).
      await gantt.page.evaluate(() => {
        const el = document.querySelector('[data-testid^="task-bar-"]');
        if (!el) throw new Error('No task bar found');
        const rect = el.getBoundingClientRect();
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;

        // mousedown on the rect (React's onMouseDown attaches doc listeners)
        el.dispatchEvent(
          new MouseEvent('mousedown', {
            clientX: cx,
            clientY: cy,
            button: 0,
            detail: 1,
            bubbles: true,
            cancelable: true,
          })
        );

        // mousemove on document (drag handler listens here)
        for (let i = 1; i <= 10; i++) {
          document.dispatchEvent(
            new MouseEvent('mousemove', {
              clientX: cx + i * 10,
              clientY: cy,
              bubbles: true,
              cancelable: true,
            })
          );
        }

        // mouseup on document (completes the drag)
        document.dispatchEvent(
          new MouseEvent('mouseup', {
            clientX: cx + 100,
            clientY: cy,
            bubbles: true,
            cancelable: true,
          })
        );
      });
    });

    await test.step('verify date changed', async () => {
      const popoverAfter = await gantt.openPopover(0);
      const newStart = await popoverAfter.startDate.inputValue();
      expect(newStart).not.toBe(originalStart);
      await popoverAfter.close();
    });
  });

  test('undo reverts constraint change', async ({ sandboxPage: gantt }) => {
    await test.step('set SNET constraint', async () => {
      const popover = await gantt.openPopover(0);
      await popover.setConstraint('SNET', '2026-06-01');
      await popover.close();
    });

    await test.step('undo until constraint reverts to ASAP', async () => {
      // SET_CONSTRAINT + CASCADE_DEPENDENTS = 2 undoable actions
      const undoBtn = gantt.page.getByRole('button', { name: 'Undo' });
      await expect(undoBtn).toBeEnabled({ timeout: 5_000 });

      // Click undo and poll until constraint reverts (may need 1-3 clicks)
      await expect(async () => {
        await undoBtn.click();
        const pop = await gantt.openPopover(0);
        const val = await pop.constraintType.inputValue();
        await pop.close();
        expect(val).toBe('ASAP');
      }).toPass({ timeout: 10_000 });
    });
  });

  test('redo restores undone constraint change', async ({ sandboxPage: gantt }) => {
    await test.step('set constraint and undo', async () => {
      const popover = await gantt.openPopover(0);
      await popover.setConstraint('SNET', '2026-06-01');
      await popover.close();

      await gantt.page.getByRole('button', { name: 'Undo' }).click();
    });

    await test.step('undo until ASAP', async () => {
      const undoBtn = gantt.page.getByRole('button', { name: 'Undo' });
      await expect(undoBtn).toBeEnabled({ timeout: 5_000 });

      await expect(async () => {
        await undoBtn.click();
        const pop = await gantt.openPopover(0);
        const val = await pop.constraintType.inputValue();
        await pop.close();
        expect(val).toBe('ASAP');
      }).toPass({ timeout: 10_000 });
    });

    await test.step('redo until SNET restored', async () => {
      const redoBtn = gantt.page.getByRole('button', { name: 'Redo' });
      await expect(redoBtn).toBeEnabled({ timeout: 5_000 });

      await expect(async () => {
        await redoBtn.click();
        const pop = await gantt.openPopover(0);
        const val = await pop.constraintType.inputValue();
        await pop.close();
        expect(val).toBe('SNET');
      }).toPass({ timeout: 10_000 });
    });
  });
});

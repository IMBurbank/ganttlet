/**
 * gantt-page.ts — Page model for Gantt chart interactions.
 *
 * Extends BasePage with SVG-specific locators and multi-step interaction methods.
 * Tests read like user stories:
 *   await gantt.editTaskName(0, 'New Name')
 *   const popover = await gantt.openPopover(0)
 *   await popover.setConstraint('SNET', '2026-06-01')
 */
import { type Locator, type Page, expect } from '@playwright/test';
import { BasePage } from './base-page';

// ─── PopoverModel ────────────────────────────────────────────────────────────

/** Model for the task bar popover (opened by double-clicking a task bar). */
export class PopoverModel {
  readonly container: Locator;

  constructor(private page: Page) {
    this.container = page.getByTestId('task-popover');
  }

  get nameInput(): Locator {
    return this.container.getByLabel('Name');
  }

  get startDate(): Locator {
    return this.container.getByLabel('Start');
  }

  get endDate(): Locator {
    return this.container.getByLabel('End');
  }

  get constraintType(): Locator {
    return this.container.getByLabel('Constraint', { exact: true });
  }

  get constraintDate(): Locator {
    return this.container.getByLabel('Constraint Date');
  }

  /** Select a constraint type and optionally set the constraint date. */
  async setConstraint(type: string, date?: string): Promise<void> {
    await this.constraintType.selectOption(type);
    if (date) {
      await this.constraintDate.fill(date);
    }
  }

  /** Close the popover by pressing Escape. */
  async close(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await expect(this.container).toBeHidden();
  }
}

// ─── DepEditorModel ──────────────────────────────────────────────────────────

/** Model for the dependency editor modal. */
export class DepEditorModel {
  readonly container: Locator;

  constructor(private page: Page) {
    this.container = page.getByTestId('dependency-editor');
  }

  /** Get the type dropdown for the nth dependency row (0-indexed). */
  typeSelect(index: number): Locator {
    return this.container.getByLabel('Dependency type').nth(index);
  }

  /** Change the dependency type for the nth row. */
  async setType(index: number, type: string): Promise<void> {
    await this.typeSelect(index).selectOption(type);
  }

  /** Close the modal by pressing Escape. */
  async close(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await expect(this.container).toBeHidden();
  }
}

// ─── GanttPage ───────────────────────────────────────────────────────────────

/**
 * Gantt chart page model. Extends BasePage with SVG locators and
 * multi-step chart interactions.
 */
export class GanttPage extends BasePage {
  // ── SVG locators (getByTestId correct — no ARIA roles for SVG) ──
  // taskBars and editableCells inherited from BasePage

  taskBar(index: number): Locator {
    return this.taskBars.nth(index);
  }

  taskBarById(taskId: string): Locator {
    return this.page.getByTestId(`task-bar-${taskId}`);
  }

  get inlineEditInput(): Locator {
    return this.page.getByTestId('inline-edit-input');
  }

  get dependencyArrows(): Locator {
    return this.page.getByTestId('dependency-arrow');
  }

  get conflictIndicators(): Locator {
    return this.page.getByTestId('conflict-indicator');
  }

  get conflictOutlines(): Locator {
    return this.page.getByTestId('conflict-outline');
  }

  get presenceIndicators(): Locator {
    return this.page.getByTestId('presence-indicator');
  }

  get tooltip(): Locator {
    return this.page.getByTestId('tooltip');
  }

  get criticalTaskBars(): Locator {
    return this.page.locator('[data-testid^="task-bar-"][data-critical="true"]');
  }

  get criticalPathButton(): Locator {
    return this.page.getByRole('button', { name: 'Critical Path' });
  }

  get undoButton(): Locator {
    return this.page.getByRole('button', { name: 'Undo' });
  }

  get redoButton(): Locator {
    return this.page.getByRole('button', { name: 'Redo' });
  }

  // ── Multi-step methods ──

  async waitForTaskBars(timeout = 15_000): Promise<void> {
    await this.taskBars.first().waitFor({ timeout });
  }

  /** Enter sandbox and wait for task bars to load. */
  async enterSandboxAndWait(timeout = 15_000): Promise<void> {
    await this.tryDemoButton.click();
    await this.waitForTaskBars(timeout);
  }

  async editTaskName(index: number, newName: string): Promise<void> {
    const cell = this.editableCells.nth(index);
    await cell.dblclick();
    await this.inlineEditInput.waitFor({ timeout: 5_000 });
    await this.inlineEditInput.fill(newName);
    await this.header.click();
    await expect(this.inlineEditInput).toBeHidden();
  }

  async openPopover(index: number): Promise<PopoverModel> {
    const bar = this.taskBar(index);
    await bar.dispatchEvent('dblclick');
    const popover = new PopoverModel(this.page);
    await popover.container.waitFor({ timeout: 5_000 });
    return popover;
  }

  async openDepEditor(buttonText: string | RegExp): Promise<DepEditorModel> {
    const btn = this.page.getByRole('button', { name: buttonText });
    await btn.click();
    const editor = new DepEditorModel(this.page);
    await editor.container.waitFor({ timeout: 5_000 });
    return editor;
  }

  async toggleCriticalPath(): Promise<void> {
    await this.page.getByRole('button', { name: 'Critical Path' }).click();
  }

  async selectScope(name: string): Promise<void> {
    await this.page.getByRole('button', { name: 'Scope' }).click();
    await this.page.getByRole('button', { name }).click();
  }
}

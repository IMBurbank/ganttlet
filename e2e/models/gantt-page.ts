/**
 * gantt-page.ts — Page model for Gantt chart interactions.
 *
 * Wraps a Playwright Page with domain verbs so tests read like user stories:
 *   await gantt.editTaskName(0, 'New Name')
 *   const popover = await gantt.openPopover(0)
 *   await popover.setConstraint('SNET', '2026-06-01')
 *
 * Uses getByRole/getByLabel for standard elements, getByTestId for SVG.
 */
import { type Locator, type Page, expect } from '@playwright/test';

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
 * Page model for Gantt chart interactions.
 *
 * Provides locator properties for querying elements and multi-step methods
 * that encapsulate common interaction patterns (edit, open popover, etc.).
 */
export class GanttPage {
  constructor(public readonly page: Page) {}

  // ── Locators ──

  /** All task bar SVG elements (both regular tasks and milestones). */
  get taskBars(): Locator {
    return this.page.getByTestId(/^task-bar-/);
  }

  /** A specific task bar by 0-based index. */
  taskBar(index: number): Locator {
    return this.taskBars.nth(index);
  }

  /** A specific task bar by task ID. */
  taskBarById(taskId: string): Locator {
    return this.page.getByTestId(`task-bar-${taskId}`);
  }

  /** All editable cell spans ("Double-click to edit"). */
  get editableCells(): Locator {
    return this.page.getByTitle('Double-click to edit');
  }

  /** The inline edit input (visible when a cell is being edited). */
  get inlineEditInput(): Locator {
    return this.page.getByTestId('inline-edit-input');
  }

  /** All dependency arrow SVG groups. */
  get dependencyArrows(): Locator {
    return this.page.getByTestId('dependency-arrow');
  }

  /** All conflict indicator groups (red ! circles). */
  get conflictIndicators(): Locator {
    return this.page.getByTestId('conflict-indicator');
  }

  /** All conflict outline rects (dashed red borders). */
  get conflictOutlines(): Locator {
    return this.page.getByTestId('conflict-outline');
  }

  /** All presence indicator dots. */
  get presenceIndicators(): Locator {
    return this.page.getByTestId('presence-indicator');
  }

  // ── Multi-step methods ──

  /** Wait for at least one task bar to appear. */
  async waitForTaskBars(timeout = 15_000): Promise<void> {
    await this.taskBars.first().waitFor({ timeout });
  }

  /**
   * Edit a task name by double-clicking the nth editable cell.
   * Handles: dblclick → wait for input → fill → blur to save.
   */
  async editTaskName(index: number, newName: string): Promise<void> {
    const cell = this.editableCells.nth(index);
    await cell.dblclick();
    await this.inlineEditInput.waitFor({ timeout: 5_000 });
    await this.inlineEditInput.fill(newName);
    // Blur to save — click the header
    await this.page.locator('header').click();
    await expect(this.inlineEditInput).toBeHidden();
  }

  /**
   * Open the task bar popover by double-clicking the nth task bar.
   * Returns a PopoverModel for further interaction.
   */
  async openPopover(index: number): Promise<PopoverModel> {
    const bar = this.taskBar(index);
    await bar.dispatchEvent('dblclick');
    const popover = new PopoverModel(this.page);
    await popover.container.waitFor({ timeout: 5_000 });
    return popover;
  }

  /**
   * Open the dependency editor modal by clicking a dependency button.
   * @param buttonText - The text shown on the predecessors cell button (e.g. "pe-1+2").
   */
  async openDepEditor(buttonText: string | RegExp): Promise<DepEditorModel> {
    const btn = this.page.getByRole('button', { name: buttonText });
    await btn.click();
    const editor = new DepEditorModel(this.page);
    await editor.container.waitFor({ timeout: 5_000 });
    return editor;
  }

  /** Toggle critical path highlighting. */
  async toggleCriticalPath(): Promise<void> {
    await this.page.getByRole('button', { name: 'Critical Path' }).click();
  }

  /** Open the scope dropdown and select an item by name. */
  async selectScope(name: string): Promise<void> {
    await this.page.getByRole('button', { name: 'Scope' }).click();
    await this.page.getByRole('button', { name }).click();
  }
}

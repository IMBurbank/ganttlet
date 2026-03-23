/**
 * base-page.ts — Base page model with shared locators and interactions.
 *
 * Single source of truth for all locators. Uses Playwright's priority:
 *   getByRole > getByLabel > getByPlaceholder > getByText > getByTestId
 * getByTestId only for SVG elements, structural containers, and icon-only buttons.
 */
import { type Locator, type Page } from '@playwright/test';

export class BasePage {
  constructor(public readonly page: Page) {}

  // ── Navigation ──

  async goto(path = '/'): Promise<void> {
    await this.page.goto(path);
  }

  /** Navigate with mock auth client ID fix (call after setupMockAuth). */
  async gotoAuthenticated(path = '/'): Promise<void> {
    await this.page.goto(path);
    // Re-set client ID after navigation — some environments clear __ganttlet_config
    await this.page.evaluate(() => {
      (window as any).__ganttlet_config = (window as any).__ganttlet_config || {};
      (window as any).__ganttlet_config.googleClientId = 'fake-e2e-client-id';
    });
  }

  // ── Auth ──

  get signInButton(): Locator {
    return this.page.getByRole('button', { name: 'Sign in with Google' });
  }

  async signIn(): Promise<void> {
    await this.signInButton.first().click();
    await this.signInButton.first().waitFor({ state: 'hidden', timeout: 10_000 });
  }

  // ── Onboarding screens (scoped to containers to avoid locator collisions) ──

  get firstVisitWelcome(): Locator {
    return this.page.getByTestId('first-visit-welcome');
  }

  get firstVisitTitle(): Locator {
    // Scoped to welcome container — avoids collision with header's "Ganttlet" heading
    return this.firstVisitWelcome.getByRole('heading', { name: 'Ganttlet' });
  }

  get collaboratorWelcome(): Locator {
    return this.page.getByTestId('collaborator-welcome');
  }

  get collaboratorTitle(): Locator {
    return this.collaboratorWelcome.getByRole('heading', { name: /invited to collaborate/ });
  }

  /** Any h1 heading — used to detect post-sign-in screen (ChoosePath or ReturnVisitor). */
  get mainHeading(): Locator {
    return this.page.getByRole('heading', { level: 1 });
  }

  get tryDemoButton(): Locator {
    return this.page.getByRole('button', { name: 'Try the demo' });
  }

  get newProjectButton(): Locator {
    return this.page.getByRole('button', { name: 'New Project' });
  }

  get existingSheetButton(): Locator {
    return this.page.getByRole('button', { name: 'Connect Existing Sheet' });
  }

  get demoButton(): Locator {
    return this.page.getByRole('button', { name: 'Demo' });
  }

  get sandboxBanner(): Locator {
    return this.page.getByTestId('sandbox-banner');
  }

  get saveToSheetButton(): Locator {
    return this.page.getByRole('button', { name: 'Save to Google Sheet' });
  }

  get recentProjects(): Locator {
    return this.page.getByTestId('recent-projects');
  }

  // ── Empty state ──

  get emptyState(): Locator {
    return this.page.getByTestId('empty-state');
  }

  get emptyStateInput(): Locator {
    return this.page.getByPlaceholder('Enter task name...');
  }

  get startFromTemplate(): Locator {
    return this.page.getByTestId('start-from-template');
  }

  get templatePicker(): Locator {
    return this.page.getByTestId('template-picker');
  }

  get templatePickerClose(): Locator {
    return this.page.getByTestId('template-picker-close'); // icon-only button — no text
  }

  // ── Task bars (shared — onboarding tests check tasks loaded) ──

  get taskBars(): Locator {
    return this.page.getByTestId(/^task-bar-/);
  }

  get editableCells(): Locator {
    return this.page.getByTitle('Double-click to edit');
  }

  // ── Header ──

  get header(): Locator {
    return this.page.locator('header');
  }

  get sheetTitle(): Locator {
    return this.page.getByTestId('sheet-title');
  }

  get shareButton(): Locator {
    return this.page.getByRole('button', { name: 'Share' });
  }

  get sheetDropdownTrigger(): Locator {
    return this.page.getByTestId('sheet-dropdown-trigger');
  }

  get sheetDropdownMenu(): Locator {
    return this.page.getByTestId('sheet-dropdown-menu');
  }

  get menuDisconnect(): Locator {
    // Scoped to dropdown menu — "Disconnect" also exists in the confirm dialog
    return this.sheetDropdownMenu.getByRole('button', { name: 'Disconnect' });
  }

  get disconnectConfirm(): Locator {
    return this.page.getByTestId('disconnect-confirm');
  }

  get disconnectConfirmBtn(): Locator {
    // Scoped to confirm dialog — "Disconnect" also exists in the dropdown menu
    return this.disconnectConfirm.getByRole('button', { name: 'Disconnect' });
  }

  // ── Error states ──

  get errorBanner(): Locator {
    return this.page.getByTestId('error-banner');
  }

  get headerMismatchError(): Locator {
    return this.page.getByTestId('header-mismatch-error');
  }

  get expectedColumns(): Locator {
    return this.page.getByTestId('expected-columns');
  }

  get downloadTemplateBtn(): Locator {
    return this.page.getByRole('button', { name: 'Download header template' });
  }

  get createNewSheetBtn(): Locator {
    return this.page.getByRole('button', { name: 'Create a new sheet instead' });
  }

  get openAnotherBtn(): Locator {
    return this.page.getByRole('button', { name: 'Open another sheet' }).first();
  }

  get loadingSkeleton(): Locator {
    return this.page.getByTestId('loading-skeleton');
  }

  // ── Promotion flow ──

  get promotionModal(): Locator {
    return this.page.getByTestId('promotion-modal');
  }

  get createNewSheetButton(): Locator {
    return this.page.getByRole('button', { name: 'Create new sheet' });
  }

  get saveToExistingButton(): Locator {
    return this.page.getByRole('button', { name: 'Save to existing sheet' });
  }

  get promotionError(): Locator {
    return this.page.getByTestId('promotion-error');
  }

  // ── Sync ──

  get syncStatus(): Locator {
    return this.page.getByTestId('sync-status');
  }

  get collabStatus(): Locator {
    return this.page.locator('[data-collab-status="connected"]');
  }

  // ── Sheet selector ──

  get sheetSelectorModal(): Locator {
    return this.page.getByTestId('sheet-selector-modal');
  }
}

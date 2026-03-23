/**
 * base-page.ts — Base page model with shared locators and interactions.
 *
 * All locators are defined here as the single source of truth. Page-specific
 * models (GanttPage) extend this class. Tests and fixtures use model properties
 * exclusively — no raw page.getBy* calls outside this layer.
 */
import { type Locator, type Page } from '@playwright/test';
import { ensureClientId } from '../helpers/gis-mock';

export class BasePage {
  constructor(public readonly page: Page) {}

  // ── Navigation ──

  async goto(path = '/'): Promise<void> {
    await this.page.goto(path);
  }

  /** Navigate with mock auth client ID fix (call after setupMockAuth). */
  async gotoAuthenticated(path = '/'): Promise<void> {
    await this.page.goto(path);
    await ensureClientId(this.page);
  }

  // ── Auth ──

  /** The "Sign in with Google" button (FirstVisitWelcome, CollaboratorWelcome, PromotionFlow). */
  get signInButton(): Locator {
    return this.page.getByRole('button', { name: 'Sign in with Google' });
  }

  /** Click sign-in and wait for the button to disappear. */
  async signIn(): Promise<void> {
    await this.signInButton.first().click();
    await this.signInButton.first().waitFor({ state: 'hidden', timeout: 10_000 });
  }

  // ── Onboarding screens ──

  get firstVisitTitle(): Locator {
    return this.page.getByTestId('first-visit-title');
  }

  get collaboratorTitle(): Locator {
    return this.page.getByTestId('collaborator-title');
  }

  get choosePathHeading(): Locator {
    return this.page.getByRole('heading', { level: 1 });
  }

  get tryDemoButton(): Locator {
    return this.page.getByRole('button', { name: 'Try the demo' });
  }

  get newProjectButton(): Locator {
    return this.page.getByTestId('new-project-button');
  }

  get existingSheetButton(): Locator {
    return this.page.getByTestId('existing-sheet-button');
  }

  get demoButton(): Locator {
    return this.page.getByTestId('demo-button');
  }

  get sandboxBanner(): Locator {
    return this.page.getByTestId('sandbox-banner');
  }

  get saveToSheetButton(): Locator {
    return this.page.getByTestId('save-to-sheet-button');
  }

  get recentProjects(): Locator {
    return this.page.getByTestId('recent-projects');
  }

  // ── Empty state ──

  get emptyState(): Locator {
    return this.page.getByTestId('empty-state');
  }

  get emptyStateInput(): Locator {
    return this.page.getByTestId('empty-state-task-input');
  }

  get startFromTemplate(): Locator {
    return this.page.getByTestId('start-from-template');
  }

  get templatePicker(): Locator {
    return this.page.getByTestId('template-picker');
  }

  get templatePickerClose(): Locator {
    return this.page.getByTestId('template-picker-close');
  }

  // ── Header ──

  get header(): Locator {
    return this.page.locator('header');
  }

  get sheetTitle(): Locator {
    return this.page.getByTestId('sheet-title');
  }

  get shareButton(): Locator {
    return this.page.getByTestId('share-button');
  }

  get sheetDropdownTrigger(): Locator {
    return this.page.getByTestId('sheet-dropdown-trigger');
  }

  get sheetDropdownMenu(): Locator {
    return this.page.getByTestId('sheet-dropdown-menu');
  }

  get menuDisconnect(): Locator {
    return this.page.getByTestId('menu-disconnect');
  }

  get disconnectConfirm(): Locator {
    return this.page.getByTestId('disconnect-confirm');
  }

  get disconnectConfirmBtn(): Locator {
    return this.page.getByTestId('disconnect-confirm-btn');
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
    return this.page.getByTestId('download-template-btn');
  }

  get createNewSheetBtn(): Locator {
    return this.page.getByTestId('create-new-sheet-btn');
  }

  get openAnotherBtn(): Locator {
    return this.page.getByTestId('open-another-btn');
  }

  get loadingSkeleton(): Locator {
    return this.page.getByTestId('loading-skeleton');
  }

  // ── Promotion flow ──

  get promotionModal(): Locator {
    return this.page.getByTestId('promotion-modal');
  }

  get createNewSheetButton(): Locator {
    return this.page.getByTestId('create-new-sheet-button');
  }

  get saveToExistingButton(): Locator {
    return this.page.getByTestId('save-to-existing-button');
  }

  get promotionError(): Locator {
    return this.page.getByTestId('promotion-error');
  }

  // ── Sync ──

  get syncStatus(): Locator {
    return this.page.getByTestId('sync-status');
  }

  // ── Sheet selector ──

  get sheetSelectorModal(): Locator {
    return this.page.getByTestId('sheet-selector-modal');
  }
}

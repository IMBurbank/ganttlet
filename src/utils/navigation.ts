import type { UIStore } from '../store/UIStore';

/**
 * Navigate to a Google Sheet — updates URL params and UIStore state.
 *
 * This is the SINGLE function for sheet navigation. All components that
 * need to open a sheet (Header, EmptyState, PromotionFlow, WelcomeGate)
 * must use this function. Do not duplicate the URL + UIStore update logic.
 */
export function navigateToSheet(spreadsheetId: string, uiStore: UIStore): void {
  const url = new URL(window.location.href);
  url.searchParams.set('sheet', spreadsheetId);
  url.searchParams.set('room', spreadsheetId);
  window.history.replaceState({}, '', url.toString());
  uiStore.setState({
    spreadsheetId,
    roomId: spreadsheetId,
    dataSource: 'loading',
    syncError: null,
  });
}

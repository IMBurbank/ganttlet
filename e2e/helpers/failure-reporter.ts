/**
 * failure-reporter.ts — Minimal Playwright reporter that writes a marker file
 * when any test fails. Used by global-teardown to skip sheet deletion on failure.
 */
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FAILED_FILE = path.join(__dirname, '..', '..', '.e2e-failed');

class FailureReporter implements Reporter {
  onTestEnd(_test: TestCase, result: TestResult) {
    if (result.status === 'failed' || result.status === 'timedOut') {
      fs.writeFileSync(FAILED_FILE, 'true', 'utf-8');
    }
  }
}

export default FailureReporter;

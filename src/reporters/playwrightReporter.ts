import { Reporter, TestCase, TestResult, FullResult } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export interface SerializedFailure {
  title: string;
  file: string;
  line: number;
  errorMessage: string;
  errorStack: string;
}

export default class RootCauseReporter implements Reporter {
  private failures: SerializedFailure[] = [];
  private outputDir = path.resolve(process.cwd(), '.rootcause');

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === 'failed' || result.status === 'timedOut') {
      const topError = result.errors[0];
      this.failures.push({
        title: test.title,
        file: test.location.file,
        line: test.location.line,
        errorMessage: topError?.message || 'Unknown test failure',
        errorStack: topError?.stack || '',
      });
    }
  }

  async onEnd(result: FullResult) {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    const targetFile = path.join(this.outputDir, 'failures.json');
    fs.writeFileSync(targetFile, JSON.stringify(this.failures, null, 2), 'utf-8');

    if (this.failures.length > 0) {
      console.log(`\n\x1b[33m[RootCause Reporter] Captured ${this.failures.length} failure(s) to .rootcause/failures.json\x1b[0m`);
    } else {
      console.log(`\n\x1b[32m[RootCause Reporter] All tests passed. Clean failure ledger.\x1b[0m`);
    }
  }
}
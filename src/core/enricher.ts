import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface RawFailure {
  title: string;
  file: string;
  line: number;
  errorMessage: string;
  errorStack: string;
}

export interface EnrichedContext {
  failures: Array<{
    title: string;
    file: string;
    line: number;
    errorMessage: string;
    stackSnippet: string;
  }>;
  gitDiff: string;
}

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9_\-\.]{12,}/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g,
  /(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AIzaSy[A-Za-z0-9_\-]{30,})/g,
];

function sanitize(text: string): string {
  let clean = text;
  for (const pattern of SECRET_PATTERNS) {
    clean = clean.replace(pattern, '[REDACTED_SECRET]');
  }
  return clean;
}

export function getEnrichedContext(customFailuresPath?: string): EnrichedContext | null {
  const root = process.cwd();
  const filePath = customFailuresPath || path.resolve(root, '.rootcause/failures.json');

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const rawFailures: RawFailure[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (rawFailures.length === 0) return null;

  // 1. Sanitize failures and isolate relevant stack trace lines
  const failures = rawFailures.map((f) => ({
    title: f.title,
    file: f.file.replace(root, '').replace(/^[\\\/]/, ''),
    line: f.line,
    errorMessage: sanitize(f.errorMessage),
    stackSnippet: sanitize(
      f.errorStack
        .split('\n')
        .filter((line) => !line.includes('node_modules') && !line.includes('internal/process'))
        .slice(0, 8)
        .join('\n')
    ),
  }));

  // 2. Fetch git diff against origin/main or previous commit
  let gitDiff = 'No recent git diff available.';
  try {
    let baseRef = 'origin/main';
    try {
      execSync('git rev-parse --verify origin/main', { stdio: 'ignore' });
    } catch {
      baseRef = 'HEAD~1';
    }
    const diff = execSync(`git diff -U2 ${baseRef}...HEAD -- "src/**" "automation/**"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    if (diff.trim().length > 0) {
      gitDiff = sanitize(diff.slice(0, 8000));
    }
  } catch {
    // If not in a git repo or no upstream, fallback cleanly
  }

  return { failures, gitDiff };
}
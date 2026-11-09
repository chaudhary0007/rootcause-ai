# RootCause-AI: Autonomous CI/CD Failure Triage Engine

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![Playwright](https://img.shields.io/badge/Playwright-v1.49+-45ba4b?style=flat&logo=playwright)](https://playwright.dev/)
[![LLM Backend](https://img.shields.io/badge/Model-Gemini_Flash_Cascade-orange?style=flat&logo=google)](https://ai.google.dev/)
[![Validation](https://img.shields.io/badge/Schema-Zod-3E67B1?style=flat&logo=zod)](https://zod.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An enterprise-grade, autonomous test failure triage and Root-Cause Analysis (RCA) bot for CI/CD pipelines. RootCause-AI captures Playwright execution failures, aggregates runtime code frames with sanitized PR Git diffs, and leverages an LLM cascade via Google Gemini with strict Zod schema enforcement to categorize root causes, pinpoint culprit files, and post remediation patches directly to GitHub Pull Requests.

---

## 🎯 The Problem

In high-velocity engineering teams running hundreds of tests on every Pull Request, test failures are frequent. QA and Software Development Engineers spend hours every week answering three questions:
1. *Did the developer introduce a functional regression?*
2. *Did a UI refactor break a test selector (locator churn)?*
3. *Did the staging environment, test runner, or network time out?*

RootCause-AI automates this entire diagnosis loop, reducing mean time to triage (MTTT) from 20 minutes per failure to under 3 seconds.

---

## 🔬 Classification Matrix

| Category | Root Cause Trigger | Automated Resolution |
| :--- | :--- | :--- |
| **`PRODUCT_REGRESSION`** | PR code changes broke existing business logic or API contracts. | Flags regression; identifies culprit file/line; blocks merge. |
| **`LOCATOR_CHURN`** | DOM attributes mutated (`data-test`, IDs, class changes), breaking selectors. | Identifies mutated selector; proposes unified code diff patch. |
| **`FLAKY_ENVIRONMENT`** | Transient network hiccups, 504 timeouts, or test runner resource contention. | Flags transient failure; recommends CI retry without code changes. |
| **`TEST_DATA_DEFECT`** | Expired JWT tokens, invalid mocks, or missing database seeds. | Pinpoints stale fixture or mock payload for updating. |

---

## 🏗️ Architecture & Pipeline Flow

```
                      [ GitHub Pull Request Opened / Updated ]
                                         │
                                         ▼
                     [ GitHub Actions: Playwright Test Runner ]
                                         │
                                         ▼ (On Failure)
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Telemetry Collector (Playwright Custom Reporter)                         │
│    - Intercepts failed & timed-out tests in real time                      │
│    - Extracts title, file, line number, error code frame, and stack trace   │
│    - Writes failure ledger to .rootcause/failures.json                      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. Context Enrichment & Credential Sanitizer                                │
│    - Extracts git diff (git diff origin/main...HEAD)                        │
│    - Excludes lockfiles, assets, and token-bloat files                      │
│    - Redacts secrets (JWTs, Bearer tokens, API keys) via regex patterns    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. LLM Reasoning Engine with Multi-Model Fallback Cascade                   │
│    - High-demand resilient fallback: Gemini 3.8 Flash ➔ 2.0 Flash ➔ 1.5     │
│    - Exponential backoff retry handler (mitigating 503/429 spikes)          │
│    - Strict JSON output validated at runtime via Zod schemas                │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. Autonomous Notification Dispatcher                                       │
│    - Octokit checks for existing bot comments (updates in-place vs. spam)   │
│    - Formats markdown summary table and code patch diff                     │
│    - Appends triage report to GitHub Actions Job Summary ($GITHUB_STEP_SUMMARY)│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 Repository Structure

```text
rootcause-ai/
├── .github/
│   └── workflows/
│       └── rca.yml              # CI/CD pipeline triggered on Pull Requests
├── src/
│   ├── core/
│   │   ├── enricher.ts          # Git diff extractor & regex secret sanitizer
│   │   └── triageEngine.ts      # Multi-model LLM engine with retry logic
│   ├── github/
│   │   └── prCommenter.ts       # Octokit PR commenter & Job Summary builder
│   ├── reporters/
│   │   └── playwrightReporter.ts# Custom Playwright Reporter intercepting failures
│   ├── schema/
│   │   └── triageSchema.ts      # Zod schema enforcing deterministic JSON outputs
│   └── index.ts                 # CLI entry point orchestrating context & dispatch
├── tests/
│   └── demo/
│       └── checkout-regression.spec.ts # Sample test with intentional locator churn
├── .env.example
├── .gitignore
├── package.json
├── playwright.config.ts
└── tsconfig.json
```

---

## 🚀 Getting Started

### Prerequisites
* **Node.js**: `v20.x` or higher
* **npm**: `v9.x` or higher
* **Gemini API Key**: Free API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

### 1. Installation
```bash
git clone [https://github.com/chaudhary0007/rootcause-ai.git](https://github.com/chaudhary0007/rootcause-ai.git)
cd rootcause-ai
npm install
npx playwright install chromium
```

### 2. Configure Environment Variables
Create a `.env` file in the project root:
```env
GEMINI_API_KEY=your_actual_gemini_api_key_here
```

### 3. Run Tests & Automated Triage Locally
Execute the Playwright test suite and trigger triage on failure:
```bash
npm run test:triage
```

Or run triage independently against existing failure telemetry:
```bash
npm run triage
```

---

## 🤖 Sample Pull Request Output

When a test fails in a GitHub Pull Request, RootCause-AI posts the following formatted comment:

---

### 🤖 RootCause-AI Triage Report

| Classification | Confidence | Origin | Culprit File |
| :--- | :--- | :--- | :--- |
| 🟡 **LOCATOR CHURN** | `96%` | `TEST_CODE` | `tests/demo/checkout-regression.spec.ts:16` |

> **Add-to-cart submit button timed out waiting for mutated locator.**

#### 🔍 Diagnostic Analysis
The test timed out after 3000ms attempting to click `[data-test="add-to-cart-sauce-labs-backpack-MUTATED_V2"]`. Comparing with the active checkout page DOM, the button retains the standard identifier. The selector change in the test code introduced an artificial failure.

#### 🛠️ Recommended Remediation
Revert the locator to the canonical SauceDemo test attribute.

```diff
- await checkoutButton.click({ timeout: 3000 });
+ await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();
```

---
*Automated triage executed in 1.4s via Gemini Flash • [RootCause-AI](https://github.com/chaudhary0007/rootcause-ai)*

---

## 📄 License
This project is licensed under the MIT License.
import { test, expect } from '@playwright/test';

test.describe('E-Commerce Checkout Regression Demo', () => {
  test('User attempts checkout with modified submit locator', async ({ page }) => {
    await page.goto('https://www.saucedemo.com/');

    // Log in
    await page.locator('[data-test="username"]').fill('standard_user');
    await page.locator('[data-test="password"]').fill('secret_sauce');
    await page.locator('[data-test="login-button"]').click();

    // Intentional break: simulated churned locator that does not exist
    const checkoutButton = page.locator('[data-test="add-to-cart-sauce-labs-backpack-MUTATED_V2"]');
    
    // Set a fast 3-second timeout so the test fails promptly for triage demo
    await checkoutButton.click({ timeout: 3000 });

    await expect(page.locator('.shopping_cart_badge')).toHaveText('1');
  });
});
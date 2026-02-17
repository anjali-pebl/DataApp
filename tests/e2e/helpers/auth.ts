import { Page } from '@playwright/test';

export async function signInTestUser(page: Page) {
  // Navigate to auth page
  await page.goto('http://localhost:9002/auth');
  await page.waitForLoadState('networkidle');

  // Check if we're already signed in
  const signOutButton = page.locator('text=/sign out/i');
  if (await signOutButton.isVisible()) {
    console.log('Already signed in');
    return;
  }

  // Fill in test credentials (adjust these to match your test user)
  const emailInput = page.locator('input[type="email"]');
  const passwordInput = page.locator('input[type="password"]');

  await emailInput.fill('test@test.com'); // Replace with your test user email
  await passwordInput.fill('testpassword123'); // Replace with your test user password

  // Click sign in button
  const signInButton = page.getByRole('button', { name: /sign in/i });
  await signInButton.click();

  // Wait for redirect to home page
  await page.waitForURL('**/data-explorer', { timeout: 10000 });

  console.log('✓ Signed in successfully');
}

export async function signOutTestUser(page: Page) {
  // Navigate to home
  await page.goto('http://localhost:9002');
  await page.waitForLoadState('networkidle');

  // Click sign out if present
  const signOutButton = page.locator('text=/sign out/i');
  if (await signOutButton.isVisible()) {
    await signOutButton.click();
    console.log('✓ Signed out successfully');
  }
}

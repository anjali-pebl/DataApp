import { test, expect } from '@playwright/test';
import path from 'path';
import { signInTestUser } from './helpers/auth';

const TEST_VIDEO_PATH = String.raw`G:\.shortcut-targets-by-id\1QkmI63Nho2bLYjVC4vWXRdDRruEV5-Zl\Ocean\08 - Data\01 - SubCam data\Alga\2025 Q3\Subcam_Alga_Control_2506-2508-benthic\algapelago_1_2025-06-20_12-00-47.mp4`;

test.describe('Motion Analysis Processing', () => {
  test.beforeEach(async ({ page }) => {
    // Sign in first (required for API access)
    try {
      await signInTestUser(page);
    } catch (error) {
      console.warn('Failed to sign in - tests may fail:', error);
    }

    // Navigate to motion analysis page
    await page.goto('http://localhost:9002/motion-analysis');
    await page.waitForLoadState('networkidle');
  });

  test('should upload video and show pending status', async ({ page }) => {
    console.log('Step 1: Uploading video...');

    // Find the file input
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached();

    // Upload video
    await fileInput.setInputFiles(TEST_VIDEO_PATH);

    // Wait for upload to complete (look for pending videos message)
    await page.waitForSelector('text=/video.*awaiting processing/i', { timeout: 30000 });
    console.log('✓ Video uploaded successfully');

    // Verify pending video appears in the message
    const pendingMessage = page.locator('text=/video.*awaiting processing/i');
    await expect(pendingMessage).toBeVisible();

    // Check if "Run Processing" button appears
    const runButton = page.getByRole('button', { name: /Run Processing/i });
    await expect(runButton).toBeVisible();
    console.log('✓ Run Processing button is visible');
  });

  test('should show estimation modal with hardware detection', async ({ page }) => {
    console.log('Step 1: Upload video...');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(TEST_VIDEO_PATH);
    await page.waitForSelector('text=/video.*awaiting processing/i', { timeout: 30000 });

    console.log('Step 2: Click Run Processing...');
    const runButton = page.getByRole('button', { name: /Run Processing/i });
    await runButton.click();

    // Wait for modal to appear
    await page.waitForSelector('text=Process Videos', { timeout: 5000 });
    console.log('✓ Estimation modal opened');

    // Wait for hardware detection to complete
    await page.waitForSelector('text=Calculating estimates...', { timeout: 2000 });
    console.log('⏳ Hardware detection in progress...');

    // Wait for estimates to appear
    await page.waitForSelector('text=Local Processing', { timeout: 10000 });
    console.log('✓ Hardware detection complete');

    // Verify all three processing options are shown
    await expect(page.locator('text=Local Processing')).toBeVisible();
    await expect(page.locator('text=Modal T4 GPU')).toBeVisible();
    await expect(page.locator('text=Modal A10G GPU')).toBeVisible();
    console.log('✓ All processing options visible');

    // Check for hardware info
    const hardwareInfo = page.locator('text=/CPU.*cores/i');
    await expect(hardwareInfo).toBeVisible();
    console.log('✓ Hardware info displayed');

    // Verify at least one option shows estimates
    const timeEstimate = page.locator('text=/Time/i').first();
    await expect(timeEstimate).toBeVisible();
    console.log('✓ Time estimates displayed');
  });

  test('should start local processing and show status panel', async ({ page }) => {
    console.log('Step 1: Upload video...');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(TEST_VIDEO_PATH);
    await page.waitForSelector('text=/video.*awaiting processing/i', { timeout: 30000 });

    console.log('Step 2: Open estimation modal...');
    const runButton = page.getByRole('button', { name: /Run Processing/i });
    await runButton.click();
    await page.waitForSelector('text=Process Videos', { timeout: 5000 });

    // Wait for estimates
    await page.waitForSelector('text=Local Processing', { timeout: 10000 });
    console.log('✓ Estimates loaded');

    console.log('Step 3: Start local processing...');
    // Click "Start Processing" button for Local option
    const localSection = page.locator('text=Local Processing').locator('..');
    const startButton = localSection.getByRole('button', { name: /Start Processing/i });
    await startButton.click();

    // Wait for modal to close
    await page.waitForSelector('text=Process Videos', { state: 'hidden', timeout: 5000 });
    console.log('✓ Processing started');

    // Check for status panel
    console.log('Step 4: Waiting for status panel...');
    await page.waitForSelector('text=/Processing/i', { timeout: 5000 });

    // Verify status panel shows progress
    const statusPanel = page.locator('text=/Processing Videos/i').first();
    await expect(statusPanel).toBeVisible({ timeout: 10000 });
    console.log('✓ Status panel visible');

    // Check for progress bar
    const progressBar = page.locator('[style*="width"]').filter({ hasText: /\d+%/ });
    await expect(progressBar.first()).toBeVisible({ timeout: 5000 });
    console.log('✓ Progress bar visible');

    // Check for video count
    const videoCount = page.locator('text=/videos processed/i');
    await expect(videoCount).toBeVisible();
    console.log('✓ Video count displayed');

    // Monitor for completion (with timeout)
    console.log('⏳ Monitoring processing status...');
    const maxWaitTime = 120000; // 2 minutes max
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const completedText = page.locator('text=/Processing Complete/i');
      const isComplete = await completedText.isVisible();

      if (isComplete) {
        console.log('✓ Processing completed!');
        break;
      }

      // Wait a bit before checking again
      await page.waitForTimeout(2000);

      // Log current progress
      const progressText = await page.locator('text=/\d+ \/ \d+ videos processed/i').textContent();
      if (progressText) {
        console.log(`  Current progress: ${progressText}`);
      }
    }
  });

  test('should start Modal T4 processing', async ({ page }) => {
    console.log('Step 1: Upload video...');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(TEST_VIDEO_PATH);
    await page.waitForSelector('text=/video.*awaiting processing/i', { timeout: 30000 });

    console.log('Step 2: Open estimation modal...');
    const runButton = page.getByRole('button', { name: /Run Processing/i });
    await runButton.click();
    await page.waitForSelector('text=Process Videos', { timeout: 5000 });

    // Wait for estimates
    await page.waitForSelector('text=Modal T4 GPU', { timeout: 10000 });
    console.log('✓ Estimates loaded');

    console.log('Step 3: Start Modal T4 processing...');
    // Click "Start Processing" button for Modal T4 option
    const modalSection = page.locator('text=Modal T4 GPU').locator('..');
    const startButton = modalSection.getByRole('button', { name: /Start Processing/i });
    await startButton.click();

    // Wait for modal to close
    await page.waitForSelector('text=Process Videos', { state: 'hidden', timeout: 5000 });
    console.log('✓ Modal T4 processing started');

    // Check for status panel
    console.log('Step 4: Waiting for status panel...');
    const statusPanel = page.locator('text=/Processing Videos/i').first();
    await expect(statusPanel).toBeVisible({ timeout: 10000 });
    console.log('✓ Status panel visible');

    // Verify run type is shown
    const runType = page.locator('text=/Modal T4 GPU/i');
    await expect(runType).toBeVisible();
    console.log('✓ Run type displayed correctly');
  });

  test('should handle errors gracefully', async ({ page }) => {
    console.log('Testing error handling...');

    // Try to click Run Processing without uploading a video
    const runButton = page.getByRole('button', { name: /Run Processing/i });

    // Button should not be visible if no pending videos
    const isVisible = await runButton.isVisible();
    expect(isVisible).toBe(false);
    console.log('✓ Run Processing button hidden when no pending videos');
  });

  test('should show console logs from Python script', async ({ page }) => {
    // Listen for console messages from the page
    const logs: string[] = [];
    page.on('console', (msg) => {
      logs.push(msg.text());
    });

    console.log('Step 1: Upload video...');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(TEST_VIDEO_PATH);
    await page.waitForSelector('text=/video.*awaiting processing/i', { timeout: 30000 });

    console.log('Step 2: Start processing...');
    const runButton = page.getByRole('button', { name: /Run Processing/i });
    await runButton.click();
    await page.waitForSelector('text=Local Processing', { timeout: 10000 });

    const localSection = page.locator('text=Local Processing').locator('..');
    const startButton = localSection.getByRole('button', { name: /Start Processing/i });
    await startButton.click();

    // Wait a bit for processing to start
    await page.waitForTimeout(5000);

    // Check if we got any processing-related logs
    const processingLogs = logs.filter((log) =>
      log.includes('Started processing run') || log.includes('Processing')
    );

    console.log(`Captured ${logs.length} total logs`);
    console.log(`Processing-related logs: ${processingLogs.length}`);

    if (processingLogs.length > 0) {
      console.log('Sample logs:', processingLogs.slice(0, 3));
    }
  });
});

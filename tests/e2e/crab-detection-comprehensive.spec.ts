import { test, expect, Page } from '@playwright/test';

/**
 * Comprehensive Crab Detection Testing Suite
 *
 * Test Coverage:
 * 1. UI Components (CrabDetectionSettingsDialog, ProcessingEstimationModal)
 * 2. API Endpoints (crab-params, crab-detections)
 * 3. Database Integration (presets, RLS policies)
 * 4. End-to-End Workflow (enable → configure → process → view results)
 *
 * Metrics Tracked:
 * - Component render times
 * - API response times
 * - Data persistence accuracy
 * - User interaction responsiveness
 */

// Test configuration
const BASE_URL = 'http://localhost:9002';
const API_TIMEOUT = 10000;
const UI_TIMEOUT = 5000;

// Test metrics storage
const testMetrics = {
  totalTests: 0,
  passedTests: 0,
  failedTests: 0,
  skippedTests: 0,
  testDurations: [] as number[],
  apiResponseTimes: [] as number[],
  uiRenderTimes: [] as number[],
  errors: [] as string[],
};

// Helper to track test metrics
function recordTestResult(passed: boolean, duration: number, testName: string, error?: string) {
  testMetrics.totalTests++;
  if (passed) {
    testMetrics.passedTests++;
  } else {
    testMetrics.failedTests++;
    if (error) testMetrics.errors.push(`${testName}: ${error}`);
  }
  testMetrics.testDurations.push(duration);
}

// Helper to measure API response time
async function measureApiCall(page: Page, url: string, method: 'GET' | 'POST' = 'GET', body?: any): Promise<{ status: number; data: any; responseTime: number }> {
  const startTime = Date.now();
  const response = await page.request[method.toLowerCase() as 'get' | 'post'](url, body ? { data: body } : undefined);
  const responseTime = Date.now() - startTime;
  testMetrics.apiResponseTimes.push(responseTime);
  const data = await response.json();
  return { status: response.status(), data, responseTime };
}

// Helper to measure UI render time
async function measureUIRender(page: Page, selector: string, timeout: number = UI_TIMEOUT): Promise<number> {
  const startTime = Date.now();
  await page.waitForSelector(selector, { timeout });
  const renderTime = Date.now() - startTime;
  testMetrics.uiRenderTimes.push(renderTime);
  return renderTime;
}

test.describe('Crab Detection - Comprehensive Test Suite', () => {

  test.beforeEach(async ({ page }) => {
    // Navigate to motion analysis page
    await page.goto(`${BASE_URL}/motion-analysis`);
    await page.waitForLoadState('networkidle');
  });

  test.describe('1. Database & API Tests', () => {

    test('1.1 Verify crab_detection_params table exists and has presets', async ({ page }) => {
      const testStart = Date.now();
      let passed = false;
      let error = '';

      try {
        const result = await measureApiCall(page, `${BASE_URL}/api/motion-analysis/crab-params`, 'GET');

        expect(result.status).toBe(200);
        expect(result.data.success).toBe(true);
        expect(result.data.params).toBeDefined();
        expect(Array.isArray(result.data.params)).toBe(true);

        // Verify presets exist
        const presets = result.data.params.filter((p: any) => p.is_preset);
        expect(presets.length).toBeGreaterThanOrEqual(3);

        // Verify preset names
        const presetNames = presets.map((p: any) => p.name);
        expect(presetNames).toContain('Conservative');
        expect(presetNames).toContain('Balanced');
        expect(presetNames).toContain('Aggressive');

        // Verify preset parameters
        const balanced = presets.find((p: any) => p.name === 'Balanced');
        expect(balanced.threshold).toBe(30);
        expect(balanced.min_area).toBe(30);
        expect(balanced.max_area).toBe(2000);

        console.log(`✓ API Response Time: ${result.responseTime}ms`);
        console.log(`✓ Presets Found: ${presets.length}`);
        passed = true;
      } catch (e) {
        error = (e as Error).message;
        throw e;
      } finally {
        recordTestResult(passed, Date.now() - testStart, '1.1 Database Presets', error);
      }
    });

    test('1.2 Verify POST endpoint can save custom parameter sets', async ({ page }) => {
      const testStart = Date.now();
      let passed = false;
      let error = '';

      try {
        const customParams = {
          name: `Test_${Date.now()}`,
          params: {
            threshold: 25,
            min_area: 50,
            max_area: 8000,
            min_circularity: 0.2,
            max_aspect_ratio: 4.0,
            morph_kernel_size: 5,
            max_distance: 50.0,
            max_skip_frames: 5,
            min_track_length: 3,
            min_displacement: 5.0,
            min_speed: 0.05,
            max_speed: 100.0,
          }
        };

        const result = await measureApiCall(
          page,
          `${BASE_URL}/api/motion-analysis/crab-params`,
          'POST',
          customParams
        );

        expect(result.status).toBe(200);
        expect(result.data.success).toBe(true);
        expect(result.data.params).toBeDefined();
        expect(result.data.params.name).toBe(customParams.name);
        expect(result.data.params.threshold).toBe(customParams.params.threshold);

        console.log(`✓ Custom Params Saved: ${result.data.params.id}`);
        console.log(`✓ API Response Time: ${result.responseTime}ms`);
        passed = true;
      } catch (e) {
        error = (e as Error).message;
        throw e;
      } finally {
        recordTestResult(passed, Date.now() - testStart, '1.2 Save Custom Params', error);
      }
    });

    test('1.3 Verify crab-detections endpoint structure', async ({ page }) => {
      const testStart = Date.now();
      let passed = false;
      let error = '';

      try {
        // This will return empty results if no videos processed, but validates endpoint exists
        const result = await measureApiCall(
          page,
          `${BASE_URL}/api/motion-analysis/crab-detections?videoId=test-video-id`,
          'GET'
        );

        // Endpoint should return 200 even with no results
        expect(result.status).toBe(200);
        expect(result.data).toBeDefined();

        console.log(`✓ Crab Detections Endpoint: ${result.status}`);
        console.log(`✓ API Response Time: ${result.responseTime}ms`);
        passed = true;
      } catch (e) {
        error = (e as Error).message;
        throw e;
      } finally {
        recordTestResult(passed, Date.now() - testStart, '1.3 Detections Endpoint', error);
      }
    });
  });

  test.describe('2. UI Component Tests', () => {

    test('2.1 ProcessingEstimationModal renders with crab detection option', async ({ page }) => {
      const testStart = Date.now();
      let passed = false;
      let error = '';

      try {
        // Look for "Process Videos" button
        const processButton = page.locator('button:has-text("Process Videos")');
        await processButton.waitFor({ state: 'visible', timeout: UI_TIMEOUT });

        const renderTime = await measureUIRender(page, 'button:has-text("Process Videos")');
        console.log(`✓ Process Button Render Time: ${renderTime}ms`);

        // Click to open modal
        await processButton.click();

        // Wait for modal to appear
        await page.waitForSelector('text=Cloud GPU', { timeout: UI_TIMEOUT });

        // Expand settings
        const settingsButton = page.locator('button[title*="settings"], button:has(svg)').first();
        await settingsButton.click();

        // Verify crab detection checkbox exists
        const crabCheckbox = page.locator('text=Crab Detection');
        await crabCheckbox.waitFor({ state: 'visible', timeout: UI_TIMEOUT });

        console.log('✓ Crab Detection checkbox visible');
        passed = true;
      } catch (e) {
        error = (e as Error).message;
        throw e;
      } finally {
        recordTestResult(passed, Date.now() - testStart, '2.1 Modal Renders', error);
      }
    });

    test('2.2 CrabDetectionSettingsDialog opens and renders correctly', async ({ page }) => {
      const testStart = Date.now();
      let passed = false;
      let error = '';

      try {
        // Open processing modal
        await page.click('button:has-text("Process Videos")');
        await page.waitForSelector('text=Cloud GPU', { timeout: UI_TIMEOUT });

        // Expand settings
        const settingsButton = page.locator('button').filter({ has: page.locator('svg') }).first();
        await settingsButton.click();

        // Enable crab detection
        const crabCheckbox = page.locator('input[type="checkbox"]').filter({ has: page.locator('~ span:has-text("Crab Detection")') });
        await crabCheckbox.check();

        // Click sliders button to open settings dialog
        const slidersButton = page.locator('button[title*="Configure crab detection"]');
        await slidersButton.waitFor({ state: 'visible', timeout: UI_TIMEOUT });

        const clickTime = Date.now();
        await slidersButton.click();

        // Wait for dialog to open
        await page.waitForSelector('text=Crab Detection Settings', { timeout: UI_TIMEOUT });
        const dialogRenderTime = Date.now() - clickTime;
        testMetrics.uiRenderTimes.push(dialogRenderTime);

        // Verify preset buttons exist
        await expect(page.locator('button:has-text("Conservative")')).toBeVisible();
        await expect(page.locator('button:has-text("Balanced")')).toBeVisible();
        await expect(page.locator('button:has-text("Aggressive")')).toBeVisible();

        // Verify parameter sections exist
        await expect(page.locator('text=Blob Detection')).toBeVisible();
        await expect(page.locator('text=Tracking')).toBeVisible();
        await expect(page.locator('text=Track Validation')).toBeVisible();

        console.log(`✓ Settings Dialog Render Time: ${dialogRenderTime}ms`);
        console.log('✓ All preset buttons visible');
        console.log('✓ All parameter sections visible');
        passed = true;
      } catch (e) {
        error = (e as Error).message;
        throw e;
      } finally {
        recordTestResult(passed, Date.now() - testStart, '2.2 Settings Dialog Renders', error);
      }
    });

    test('2.3 Preset buttons update parameter values correctly', async ({ page }) => {
      const testStart = Date.now();
      let passed = false;
      let error = '';

      try {
        // Open processing modal → settings → crab detection dialog
        await page.click('button:has-text("Process Videos")');
        await page.waitForSelector('text=Cloud GPU');

        const settingsBtn = page.locator('button').filter({ has: page.locator('svg') }).first();
        await settingsBtn.click();

        const crabCheckbox = page.locator('input[type="checkbox"]').filter({ has: page.locator('~ span:has-text("Crab Detection")') });
        await crabCheckbox.check();

        const slidersBtn = page.locator('button[title*="Configure crab detection"]');
        await slidersBtn.click();
        await page.waitForSelector('text=Crab Detection Settings');

        // Click Balanced preset
        await page.click('button:has-text("Balanced")');
        await page.waitForTimeout(500); // Wait for state update

        // Verify threshold value updated (Balanced = 30)
        const thresholdValue = page.locator('label:has-text("Threshold") ~ span').first();
        const thresholdText = await thresholdValue.textContent();
        expect(thresholdText).toContain('30');

        // Click Conservative preset
        await page.click('button:has-text("Conservative")');
        await page.waitForTimeout(500);

        // Verify threshold changed (Conservative = 35)
        const conservativeThreshold = await thresholdValue.textContent();
        expect(conservativeThreshold).toContain('35');

        console.log('✓ Balanced preset: threshold = 30');
        console.log('✓ Conservative preset: threshold = 35');
        console.log('✓ Preset switching works correctly');
        passed = true;
      } catch (e) {
        error = (e as Error).message;
        throw e;
      } finally {
        recordTestResult(passed, Date.now() - testStart, '2.3 Preset Switching', error);
      }
    });

    test('2.4 Parameter sliders are interactive and update values', async ({ page }) => {
      const testStart = Date.now();
      let passed = false;
      let error = '';

      try {
        // Navigate to settings dialog
        await page.click('button:has-text("Process Videos")');
        await page.waitForSelector('text=Cloud GPU');

        const settingsBtn = page.locator('button').filter({ has: page.locator('svg') }).first();
        await settingsBtn.click();

        const crabCheckbox = page.locator('input[type="checkbox"]').filter({ has: page.locator('~ span:has-text("Crab Detection")') });
        await crabCheckbox.check();

        const slidersBtn = page.locator('button[title*="Configure crab detection"]');
        await slidersBtn.click();
        await page.waitForSelector('text=Crab Detection Settings');

        // Find threshold slider
        const thresholdSlider = page.locator('input[type="range"]').first();

        // Get initial value
        const initialValue = await thresholdSlider.inputValue();
        console.log(`✓ Initial slider value: ${initialValue}`);

        // Move slider to middle of range
        await thresholdSlider.fill('30');
        await page.waitForTimeout(200);

        // Verify value changed
        const newValue = await thresholdSlider.inputValue();
        expect(newValue).toBe('30');

        console.log(`✓ Slider updated to: ${newValue}`);
        console.log('✓ Slider interaction works');
        passed = true;
      } catch (e) {
        error = (e as Error).message;
        throw e;
      } finally {
        recordTestResult(passed, Date.now() - testStart, '2.4 Slider Interaction', error);
      }
    });
  });

  test.describe('3. Dashboard Display Tests', () => {

    test('3.1 Dashboard table has Crab Detection column', async ({ page }) => {
      const testStart = Date.now();
      let passed = false;
      let error = '';

      try {
        // Wait for table to load
        await page.waitForSelector('table thead', { timeout: UI_TIMEOUT });

        // Verify "Crab Detections" column header exists
        const crabHeader = page.locator('th:has-text("Crab Detections")');
        await crabHeader.waitFor({ state: 'visible', timeout: UI_TIMEOUT });

        // Verify tooltip exists
        const tooltip = await crabHeader.getAttribute('title');
        expect(tooltip).toContain('blob');

        console.log('✓ Crab Detections column visible');
        console.log(`✓ Column tooltip: "${tooltip}"`);
        passed = true;
      } catch (e) {
        error = (e as Error).message;
        throw e;
      } finally {
        recordTestResult(passed, Date.now() - testStart, '3.1 Dashboard Column', error);
      }
    });

    test('3.2 Table rows display crab detection data or placeholder', async ({ page }) => {
      const testStart = Date.now();
      let passed = false;
      let error = '';

      try {
        // Wait for table body
        await page.waitForSelector('table tbody tr', { timeout: UI_TIMEOUT });

        // Get first row
        const firstRow = page.locator('table tbody tr').first();

        // Find crab detection cell (should be 6th td if checkbox is present, 5th otherwise)
        const crabCell = firstRow.locator('td').nth(5);

        // Should either show sparkline or "Not processed"
        const cellContent = await crabCell.textContent();
        const hasSparkline = await crabCell.locator('svg, canvas').count() > 0;
        const hasPlaceholder = cellContent?.includes('Not processed') || cellContent?.includes('—');

        expect(hasSparkline || hasPlaceholder).toBe(true);

        console.log('✓ Crab detection cell renders correctly');
        console.log(`✓ Cell shows: ${hasSparkline ? 'Sparkline' : 'Placeholder'}`);
        passed = true;
      } catch (e) {
        error = (e as Error).message;
        throw e;
      } finally {
        recordTestResult(passed, Date.now() - testStart, '3.2 Table Cell Display', error);
      }
    });
  });

  test.describe('4. Integration & Performance Tests', () => {

    test('4.1 Full workflow: Enable crab detection in processing modal', async ({ page }) => {
      const testStart = Date.now();
      let passed = false;
      let error = '';

      try {
        // Open modal
        await page.click('button:has-text("Process Videos")');
        await page.waitForSelector('text=Cloud GPU');

        // Expand settings
        const settingsBtn = page.locator('button').filter({ has: page.locator('svg') }).first();
        await settingsBtn.click();

        // Enable all three analysis types
        const motionCheckbox = page.locator('text=Motion Analysis').locator('input[type="checkbox"]');
        const yoloCheckbox = page.locator('text=YOLO Detection').locator('input[type="checkbox"]');
        const crabCheckbox = page.locator('text=Crab Detection').locator('input[type="checkbox"]');

        await motionCheckbox.check();
        await yoloCheckbox.check();
        await crabCheckbox.check();

        // Verify all are checked
        expect(await motionCheckbox.isChecked()).toBe(true);
        expect(await yoloCheckbox.isChecked()).toBe(true);
        expect(await crabCheckbox.isChecked()).toBe(true);

        // Verify sliders button appears
        const slidersBtn = page.locator('button[title*="Configure crab detection"]');
        await expect(slidersBtn).toBeVisible();

        console.log('✓ All analysis types enabled');
        console.log('✓ Crab settings button visible');
        passed = true;
      } catch (e) {
        error = (e as Error).message;
        throw e;
      } finally {
        recordTestResult(passed, Date.now() - testStart, '4.1 Full Workflow', error);
      }
    });

    test('4.2 Measure total UI interaction responsiveness', async ({ page }) => {
      const testStart = Date.now();
      let passed = false;
      let error = '';

      try {
        const interactions: { action: string; time: number }[] = [];

        // Measure: Click process button
        let t0 = Date.now();
        await page.click('button:has-text("Process Videos")');
        await page.waitForSelector('text=Cloud GPU');
        interactions.push({ action: 'Open Modal', time: Date.now() - t0 });

        // Measure: Expand settings
        t0 = Date.now();
        const settingsBtn = page.locator('button').filter({ has: page.locator('svg') }).first();
        await settingsBtn.click();
        await page.waitForTimeout(200);
        interactions.push({ action: 'Expand Settings', time: Date.now() - t0 });

        // Measure: Enable crab detection
        t0 = Date.now();
        const crabCheckbox = page.locator('text=Crab Detection').locator('input[type="checkbox"]');
        await crabCheckbox.check();
        await page.waitForTimeout(200);
        interactions.push({ action: 'Enable Crab Detection', time: Date.now() - t0 });

        // Measure: Open settings dialog
        t0 = Date.now();
        const slidersBtn = page.locator('button[title*="Configure crab detection"]');
        await slidersBtn.click();
        await page.waitForSelector('text=Crab Detection Settings');
        interactions.push({ action: 'Open Settings Dialog', time: Date.now() - t0 });

        // Measure: Click preset
        t0 = Date.now();
        await page.click('button:has-text("Balanced")');
        await page.waitForTimeout(200);
        interactions.push({ action: 'Click Preset', time: Date.now() - t0 });

        // Calculate average interaction time
        const avgTime = interactions.reduce((sum, i) => sum + i.time, 0) / interactions.length;

        // All interactions should be under 1 second
        interactions.forEach(i => {
          expect(i.time).toBeLessThan(1000);
        });

        console.log('\n=== UI Responsiveness ===');
        interactions.forEach(i => {
          console.log(`  ${i.action}: ${i.time}ms`);
        });
        console.log(`  Average: ${avgTime.toFixed(0)}ms`);
        console.log('========================\n');

        passed = true;
      } catch (e) {
        error = (e as Error).message;
        throw e;
      } finally {
        recordTestResult(passed, Date.now() - testStart, '4.2 UI Responsiveness', error);
      }
    });
  });

  // Final metrics report
  test.afterAll(async () => {
    console.log('\n' + '='.repeat(80));
    console.log('CRAB DETECTION TEST SUITE - FINAL REPORT');
    console.log('='.repeat(80));

    // Calculate statistics
    const avgTestDuration = testMetrics.testDurations.reduce((a, b) => a + b, 0) / testMetrics.testDurations.length;
    const avgApiResponse = testMetrics.apiResponseTimes.length > 0
      ? testMetrics.apiResponseTimes.reduce((a, b) => a + b, 0) / testMetrics.apiResponseTimes.length
      : 0;
    const avgUiRender = testMetrics.uiRenderTimes.length > 0
      ? testMetrics.uiRenderTimes.reduce((a, b) => a + b, 0) / testMetrics.uiRenderTimes.length
      : 0;

    const passRate = (testMetrics.passedTests / testMetrics.totalTests) * 100;

    console.log('\n📊 TEST SUMMARY:');
    console.log(`  Total Tests: ${testMetrics.totalTests}`);
    console.log(`  ✓ Passed: ${testMetrics.passedTests}`);
    console.log(`  ✗ Failed: ${testMetrics.failedTests}`);
    console.log(`  ⊘ Skipped: ${testMetrics.skippedTests}`);
    console.log(`  Pass Rate: ${passRate.toFixed(1)}%`);

    console.log('\n⏱️  PERFORMANCE METRICS:');
    console.log(`  Avg Test Duration: ${avgTestDuration.toFixed(0)}ms`);
    console.log(`  Avg API Response: ${avgApiResponse.toFixed(0)}ms`);
    console.log(`  Avg UI Render: ${avgUiRender.toFixed(0)}ms`);

    if (testMetrics.errors.length > 0) {
      console.log('\n❌ ERRORS:');
      testMetrics.errors.forEach((err, i) => {
        console.log(`  ${i + 1}. ${err}`);
      });
    }

    // Score calculation
    let score = 0;
    score += Math.min(passRate, 100); // Up to 100 points for pass rate
    score += avgApiResponse < 1000 ? 20 : avgApiResponse < 2000 ? 10 : 0; // Up to 20 for API speed
    score += avgUiRender < 500 ? 20 : avgUiRender < 1000 ? 10 : 0; // Up to 20 for UI speed
    score += testMetrics.failedTests === 0 ? 10 : 0; // Bonus for no failures

    console.log('\n🎯 OVERALL SCORE:');
    console.log(`  ${score.toFixed(0)} / 150`);
    console.log(`  Grade: ${score >= 130 ? 'A+' : score >= 110 ? 'A' : score >= 90 ? 'B' : score >= 70 ? 'C' : 'D'}`);

    console.log('\n' + '='.repeat(80) + '\n');
  });
});

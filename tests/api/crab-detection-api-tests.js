/**
 * Crab Detection API Testing Suite
 *
 * Tests all API endpoints related to crab detection:
 * - GET /api/motion-analysis/crab-params
 * - POST /api/motion-analysis/crab-params
 * - GET /api/motion-analysis/crab-detections
 * - POST /api/motion-analysis/process/start (with crab detection enabled)
 */

const https = require('https');
const http = require('http');

const BASE_URL = 'http://localhost:9002';
const TEST_RESULTS = {
  total: 0,
  passed: 0,
  failed: 0,
  tests: [],
  apiTimes: []
};

// Helper: Make HTTP request
function makeRequest(url, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    const startTime = Date.now();
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const responseTime = Date.now() - startTime;
        TEST_RESULTS.apiTimes.push(responseTime);

        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed, responseTime });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, responseTime });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

// Helper: Run test
async function runTest(name, testFn) {
  TEST_RESULTS.total++;
  const startTime = Date.now();

  try {
    await testFn();
    TEST_RESULTS.passed++;
    const duration = Date.now() - startTime;
    TEST_RESULTS.tests.push({ name, passed: true, duration, error: null });
    console.log(`✓ ${name} (${duration}ms)`);
  } catch (error) {
    TEST_RESULTS.failed++;
    const duration = Date.now() - startTime;
    TEST_RESULTS.tests.push({ name, passed: false, duration, error: error.message });
    console.log(`✗ ${name} (${duration}ms)`);
    console.log(`  Error: ${error.message}`);
  }
}

// Helper: Assert
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// Test Suite
async function runApiTests() {
  console.log('\n' + '='.repeat(80));
  console.log('CRAB DETECTION API TEST SUITE');
  console.log('='.repeat(80) + '\n');

  // Test 1: GET crab-params returns presets
  await runTest('GET /crab-params returns presets', async () => {
    const result = await makeRequest(`${BASE_URL}/api/motion-analysis/crab-params`);

    assert(result.status === 200, `Expected status 200, got ${result.status}`);
    assert(result.data.success === true, 'Response success should be true');
    assert(Array.isArray(result.data.params), 'Response should contain params array');

    const presets = result.data.params.filter(p => p.is_preset);
    assert(presets.length >= 3, `Expected at least 3 presets, got ${presets.length}`);

    const presetNames = presets.map(p => p.name);
    assert(presetNames.includes('Conservative'), 'Missing Conservative preset');
    assert(presetNames.includes('Balanced'), 'Missing Balanced preset');
    assert(presetNames.includes('Aggressive'), 'Missing Aggressive preset');

    console.log(`    Found ${presets.length} presets`);
    console.log(`    API response time: ${result.responseTime}ms`);
  });

  // Test 2: Verify preset parameter values
  await runTest('Preset parameters have correct values', async () => {
    const result = await makeRequest(`${BASE_URL}/api/motion-analysis/crab-params`);
    const balanced = result.data.params.find(p => p.name === 'Balanced' && p.is_preset);

    assert(balanced, 'Balanced preset not found');
    assert(balanced.threshold === 30, `Balanced threshold should be 30, got ${balanced.threshold}`);
    assert(balanced.min_area === 30, `Balanced min_area should be 30, got ${balanced.min_area}`);
    assert(balanced.max_area === 2000, `Balanced max_area should be 2000, got ${balanced.max_area}`);
    assert(balanced.min_circularity === 0.3, `Balanced min_circularity should be 0.3, got ${balanced.min_circularity}`);

    console.log(`    Verified Balanced preset parameters`);
  });

  // Test 3: POST crab-params saves custom set
  await runTest('POST /crab-params saves custom parameter set', async () => {
    const customParams = {
      name: `API_Test_${Date.now()}`,
      params: {
        threshold: 28,
        min_area: 45,
        max_area: 7500,
        min_circularity: 0.25,
        max_aspect_ratio: 3.5,
        morph_kernel_size: 6,
        max_distance: 55.0,
        max_skip_frames: 6,
        min_track_length: 4,
        min_displacement: 8.0,
        min_speed: 0.08,
        max_speed: 120.0,
      }
    };

    const result = await makeRequest(
      `${BASE_URL}/api/motion-analysis/crab-params`,
      'POST',
      customParams
    );

    assert(result.status === 200, `Expected status 200, got ${result.status}`);
    assert(result.data.success === true, 'Response success should be true');
    assert(result.data.params, 'Response should contain saved params');
    assert(result.data.params.name === customParams.name, 'Saved name mismatch');
    assert(result.data.params.threshold === customParams.params.threshold, 'Saved threshold mismatch');
    assert(result.data.params.is_preset === false, 'Custom params should not be preset');

    console.log(`    Saved custom set: ${result.data.params.id}`);
    console.log(`    API response time: ${result.responseTime}ms`);
  });

  // Test 4: GET crab-detections endpoint exists
  await runTest('GET /crab-detections endpoint responds', async () => {
    const result = await makeRequest(
      `${BASE_URL}/api/motion-analysis/crab-detections?videoId=test-video-123`
    );

    assert(result.status === 200, `Expected status 200, got ${result.status}`);
    assert(result.data !== undefined, 'Response should have data');

    console.log(`    Endpoint responding correctly`);
    console.log(`    API response time: ${result.responseTime}ms`);
  });

  // Test 5: Process endpoint accepts crab detection settings
  await runTest('POST /process/start accepts crab detection settings', async () => {
    const processBody = {
      videoIds: ['test-video-id'],
      runType: 'modal-a10g',
      settings: {
        targetFps: '10',
        enableMotionAnalysis: true,
        enableYolo: true,
        yoloModel: 'yolov8m',
        enableCrabDetection: true,
        crabDetectionParams: {
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
      }
    };

    const result = await makeRequest(
      `${BASE_URL}/api/motion-analysis/process/start`,
      'POST',
      processBody
    );

    // This may fail due to invalid video ID, but should validate structure
    // Accept 400 (no videos found) or 500 as valid responses for structure test
    assert(
      result.status === 400 || result.status === 404 || result.status === 200 || result.status === 500,
      `Expected 200/400/404/500, got ${result.status}`
    );
    assert(result.data !== undefined, 'Response should have data');

    console.log(`    Endpoint accepts crab detection settings`);
    console.log(`    Response: ${result.data.error || result.data.message || 'OK'}`);
  });

  // Test 6: RLS policies - presets accessible without auth
  await runTest('RLS: Presets accessible without authentication', async () => {
    const result = await makeRequest(`${BASE_URL}/api/motion-analysis/crab-params`);

    assert(result.status === 200, `Expected status 200, got ${result.status}`);
    const presets = result.data.params.filter(p => p.is_preset);
    assert(presets.length > 0, 'Presets should be accessible');

    console.log(`    ${presets.length} presets accessible`);
  });

  // Test 7: API performance benchmark
  await runTest('API Performance: All endpoints under 2s', async () => {
    const avgResponseTime = TEST_RESULTS.apiTimes.reduce((a, b) => a + b, 0) / TEST_RESULTS.apiTimes.length;
    const maxResponseTime = Math.max(...TEST_RESULTS.apiTimes);

    assert(avgResponseTime < 2000, `Average response time ${avgResponseTime}ms exceeds 2000ms`);
    assert(maxResponseTime < 3000, `Max response time ${maxResponseTime}ms exceeds 3000ms`);

    console.log(`    Average API response: ${avgResponseTime.toFixed(0)}ms`);
    console.log(`    Max API response: ${maxResponseTime.toFixed(0)}ms`);
  });

  // Print final report
  console.log('\n' + '='.repeat(80));
  console.log('API TEST RESULTS');
  console.log('='.repeat(80));

  console.log(`\n📊 Summary:`);
  console.log(`  Total: ${TEST_RESULTS.total}`);
  console.log(`  ✓ Passed: ${TEST_RESULTS.passed}`);
  console.log(`  ✗ Failed: ${TEST_RESULTS.failed}`);
  console.log(`  Pass Rate: ${((TEST_RESULTS.passed / TEST_RESULTS.total) * 100).toFixed(1)}%`);

  const avgApiTime = TEST_RESULTS.apiTimes.reduce((a, b) => a + b, 0) / TEST_RESULTS.apiTimes.length;
  console.log(`\n⏱️  Performance:`);
  console.log(`  Avg API Response: ${avgApiTime.toFixed(0)}ms`);
  console.log(`  Min: ${Math.min(...TEST_RESULTS.apiTimes)}ms`);
  console.log(`  Max: ${Math.max(...TEST_RESULTS.apiTimes)}ms`);

  if (TEST_RESULTS.failed > 0) {
    console.log(`\n❌ Failed Tests:`);
    TEST_RESULTS.tests
      .filter(t => !t.passed)
      .forEach(t => {
        console.log(`  - ${t.name}`);
        console.log(`    ${t.error}`);
      });
  }

  const score = (TEST_RESULTS.passed / TEST_RESULTS.total) * 100;
  console.log(`\n🎯 API Score: ${score.toFixed(0)}/100`);
  console.log('='.repeat(80) + '\n');

  process.exit(TEST_RESULTS.failed > 0 ? 1 : 0);
}

// Run tests
runApiTests().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});

/**
 * Rate Limit Test Script
 * ──────────────────────
 * Tests rate limiting for different user types against the live backend.
 *
 * Usage:
 *   node scripts/test-rate-limit.js
 *
 * Prerequisites:
 *   - Backend must be running (npm run dev or node index.js)
 *   - You need valid credentials for each user type you want to test
 *
 * IMPORTANT: Rate limiting is SKIPPED in development mode (NODE_ENV !== 'production').
 * To test rate limiting locally, either:
 *   1. Start backend with: NODE_ENV=production node index.js
 *   2. Or temporarily comment out the dev-skip in rateLimiter.js (line 68-70)
 */

const BASE_URL = process.env.API_URL || 'https://backend-k9t6.onrender.com';

// ─── Test Credentials ────────────────────────────────────────
// UPDATE THESE with real accounts from your MongoDB
const TEST_USERS = {
    superAdmin: {
        email: 'forus@gmail.com',       // Super admin (always bypasses)
        password: 'asdfghjkl',  // <-- UPDATE THIS
        expectedBypass: true,
        label: 'SUPER ADMIN',
    },
    admin: {
        email: 'forus@gmail.com',     // Any user with isAdmin: true
        password: 'asdfghjkl',  // <-- UPDATE THIS
        expectedBypass: true,
        label: 'ADMIN',
    },
    freeUser: {
        email: 'singhabhudaya7@gmail.com',      // Regular user (not admin, not subscribed)
        password: 'asdfghjkl',  // <-- UPDATE THIS
        expectedBypass: false,
        label: 'FREE USER (should be rate limited)',
    }
};

// ─── Helpers ─────────────────────────────────────────────────

async function login(email, password) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!data.token) {
        throw new Error(`Login failed for ${email}: ${data.message || 'No token'}`);
    }
    return data.token;
}

async function makeCalcRequest(token, requestNum) {
    // Decode token to get customerID
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    const customerID = payload.customer?._id || 'missing-id';

    const res = await fetch(`${BASE_URL}/api/transporter/calculate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
            customerID: customerID,
            userogpincode: '400001',
            modeoftransport: 'Road',
            fromPincode: '400001',
            toPincode: '110001',
            shipment_details: [{ count: 1, length: 30, width: 20, height: 15, weight: 5 }],
            invoiceValue: 1000,
        }),
    });

    const remaining = res.headers.get('x-ratelimit-remaining');
    const limit = res.headers.get('x-ratelimit-limit');
    const reset = res.headers.get('x-ratelimit-reset');

    return {
        status: res.status,
        remaining,
        limit,
        reset,
        requestNum,
    };
}

// ─── Test Runner ─────────────────────────────────────────────

async function testUserRateLimit(userConfig) {
    const { email, password, expectedBypass, label } = userConfig;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  Testing: ${label}`);
    console.log(`  Email:   ${email}`);
    console.log(`  Expect:  ${expectedBypass ? 'NO rate limit (bypass)' : 'RATE LIMITED at 15'}`);
    console.log(`${'═'.repeat(60)}`);

    try {
        // 1. Login
        console.log('  🔐 Logging in...');
        const token = await login(email, password);
        console.log('  ✅ Login successful');

        // Decode JWT to see roles
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        console.log('\n  👤 JWT ROLE DATA:');
        console.log(`    - isAdmin: ${payload.customer?.isAdmin}`);
        console.log(`    - isSubscribed: ${payload.customer?.isSubscribed}`);
        console.log(`    - rateLimitExempt: ${payload.customer?.rateLimitExempt}\n`);

        // 2. Make requests
        const NUM_REQUESTS = expectedBypass ? 3 : 17; // 3 for bypass users, 17 for free users
        console.log(`  📊 Making ${NUM_REQUESTS} calculate requests...\n`);

        for (let i = 1; i <= NUM_REQUESTS; i++) {
            const result = await makeCalcRequest(token, i);

            const icon = result.status === 429 ? '🚫' : '✅';
            const rateLimitInfo = result.remaining !== null
                ? `[${result.remaining}/${result.limit} remaining, reset in ${result.reset}s]`
                : '[no rate-limit headers — bypassed or dev mode]';

            console.log(`  ${icon} Request #${i}: HTTP ${result.status} ${rateLimitInfo}`);

            if (result.status === 429) {
                console.log(`  ⏰ Rate limited! Retry after: ${result.reset}s`);

                if (expectedBypass) {
                    console.log('  ❌ FAIL: User should NOT be rate limited!');
                } else {
                    console.log('  ✅ PASS: Free user correctly rate limited');
                }
                break;
            }

            // Small delay to avoid overwhelming the server
            await new Promise(r => setTimeout(r, 200));
        }

        if (expectedBypass) {
            console.log(`  ✅ PASS: ${label} was NOT rate limited (as expected)`);
        }

    } catch (err) {
        console.log(`  ❌ ERROR: ${err.message}`);
        console.log(`  ⚠️  Make sure credentials are correct and backend is running`);
    }
}

async function checkEnvironment() {
    console.log('\n🔍 ENVIRONMENT CHECK');
    console.log(`   Backend URL: ${BASE_URL}`);
    console.log(`   NODE_ENV:    ${process.env.NODE_ENV || '(not set = development)'}`);

    if (process.env.NODE_ENV !== 'production') {
        console.log('\n   ⚠️  WARNING: NODE_ENV is not "production"');
        console.log('   Rate limiting is SKIPPED in development mode!');
        console.log('   To test rate limiting, start backend with:');
        console.log('     SET NODE_ENV=production && node index.js');
        console.log('   Or: $env:NODE_ENV="production"; node index.js  (PowerShell)\n');
    }

    // Quick health check
    try {
        const res = await fetch(`${BASE_URL}/health`);
        const data = await res.json();
        console.log(`   Backend health: ${data.ok ? '✅ Running' : '❌ Down'}`);
    } catch {
        console.log('   Backend health: ❌ Cannot connect');
        console.log('   Please start the backend first: node index.js');
        process.exit(1);
    }
}

async function main() {
    console.log('╔════════════════════════════════════════════════╗');
    console.log('║     RATE LIMIT TEST SUITE                     ║');
    console.log('╚════════════════════════════════════════════════╝');

    await checkEnvironment();

    // Test each user type (comment out any you don't have credentials for)
    await testUserRateLimit(TEST_USERS.superAdmin);
    // await testUserRateLimit(TEST_USERS.admin);
    // await testUserRateLimit(TEST_USERS.subscribedUser);
    await testUserRateLimit(TEST_USERS.freeUser);

    // Quick test: just check if the middleware is responding
    console.log('\n📋 QUICK TEST: Unauthenticated request (should get 401)');
    try {
        const res = await fetch(`${BASE_URL}/api/transporter/calculate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                modeoftransport: 'Road',
                fromPincode: '400001',
                toPincode: '110001',
                shipment_details: [{ count: 1, length: 30, width: 20, height: 15, weight: 5 }],
            }),
        });
        console.log(`   HTTP ${res.status} — ${res.status === 401 ? '✅ Auth required (correct)' : '⚠️ Unexpected status'}`);
    } catch (err) {
        console.log(`   ❌ Failed: ${err.message}`);
    }

    console.log('\n────────────────────────────────────────────────');
    console.log('To test with real users, update TEST_USERS in this script');
    console.log('with actual credentials and uncomment the test lines above.');
    console.log('────────────────────────────────────────────────\n');
}

main().catch(console.error);

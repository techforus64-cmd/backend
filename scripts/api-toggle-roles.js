import fs from 'fs';

const BASE_URL = 'http://localhost:8000';
const BACKUP_FILE = 'scripts/api-role-backups.json';
const TARGET_EMAILS = ['forus@gmail.com', 'singhabhudaya7@gmail.com'];

// The password for forus to act as the super-admin orchestrator
const SUPER_ADMIN_CREDENTIALS = {
    email: 'forus@gmail.com',
    password: 'asdfghjkl' // from previous script tests
};

async function loginAsSuperAdmin() {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(SUPER_ADMIN_CREDENTIALS),
    });
    const data = await res.json();
    if (!data.token) throw new Error(`Super admin login failed! Check credentials.`);
    return data.token;
}

async function getAllCustomers(token) {
    const res = await fetch(`${BASE_URL}/api/admin/management/customers?limit=1000`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Failed to fetch customers: ${data.message}`);
    return data.data; // assuming { data: [...] } structure
}

async function updateSetting(token, customerId, endpoint, payload) {
    const res = await fetch(`${BASE_URL}/api/admin/management/customers/${customerId}/${endpoint}`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const data = await res.json();
        console.error(`Failed to update ${endpoint} for ${customerId}:`, data.message);
    }
}

async function run() {
    const mode = process.argv[2];
    if (!['disable', 'restore'].includes(mode)) {
        console.error('Usage: node scripts/api-toggle-roles.js [disable|restore]');
        process.exit(1);
    }

    try {
        console.log(`🔐 Logging in as orchestrator: ${SUPER_ADMIN_CREDENTIALS.email}`);
        const token = await loginAsSuperAdmin();

        console.log(`📡 Fetching customer list via Admin API...`);
        const allCustomers = await getAllCustomers(token);

        // Find our targets
        const targetUsers = allCustomers.filter(c => TARGET_EMAILS.includes(c.email));

        if (targetUsers.length === 0) {
            console.log('⚠️ No target users found in database view.');
            return;
        }

        if (mode === 'disable') {
            const backups = {};

            // CAUTION: Demote users ONE BY ONE. 
            // Do singhabhudaya7@gmail.com FIRST so forus@gmail.com doesn't lose admin rights prematurely.
            const orderedTargets = targetUsers.sort((a, b) => a.email === 'forus@gmail.com' ? 1 : -1);

            for (const user of orderedTargets) {
                // 1. Save state
                backups[user.email] = {
                    isAdmin: user.isAdmin,
                    isSubscribed: user.isSubscribed,
                    rateLimitExempt: user.rateLimitExempt
                };

                console.log(`📉 Stripping roles for ${user.email} (ID: ${user._id})`);
                // 2. Disable Subscribed
                await updateSetting(token, user._id, 'subscription', { isSubscribed: false });
                // 3. Disable Rate Limit Exempt
                await updateSetting(token, user._id, 'rate-limit-exempt', { rateLimitExempt: false });
                // 4. Disable Admin
                await updateSetting(token, user._id, 'role', { isAdmin: false });
            }

            fs.writeFileSync(BACKUP_FILE, JSON.stringify(backups, null, 2));
            console.log(`\n💾 Backup saved to ${BACKUP_FILE}`);
            console.log(`✅ Roles stripped successfully. BOTH are now Free Users.`);
            console.log(`⚠️  NOTE: You MUST manually restore forus@gmail.com via MongoDB compass later since they lost admin rights.`);

        } else {
            console.log('⚠️ RESTORE MODE requires DB connection or a separate admin account. Since forus lost admin rights, it cannot restore its own admin via API!');
            console.log('Use MongoDB Compass to restore isAdmin: true directly on forus@gmail.com.');
        }

    } catch (err) {
        console.error('Task failed:', err.message);
    }
}

run();

import axios from 'axios';
import fs from 'fs';

const BASE_URL = 'http://localhost:5000/api';
let ADMIN_TOKEN = '';
let USER_ID = '';
let USER_TOKEN = '';

// Helper to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    try {
        console.log('--- Super Admin Custom Rate Limit Verification ---');
        console.log('1. Logging in as Super Admin (forus@gmail.com) to get admin token...');

        let adminRes;
        try {
            adminRes = await axios.post(`${BASE_URL}/auth/login`, {
                email: 'forus@gmail.com',
                password: 'password123'
            });
        } catch (e) {
            console.log('Failed Admin Login. Ensure server is running and password is correct.', e.response?.data?.message);
            return;
        }

        ADMIN_TOKEN = adminRes.data.token;
        console.log('   ✅ Super Admin Login Successful');

        // 2. Login as a regular test user to get user ID and user token 
        console.log('\n2. Logging in as regular user to target...');
        let userRes;
        try {
            userRes = await axios.post(`${BASE_URL}/auth/login`, {
                email: 'user1234@gmail.com', // Using the test user from earlier 
                password: 'password123'
            });
        } catch (e) {
            console.log('Failed User Login. Please verify DB has user1234@gmail.com or another standard account we can test with.', e.message);
            return;
        }

        USER_TOKEN = userRes.data.token;
        USER_ID = userRes.data.data._id;
        console.log(`   ✅ Regular User Info Retrieved: ID=${USER_ID}`);

        // 3. Test changing the limit to 2 via Admin API
        console.log('\n3. Calling PUT /admin/management/customers/:id/custom-rate-limit with limit=2');
        const updateRes = await axios.put(`${BASE_URL}/admin/management/customers/${USER_ID}/custom-rate-limit`, {
            customRateLimit: 2
        }, {
            headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
        });

        console.log(`   ✅ DB Update successful. New customRateLimit = ${updateRes.data.data.customRateLimit}`);

        // 4. Test hitting the calculator API as the user
        console.log('\n4. Hitting the Calculator API as the regular user with Limit = 2...');
        for (let i = 1; i <= 3; i++) {
            try {
                const calcRes = await axios.post(`${BASE_URL}/freight-rate/calculate`, {
                    // Mock payload
                    originPort: 'Mundra',
                    destinationPort: 'Jebel Ali',
                    equipmentType: '20GP'
                }, {
                    headers: { Authorization: `Bearer ${USER_TOKEN}` }
                });

                console.log(`   -> Request ${i}: SUCCESS (${calcRes.headers['x-ratelimit-remaining']} remaining)`);
            } catch (err) {
                if (err.response && err.response.status === 429) {
                    console.log(`   -> Request ${i}: BLOCKED (429 Too Many Requests) - LIMIT REACHED`);
                } else if (err.response && err.response.status === 428) {
                    console.log(`   -> Request ${i}: CAPTCHA CHALLENGE (428 Precondition Required)`);
                } else {
                    console.log(`   -> Request ${i}: ERROR ${err.response?.status || err.message}`);
                    console.log(`      Detail:`, err.response?.data?.message);
                }
            }
        }

        console.log('\n🎉 Verification Complete!');

    } catch (error) {
        console.error('\n❌ Verification Failed:', error.response?.data?.message || error.message);
    }
}

main();

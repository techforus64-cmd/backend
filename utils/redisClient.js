import { createClient } from 'redis';

const client = createClient({
    username: 'default',
    password: 'ZTOCFBhFJZIQDvzonZHxwTOc07GDbsjc',
    socket: {
        host: 'redis-18031.c273.us-east-1-2.ec2.redns.redis-cloud.com',
        port: 18031,
        connectTimeout: 10000, // 10 second timeout
        reconnectStrategy: (retries) => {
            if (retries > 3) {
                console.error('❌ Redis connection failed after 3 retries');
                return new Error('Redis connection failed');
            }
            console.log(`⚠️ Redis reconnecting... attempt ${retries}`);
            return retries * 1000; // Wait 1s, 2s, 3s between retries
        }
    }
});

client.on('error', err => {
    console.error('❌ Redis Client Error:', err.message);
});

client.on('connect', () => {
    console.log('✅ Redis connected successfully');
});

client.on('ready', () => {
    console.log('✅ Redis client ready');
});

try {
    await client.connect();
    console.log('✅ Redis connection established');

    // Test connection
    await client.set('connection_test', 'ok', { EX: 10 });
    const testResult = await client.get('connection_test');
    if (testResult === 'ok') {
        console.log('✅ Redis read/write test passed');
    }
} catch (error) {
    console.error('❌ CRITICAL: Redis connection failed!');
    console.error('Error:', error.message);
    console.error('\n⚠️ OTP functionality will NOT work without Redis!');
    console.error('Options:');
    console.error('  1. Check Redis Cloud dashboard - verify instance is active');
    console.error('  2. Check network/firewall - ensure Redis Cloud is reachable');
    console.error('  3. Use local Redis instead (redis-server on localhost:6379)');
    // Don't crash the server, but warn heavily
}

export default client;

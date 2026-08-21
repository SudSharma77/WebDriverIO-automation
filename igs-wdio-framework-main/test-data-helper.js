/**
 * Simple script to test TestDataHelper functionality
 */

const { testDataHelper } = require('./dist/src/utilities/index.js');

async function testDataHelperFunctionality() {
    console.log('Testing TestDataHelper...');

    try {
        // Test JSON loading
        console.log('\n1. Testing JSON data loading...');
        const users = testDataHelper.loadJsonData('users.json');
        console.log(`✓ Loaded ${users.length} users from JSON`);
        console.log('✓ First user:', users[0]);

        // Test CSV loading
        console.log('\n2. Testing CSV data loading...');
        const csvUsers = testDataHelper.loadCsvData('users.csv');
        console.log(`✓ Loaded ${csvUsers.length} users from CSV`);
        console.log('✓ First CSV user:', csvUsers[0]);

        // Test filtering
        console.log('\n3. Testing data filtering...');
        const admins = testDataHelper.filterRecords('users.json', { role: 'admin' });
        console.log(`✓ Found ${admins.length} admin users`);

        // Test record search
        console.log('\n4. Testing record search...');
        const user = testDataHelper.getRecordByField('users.json', 'email', 'testuser1@example.com');
        console.log('✓ Found user by email:', user?.username);

        console.log('\n✅ All TestDataHelper tests passed!');

    } catch (error) {
        console.error('❌ Error testing TestDataHelper:', error.message);
        console.error(error.stack);
    }
}

testDataHelperFunctionality();

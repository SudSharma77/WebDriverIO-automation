/**
 * Example Test demonstrating TestDataHelper usage
 * Shows how to load and use test data from CSV and JSON files
 */

import { expect } from '@wdio/globals';
import { testDataHelper } from '../../src/utilities/index';

describe('Test Data Helper Examples', () => {

    describe('JSON Data Loading', () => {
        it('should load all user data from JSON file', async () => {
            const users = testDataHelper.loadJsonData('users.json');

            expect(users).toBeInstanceOf(Array);
            expect(users.length).toBeGreaterThan(0);
            expect(users[0]).toHaveProperty('username');
            expect(users[0]).toHaveProperty('email');

            console.log(`Loaded ${users.length} users from JSON`);
        });

        it('should get specific user by index', async () => {
            const user = testDataHelper.getRecordByIndex('users.json', 0);

            expect(user).toHaveProperty('id', 1);
            expect(user).toHaveProperty('username', 'testuser1');
            expect(user).toHaveProperty('email', 'testuser1@example.com');

            console.log(`Retrieved user: ${user.username}`);
        });

        it('should find user by email field', async () => {
            const user = testDataHelper.getRecordByField('users.json', 'email', 'testuser2@example.com');

            expect(user).toBeDefined();
            expect(user?.username).toBe('testuser2');
            expect(user?.firstName).toBe('Jane');

            console.log(`Found user by email: ${user?.username}`);
        });

        it('should filter admin users', async () => {
            const adminUsers = testDataHelper.filterRecords('users.json', { role: 'admin' });

            expect(adminUsers.length).toBeGreaterThan(0);
            adminUsers.forEach(user => {
                expect(user.role).toBe('admin');
            });

            console.log(`Found ${adminUsers.length} admin users`);
        });

        it('should get random user', async () => {
            const randomUser = testDataHelper.getRandomRecord('users.json');

            expect(randomUser).toHaveProperty('username');
            expect(randomUser).toHaveProperty('email');

            console.log(`Random user selected: ${randomUser.username}`);
        });
    });

    describe('CSV Data Loading', () => {
        it('should load all user data from CSV file', async () => {
            const users = testDataHelper.loadCsvData('users.csv');

            expect(users).toBeInstanceOf(Array);
            expect(users.length).toBeGreaterThan(0);
            expect(users[0]).toHaveProperty('username');
            expect(users[0]).toHaveProperty('email');

            console.log(`Loaded ${users.length} users from CSV`);
        });

        it('should get specific user by index from CSV', async () => {
            const user = testDataHelper.getRecordByIndex('users.csv', 1, 'csv');

            expect(user).toHaveProperty('id', '2');
            expect(user).toHaveProperty('username', 'csvuser2');

            console.log(`Retrieved CSV user: ${user.username}`);
        });

        it('should filter active users from CSV', async () => {
            const activeUsers = testDataHelper.filterRecords('users.csv', { isActive: 'true' }, 'csv');

            expect(activeUsers.length).toBeGreaterThan(0);
            activeUsers.forEach(user => {
                expect(user.isActive).toBe('true');
            });

            console.log(`Found ${activeUsers.length} active CSV users`);
        });
    });

    describe('Product Data Examples', () => {
        it('should load products and find electronics', async () => {
            const products = testDataHelper.loadJsonData('products.json');
            const electronics = testDataHelper.filterRecords('products.json', { category: 'Electronics' });

            expect(products.length).toBeGreaterThan(0);
            expect(electronics.length).toBeGreaterThan(0);

            console.log(`Found ${electronics.length} electronic products out of ${products.length} total`);
        });

        it('should get in-stock products', async () => {
            const inStockProducts = testDataHelper.filterRecords('products.json', { inStock: true });

            expect(inStockProducts.length).toBeGreaterThan(0);
            inStockProducts.forEach(product => {
                expect(product.inStock).toBe(true);
                expect(product.quantity).toBeGreaterThan(0);
            });

            console.log(`Found ${inStockProducts.length} in-stock products`);
        });

        it('should get random products for testing', async () => {
            const randomProducts = testDataHelper.getRandomRecords('products.json', 2);

            expect(randomProducts.length).toBe(2);
            randomProducts.forEach(product => {
                expect(product).toHaveProperty('productId');
                expect(product).toHaveProperty('name');
                expect(product).toHaveProperty('price');
            });

            console.log(`Selected random products: ${randomProducts.map(p => p.name).join(', ')}`);
        });
    });

    describe('Data Validation and Utilities', () => {
        it('should validate data structure', async () => {
            const requiredUserFields = ['id', 'username', 'email', 'password'];
            const isValid = testDataHelper.validateDataStructure('users.json', requiredUserFields);

            expect(isValid).toBe(true);

            console.log('User data structure validation passed');
        });

        it('should check if data files exist', async () => {
            const usersJsonExists = testDataHelper.dataFileExists('users.json', 'json');
            const usersCsvExists = testDataHelper.dataFileExists('users.csv', 'csv');
            const nonExistentExists = testDataHelper.dataFileExists('nonexistent.json', 'json');

            expect(usersJsonExists).toBe(true);
            expect(usersCsvExists).toBe(true);
            expect(nonExistentExists).toBe(false);

            console.log('Data file existence checks completed');
        });

        it('should list available data files', async () => {
            const allFiles = testDataHelper.getAvailableDataFiles();
            const jsonFiles = testDataHelper.getAvailableDataFiles('json');
            const csvFiles = testDataHelper.getAvailableDataFiles('csv');

            expect(allFiles.length).toBeGreaterThan(0);
            expect(jsonFiles.length).toBeGreaterThan(0);
            expect(csvFiles.length).toBeGreaterThan(0);

            console.log(`Available files - Total: ${allFiles.length}, JSON: ${jsonFiles.length}, CSV: ${csvFiles.length}`);
        });
    });

    describe('Advanced Usage Examples', () => {
        it('should demonstrate complex filtering', async () => {
            // Get active admin users from different countries
            const users = testDataHelper.loadJsonData('users.json');
            const activeAdmins = users.filter(user =>
                user.role === 'admin' &&
                user.isActive === true &&
                user.country !== 'USA'
            );

            expect(activeAdmins.length).toBeGreaterThanOrEqual(0);

            console.log(`Found ${activeAdmins.length} active non-US admin users`);
        });

        it('should combine JSON and CSV data', async () => {
            const jsonUsers = testDataHelper.loadJsonData('users.json');
            const csvUsers = testDataHelper.loadCsvData('users.csv');

            // Combine data for comprehensive testing
            const allUsernames = [
                ...jsonUsers.map(u => u.username),
                ...csvUsers.map(u => u.username)
            ];

            expect(allUsernames.length).toBe(jsonUsers.length + csvUsers.length);

            console.log(`Combined ${jsonUsers.length} JSON users with ${csvUsers.length} CSV users`);
        });

        it('should demonstrate nested data access', async () => {
            const users = testDataHelper.loadJsonData('users.json');
            const darkThemeUsers = users.filter(user =>
                user.preferences && user.preferences.theme === 'dark'
            );

            expect(darkThemeUsers.length).toBeGreaterThan(0);
            darkThemeUsers.forEach(user => {
                expect(user.preferences.theme).toBe('dark');
            });

            console.log(`Found ${darkThemeUsers.length} users with dark theme preference`);
        });
    });
});

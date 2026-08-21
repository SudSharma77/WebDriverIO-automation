import { ApiHelper } from '@utilities/index';
import { expect } from '@wdio/globals';

describe('🔌 API Quick Verification', () => {

    beforeEach(async () => {
        // Set base URL for API tests
        ApiHelper.setBaseURL('https://jsonplaceholder.typicode.com');
    });

    it('should verify API GET request functionality', async () => {
        // Quick API test with a reliable endpoint
        const response = await ApiHelper.get('/posts/1');

        // Verify response structure
        expect(response.status).toBe(200);
        expect(response.data).toBeDefined();
        expect(response.data.id).toBe(1);
        expect(response.data.title).toBeDefined();

        console.log('✅ API GET request verified - Post ID: ' + response.data.id);
    });

    it('should verify API helper utilities', async () => {
        // Test multiple posts endpoint
        const response = await ApiHelper.get('/posts');

        // Verify array response
        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
        expect(response.data.length).toBeGreaterThan(0);

        console.log('✅ API utilities verified - Retrieved ' + response.data.length + ' posts');
    });

    it('should verify API POST functionality', async () => {
        // Test creating a new post
        const newPost = {
            title: 'Test Post',
            body: 'This is a test post for verification',
            userId: 1
        };

        const response = await ApiHelper.post('/posts', newPost);

        // Verify creation response
        expect(response.status).toBe(201);
        expect(response.data.title).toBe(newPost.title);
        expect(response.data.body).toBe(newPost.body);

        console.log('✅ API POST verified - Created post with ID: ' + response.data.id);
    });
});

import { ApiHelper } from '../generic/ApiHelper';

/**
 * API Business Helper - Business logic for API testing workflows
 * Provides high-level business operations for API testing scenarios
 */
export class ApiBusinessHelper {
    /**
     * Complete user account creation workflow
     * @param userData User registration data
     * @returns Created user data
     */
    static async createUserAccount(userData: {
        username: string;
        email: string;
        password: string;
        firstName?: string;
        lastName?: string;
    }): Promise<any> {
        // Create user account
        const response = await ApiHelper.post('/api/users', userData);
        ApiHelper.validateStatusCode(response, 201);
        
        // Validate response structure
        if (!response.data.id) {
            throw new Error('Response should contain id field');
        }
        if (response.data.email !== userData.email) {
            throw new Error(`Expected email ${userData.email}, got ${response.data.email}`);
        }
        return response.data;
    }

    static async authenticateUser(credentials: {
        email: string;
        password: string;
    }): Promise<{ token: string; refreshToken: string; user: any }> {
        // Authenticate user
        const response = await ApiHelper.post('/api/auth/login', credentials);
        ApiHelper.validateStatusCode(response, 200);
        
        // Validate response structure
        if (!response.data.token) {
            throw new Error('Response should contain token field');
        }
        if (!response.data.user) {
            throw new Error('Response should contain user field');
        }

        // Set authentication token for subsequent requests
        ApiHelper.setAuthToken(response.data.token, 'Bearer');

        return response.data;
    }

    /**
     * Get user profile data
     * @param userId User ID
     * @returns User profile data
     */
    static async getUserProfile(userId: string): Promise<any> {
        const response = await ApiHelper.get(`/api/users/${userId}`);
        ApiHelper.validateStatusCode(response, 200);
        return response.data;
    }

    /**
     * Update user profile
     * @param userId User ID
     * @param updateData Profile update data
     * @returns Updated user data
     */
    static async updateUserProfile(userId: string, updateData: any): Promise<any> {
        const response = await ApiHelper.put(`/api/users/${userId}`, updateData);
        ApiHelper.validateStatusCode(response, 200);
        return response.data;
    }

    /**
     * Create a new product
     * @param productData Product data
     * @returns Created product data
     */
    static async createProduct(productData: {
        name: string;
        description: string;
        price: number;
        category: string;
        inventory: number;
    }): Promise<any> {
        const response = await ApiHelper.post('/api/products', productData);
        ApiHelper.validateStatusCode(response, 201);
        
        // Validate product was created with required fields
        if (!response.data.id) {
            throw new Error('Product should be created with an ID');
        }

        return response.data;
    }

    /**
     * Search products with filters
     * @param searchCriteria Search criteria
     * @returns Search results
     */
    static async searchProducts(searchCriteria: {
        query?: string;
        category?: string;
        minPrice?: number;
        maxPrice?: number;
        inStock?: boolean;
        limit?: number;
        offset?: number;
    }): Promise<any> {
        const queryParams = new URLSearchParams();
        Object.entries(searchCriteria).forEach(([key, value]) => {
            if (value !== undefined) {
                queryParams.append(key, value.toString());
            }
        });

        const response = await ApiHelper.get(`/api/products/search?${queryParams.toString()}`);
        ApiHelper.validateStatusCode(response, 200);
        
        // Validate search response structure
        if (!Array.isArray(response.data.products)) {
            throw new Error('Search response should contain products array');
        }
        if (typeof response.data.totalCount !== 'number') {
            throw new Error('Search response should contain totalCount');
        }
        return response.data;
    }

    /**
     * Add item to shopping cart
     * @param cartData Cart item data
     * @returns Cart response
     */
    static async addToCart(cartData: {
        productId: string;
        quantity: number;
        options?: any;
    }): Promise<any> {
        const response = await ApiHelper.post('/api/cart/items', cartData);
        ApiHelper.validateStatusCode(response, 200);
        
        if (!response.data.cartId) {
            throw new Error('Cart response should contain cartId');
        }

        return response.data;
    }

    /**
     * Complete e-commerce order process
     * @param orderData Order data
     * @returns Order and payment confirmation
     */
    static async processOrder(orderData: {
        cartId: string;
        shippingAddress: any;
        billingAddress: any;
        paymentMethod: any;
    }): Promise<any> {
        // Create order
        const orderResponse = await ApiHelper.post('/api/orders', {
            cartId: orderData.cartId,
            shippingAddress: orderData.shippingAddress,
            billingAddress: orderData.billingAddress
        });
        ApiHelper.validateStatusCode(orderResponse, 201);

        // Process payment
        const orderId = orderResponse.data.id;
        const paymentResponse = await ApiHelper.post('/api/payments', {
            orderId: orderId,
            paymentMethod: orderData.paymentMethod
        });
        ApiHelper.validateStatusCode(paymentResponse, 200);

        // Return combined order and payment data
        return { order: orderResponse.data, payment: paymentResponse.data };
    }

    /**
     * Create content (blog post, article, etc.)
     * @param contentData Content data
     * @returns Created content
     */
    static async createContent(contentData: {
        title: string;
        body: string;
        category: string;
        tags?: string[];
        published?: boolean;
    }): Promise<any> {
        const response = await ApiHelper.post('/api/content', contentData);
        ApiHelper.validateStatusCode(response, 201);
        
        if (!response.data.id) {
            throw new Error('Content should be created with an ID');
        }

        return response.data;
    }

    /**
     * Publish content
     * @param contentId Content ID
     * @returns Published content data
     */
    static async publishContent(contentId: string): Promise<any> {
        const response = await ApiHelper.put(`/api/content/${contentId}/publish`, {});
        ApiHelper.validateStatusCode(response, 200);
        
        if (!response.data.publishedAt) {
            throw new Error('Published content should have publishedAt timestamp');
        }
        return response.data;
    }

    /**
     * Upload file workflow
     * @param filePath Local file path
     * @param uploadData Upload metadata
     * @returns Upload response with file details
     */
    static async uploadFile(filePath: string, uploadData?: {
        description?: string;
        tags?: string[];
        public?: boolean;
    }): Promise<any> {
        // Create form data for file upload
        const formData = new FormData();
        formData.append('file', filePath);
        
        if (uploadData) {
            Object.entries(uploadData).forEach(([key, value]) => {
                formData.append(key, typeof value === 'string' ? value : JSON.stringify(value));
            });
        }

        // Use regular post method since postFormData doesn't exist
        const response = await ApiHelper.post('/api/files/upload', formData);
        ApiHelper.validateStatusCode(response, 201);
        
        // Validate upload response
        if (!response.data.fileId) {
            throw new Error('Upload response should contain fileId');
        }
        
        if (!response.data.url) {
            throw new Error('Upload response should contain url');
        }

        // Wait for file processing if needed
        await this.waitForFileProcessing(response.data.fileId);

        return response.data;
    }

    /**
     * Wait for file processing to complete
     * @param fileId File ID to check
     */
    private static async waitForFileProcessing(fileId: string): Promise<void> {
        const maxAttempts = 10;
        let attempts = 0;

        while (attempts < maxAttempts) {
            const statusResponse = await ApiHelper.get(`/api/files/${fileId}/status`);
            if (statusResponse.data.status === 'processed') {
                return;
            }
            
            if (statusResponse.data.status === 'failed') {
                throw new Error('File processing failed');
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
        }

        throw new Error('File processing timeout');
    }

    /**
     * Generate comprehensive business report
     * @param reportType Type of report
     * @param parameters Report parameters
     * @returns Report data
     */
    static async generateReport(reportType: string, parameters: any): Promise<any> {
        const response = await ApiHelper.post('/api/reports/generate', {
            type: reportType,
            parameters: parameters
        });
        ApiHelper.validateStatusCode(response, 202); // Accepted for processing
        
        if (!response.data.reportId) {
            throw new Error('Report generation should return reportId');
        }

        return response.data;
    }

    /**
     * Get report status and download when ready
     * @param reportId Report ID
     * @returns Report data or download link
     */
    static async getReportStatus(reportId: string): Promise<any> {
        const response = await ApiHelper.get(`/api/reports/${reportId}/status`);
        
        if (!response.data.status) {
            throw new Error('Report status response should contain status');
        }
        
        if (response.data.status === 'completed') {
            // Download the report
            const downloadResponse = await ApiHelper.get(`/api/reports/${reportId}/download`);
            if (downloadResponse.status === 200) {
                return downloadResponse.data;
            }
        }

        return response.data;
    }

    /**
     * Perform load testing simulation
     * @param testConfig Load test configuration
     * @returns Load test results
     */
    static async performLoadTest(testConfig: {
        endpoint: string;
        concurrentUsers: number;
        duration: number; // in seconds
        rampUpTime?: number;
    }): Promise<any> {
        const testData = {
            endpoint: testConfig.endpoint,
            users: testConfig.concurrentUsers,
            duration: testConfig.duration,
            rampUp: testConfig.rampUpTime || 30
        };

        const response = await ApiHelper.post('/api/load-test', testData);
        ApiHelper.validateStatusCode(response, 201);
        
        if (!response.data.id) {
            throw new Error('Load test should return test ID');
        }

        return response.data;
    }

    /**
     * Get load test results
     * @param testId Load test ID
     * @returns Test results and metrics
     */
    static async getLoadTestResults(testId: string): Promise<any> {
        const response = await ApiHelper.get(`/api/load-test/${testId}/results`);
        
        if (!response.data.delivered) {
            throw new Error('Load test results should contain delivered status');
        }
        return response.data;
    }

    /**
     * Bulk data operations (create multiple records)
     * @param endpoint API endpoint
     * @param dataArray Array of data to create
     * @returns Bulk operation results
     */
    static async bulkCreate(endpoint: string, dataArray: any[]): Promise<any> {
        const response = await ApiHelper.post(`/api/bulk${endpoint}`, {
            data: dataArray,
            operation: 'create'
        });
        ApiHelper.validateStatusCode(response, 200);
        
        // Validate bulk operation response
        if (!Array.isArray(response.data.created)) {
            throw new Error('Bulk create response should contain created array');
        }
        if (!Array.isArray(response.data.failed)) {
            throw new Error('Bulk create response should contain failed array');
        }

        // Verify all records were processed
        const actualCount = response.data.created.length + response.data.failed.length;
        if (actualCount !== dataArray.length) {
            throw new Error(`Expected to process ${dataArray.length} records, but processed ${actualCount}`);
        }

        return response.data;
    }

    /**
     * Bulk update operations
     * @param endpoint API endpoint
     * @param updateData Array of update data with IDs
     * @returns Bulk update results
     */
    static async bulkUpdate(endpoint: string, updateData: any[]): Promise<any> {
        const response = await ApiHelper.put(`/api/bulk${endpoint}`, {
            data: updateData,
            operation: 'update'
        });
        
        if (!Array.isArray(response.data.updated)) {
            throw new Error('Bulk update response should contain updated array');
        }
        if (!Array.isArray(response.data.failed)) {
            throw new Error('Bulk update response should contain failed array');
        }
        return response.data;
    }
}

import axios, { AxiosResponse, AxiosRequestConfig } from 'axios';

/**
 * API Helper Utility
 * Provides methods for API testing and HTTP requests
 */
export class ApiHelper {
    private static baseURL: string = '';
    private static defaultHeaders: Record<string, string> = {};
    private static authToken: string = '';

    /**
     * Set base URL for API requests
     * @param url - Base URL
     */
    static setBaseURL(url: string): void {
        this.baseURL = url;
    }

    /**
     * Set default headers for all requests
     * @param headers - Default headers
     */
    static setDefaultHeaders(headers: Record<string, string>): void {
        this.defaultHeaders = { ...this.defaultHeaders, ...headers };
    }

    /**
     * Set authentication token
     * @param token - Auth token
     * @param type - Token type (Bearer, Basic, etc.)
     */
    static setAuthToken(token: string, type: string = 'Bearer'): void {
        this.authToken = token;
        this.setDefaultHeaders({ Authorization: `${type} ${token}` });
    }

    /**
     * Clear authentication token
     */
    static clearAuthToken(): void {
        this.authToken = '';
        delete this.defaultHeaders.Authorization;
    }

    /**
     * Create request configuration
     * @param config - Additional config
     * @returns Complete axios config
     */
    private static createConfig(config: AxiosRequestConfig = {}): AxiosRequestConfig {
        return {
            baseURL: this.baseURL,
            headers: { ...this.defaultHeaders, ...config.headers },
            timeout: 30000,
            validateStatus: () => true, // Accept all status codes for testing
            ...config
        };
    }

    /**
     * Perform GET request
     * @param endpoint - API endpoint
     * @param config - Additional config
     * @returns Axios response
     */
    static async get(endpoint: string, config: AxiosRequestConfig = {}): Promise<AxiosResponse> {
        const requestConfig = this.createConfig(config);
        return await axios.get(endpoint, requestConfig);
    }

    /**
     * Perform POST request
     * @param endpoint - API endpoint
     * @param data - Request body
     * @param config - Additional config
     * @returns Axios response
     */
    static async post(endpoint: string, data?: any, config: AxiosRequestConfig = {}): Promise<AxiosResponse> {
        const requestConfig = this.createConfig(config);
        return await axios.post(endpoint, data, requestConfig);
    }

    /**
     * Perform PUT request
     * @param endpoint - API endpoint
     * @param data - Request body
     * @param config - Additional config
     * @returns Axios response
     */
    static async put(endpoint: string, data?: any, config: AxiosRequestConfig = {}): Promise<AxiosResponse> {
        const requestConfig = this.createConfig(config);
        return await axios.put(endpoint, data, requestConfig);
    }

    /**
     * Perform PATCH request
     * @param endpoint - API endpoint
     * @param data - Request body
     * @param config - Additional config
     * @returns Axios response
     */
    static async patch(endpoint: string, data?: any, config: AxiosRequestConfig = {}): Promise<AxiosResponse> {
        const requestConfig = this.createConfig(config);
        return await axios.patch(endpoint, data, requestConfig);
    }

    /**
     * Perform DELETE request
     * @param endpoint - API endpoint
     * @param config - Additional config
     * @returns Axios response
     */
    static async delete(endpoint: string, config: AxiosRequestConfig = {}): Promise<AxiosResponse> {
        const requestConfig = this.createConfig(config);
        return await axios.delete(endpoint, requestConfig);
    }

    /**
     * Upload file via POST
     * @param endpoint - API endpoint
     * @param filePath - Path to file
     * @param fieldName - Form field name
     * @param additionalFields - Additional form fields
     * @returns Axios response
     */
    static async uploadFile(
        endpoint: string,
        filePath: string,
        fieldName: string = 'file',
        additionalFields: Record<string, string> = {}
    ): Promise<AxiosResponse> {
        const FormData = require('form-data');
        const fs = require('fs');
        
        const formData = new FormData();
        formData.append(fieldName, fs.createReadStream(filePath));
        
        Object.keys(additionalFields).forEach(key => {
            formData.append(key, additionalFields[key]);
        });

        const config = this.createConfig({
            headers: {
                ...formData.getHeaders(),
                'Content-Type': 'multipart/form-data'
            }
        });

        return await axios.post(endpoint, formData, config);
    }

    /**
     * Validate response status code
     * @param response - Axios response
     * @param expectedStatus - Expected status code
     */
    static validateStatusCode(response: AxiosResponse, expectedStatus: number): void {
        if (response.status !== expectedStatus) {
            throw new Error(
                `Expected status code ${expectedStatus}, but got ${response.status}. ` +
                `Response: ${JSON.stringify(response.data, null, 2)}`
            );
        }
    }

    /**
     * Validate response contains specific data
     * @param response - Axios response
     * @param path - JSON path to validate (dot notation)
     * @param expectedValue - Expected value
     */
    static validateResponseData(response: AxiosResponse, path: string, expectedValue: any): void {
        const actualValue = this.getValueByPath(response.data, path);
        if (actualValue !== expectedValue) {
            throw new Error(
                `Expected value at path '${path}' to be '${expectedValue}', but got '${actualValue}'. ` +
                `Response: ${JSON.stringify(response.data, null, 2)}`
            );
        }
    }

    /**
     * Validate response schema structure
     * @param response - Axios response
     * @param schema - Expected schema object
     */
    static validateResponseSchema(response: AxiosResponse, schema: Record<string, string>): void {
        const data = response.data;
        const missingFields: string[] = [];
        const wrongTypes: string[] = [];

        Object.keys(schema).forEach(field => {
            if (!(field in data)) {
                missingFields.push(field);
            } else {
                const expectedType = schema[field];
                const actualType = typeof data[field];
                if (actualType !== expectedType) {
                    wrongTypes.push(`${field}: expected ${expectedType}, got ${actualType}`);
                }
            }
        });

        if (missingFields.length > 0 || wrongTypes.length > 0) {
            let errorMessage = 'Schema validation failed:\\n';
            if (missingFields.length > 0) {
                errorMessage += `Missing fields: ${missingFields.join(', ')}\\n`;
            }
            if (wrongTypes.length > 0) {
                errorMessage += `Wrong types: ${wrongTypes.join(', ')}\\n`;
            }
            errorMessage += `Response: ${JSON.stringify(data, null, 2)}`;
            throw new Error(errorMessage);
        }
    }

    /**
     * Get value from object by dot notation path
     * @param obj - Object to search in
     * @param path - Dot notation path
     * @returns Value at path
     */
    private static getValueByPath(obj: any, path: string): any {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : undefined;
        }, obj);
    }

    /**
     * Wait for API endpoint to return expected status
     * @param endpoint - API endpoint
     * @param expectedStatus - Expected status code
     * @param timeout - Timeout in milliseconds
     * @param interval - Polling interval in milliseconds
     */
    static async waitForEndpoint(
        endpoint: string,
        expectedStatus: number = 200,
        timeout: number = 30000,
        interval: number = 1000
    ): Promise<AxiosResponse> {
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            try {
                const response = await this.get(endpoint);
                if (response.status === expectedStatus) {
                    return response;
                }
            } catch {
                // Continue polling
            }
            
            await new Promise(resolve => setTimeout(resolve, interval));
        }
        
        throw new Error(`Endpoint '${endpoint}' did not return status ${expectedStatus} within ${timeout}ms`);
    }

    /**
     * Create test data via API
     * @param endpoint - API endpoint for creating data
     * @param data - Data to create
     * @returns Created data response
     */
    static async createTestData(endpoint: string, data: any): Promise<AxiosResponse> {
        const response = await this.post(endpoint, data);
        this.validateStatusCode(response, 201);
        return response;
    }

    /**
     * Cleanup test data via API
     * @param endpoint - API endpoint for deleting data
     * @param id - ID of data to delete
     */
    static async cleanupTestData(endpoint: string, id: string): Promise<void> {
        try {
            const response = await this.delete(`${endpoint}/${id}`);
            // Accept both 200 and 204 for successful deletion
            if (response.status !== 200 && response.status !== 204) {
                console.warn(`Cleanup warning: Expected status 200 or 204, got ${response.status}`);
            }
        } catch (error) {
            console.warn(`Cleanup warning: Failed to delete test data at ${endpoint}/${id}:`, error);
        }
    }

    /**
     * Generate random API test data
     * @param template - Data template with placeholders
     * @returns Generated data
     */
    static generateTestData(template: Record<string, any>): Record<string, any> {
        const data = JSON.parse(JSON.stringify(template));
        
        const replacePlaceholders = (obj: any): any => {
            if (typeof obj === 'string') {
                return obj
                    .replace(/{{random_email}}/g, `test${Date.now()}@example.com`)
                    .replace(/{{random_string}}/g, Math.random().toString(36).substring(7))
                    .replace(/{{random_number}}/g, Math.floor(Math.random() * 1000).toString())
                    .replace(/{{timestamp}}/g, Date.now().toString());
            } else if (Array.isArray(obj)) {
                return obj.map(replacePlaceholders);
            } else if (typeof obj === 'object' && obj !== null) {
                const result: any = {};
                Object.keys(obj).forEach(key => {
                    result[key] = replacePlaceholders(obj[key]);
                });
                return result;
            }
            return obj;
        };

        return replacePlaceholders(data);
    }

    /**
     * Perform API health check
     * @param endpoints - Array of endpoints to check
     * @returns Health check results
     */
    static async healthCheck(endpoints: string[]): Promise<Record<string, boolean>> {
        const results: Record<string, boolean> = {};
        
        for (const endpoint of endpoints) {
            try {
                const response = await this.get(endpoint);
                results[endpoint] = response.status >= 200 && response.status < 300;
            } catch {
                results[endpoint] = false;
            }
        }
        
        return results;
    }

    /**
     * Measure API response time
     * @param endpoint - API endpoint
     * @param method - HTTP method
     * @param data - Request data
     * @returns Response time in milliseconds
     */
    static async measureResponseTime(
        endpoint: string,
        method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
        data?: any
    ): Promise<{ responseTime: number; response: AxiosResponse }> {
        const startTime = Date.now();
        
        let response: AxiosResponse;
        switch (method) {
            case 'GET':
                response = await this.get(endpoint);
                break;
            case 'POST':
                response = await this.post(endpoint, data);
                break;
            case 'PUT':
                response = await this.put(endpoint, data);
                break;
            case 'PATCH':
                response = await this.patch(endpoint, data);
                break;
            case 'DELETE':
                response = await this.delete(endpoint);
                break;
        }
        
        const responseTime = Date.now() - startTime;
        return { responseTime, response };
    }
}

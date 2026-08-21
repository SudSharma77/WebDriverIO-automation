import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Configuration Helper Utility
 * Provides centralized access to environment variables and configuration
 */
export class ConfigHelper {
    /**
     * Get base URL from environment
     * @returns Base URL
     */
    static getBaseUrl(): string {
        return process.env.BASE_URL || 'https://example.com';
    }

    /**
     * Get staging URL
     * @returns Staging URL
     */
    static getStagingUrl(): string {
        return process.env.STAGING_URL || 'https://staging.example.com';
    }

    /**
     * Get production URL
     * @returns Production URL
     */
    static getProdUrl(): string {
        return process.env.PROD_URL || 'https://prod.example.com';
    }

    /**
     * Get Android app path
     * @returns Android app path
     */
    static getAndroidAppPath(): string {
        return process.env.ANDROID_APP_PATH || './apps/android/app-debug.apk';
    }

    /**
     * Get iOS app path
     * @returns iOS app path
     */
    static getIosAppPath(): string {
        return process.env.IOS_APP_PATH || './apps/ios/IGSApp.app';
    }

    /**
     * Get Android device name
     * @returns Android device name
     */
    static getAndroidDeviceName(): string {
        return process.env.ANDROID_DEVICE_NAME || 'emulator-5554';
    }

    /**
     * Get iOS device name
     * @returns iOS device name
     */
    static getIosDeviceName(): string {
        return process.env.IOS_DEVICE_NAME || 'iPhone 14';
    }

    /**
     * Check if debug mode is enabled
     * @returns Boolean indicating debug mode
     */
    static isDebugMode(): boolean {
        return process.env.DEBUG_MODE === 'true';
    }

    /**
     * Check if headless mode is enabled
     * @returns Boolean indicating headless mode
     */
    static isHeadlessMode(): boolean {
        return process.env.HEADLESS_MODE === 'true';
    }

    /**
     * Get browser dimensions
     * @returns Browser width and height
     */
    static getBrowserDimensions(): { width: number; height: number } {
        return {
            width: parseInt(process.env.BROWSER_WIDTH || '1920'),
            height: parseInt(process.env.BROWSER_HEIGHT || '1080')
        };
    }

    /**
     * Get default timeout
     * @returns Timeout in milliseconds
     */
    static getTimeout(): number {
        return parseInt(process.env.TIMEOUT || '30000');
    }

    /**
     * Check if Allure report generation is enabled
     * @returns Boolean indicating Allure report generation
     */
    static shouldGenerateAllureReport(): boolean {
        return process.env.GENERATE_ALLURE_REPORT === 'true';
    }

    /**
     * Check if screenshot on failure is enabled
     * @returns Boolean indicating screenshot on failure
     */
    static shouldTakeScreenshotOnFailure(): boolean {
        return process.env.SCREENSHOT_ON_FAILURE === 'true';
    }

    /**
     * Get API base URL
     * @returns API base URL
     */
    static getApiBaseUrl(): string {
        return process.env.API_BASE_URL || 'https://api.example.com';
    }

    /**
     * Get API timeout
     * @returns API timeout in milliseconds
     */
    static getApiTimeout(): number {
        return parseInt(process.env.API_TIMEOUT || '30000');
    }

    /**
     * Get environment (dev, staging, prod)
     * @returns Environment name
     */
    static getEnvironment(): string {
        return process.env.NODE_ENV || 'development';
    }

    /**
     * Check if running in CI/CD environment
     * @returns Boolean indicating CI/CD environment
     */
    static isCI(): boolean {
        return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true' || process.env.JENKINS === 'true';
    }
}

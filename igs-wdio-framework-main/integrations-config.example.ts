/**
 * Test Management Integrations Configuration Examples
 *
 * This file shows how to configure JIRA, Zephyr, and Xray integrations
 * when implementations are ready.
 *
 * Copy this file to your project and modify the configurations
 * according to your environment.
 */

import {
    configureJiraIntegration,
    configureXrayIntegration,
    configureZephyrIntegration,
    getIntegrationStatus
} from './src/utilities/index';

/**
 * Configure all test management integrations
 */
export const configureTestManagementIntegrations = (): void => {
    try {
        // JIRA Configuration
        configureJiraIntegration({
            baseUrl: process.env.JIRA_BASE_URL || 'https://your-company.atlassian.net',
            username: process.env.JIRA_USERNAME || 'your-email@company.com',
            apiToken: process.env.JIRA_API_TOKEN || 'your-jira-api-token',
            projectKey: process.env.JIRA_PROJECT_KEY || 'TEST'
        });

        // Zephyr Configuration
        configureZephyrIntegration({
            baseUrl: process.env.ZEPHYR_BASE_URL || 'https://your-zephyr-instance.com',
            username: process.env.ZEPHYR_USERNAME || 'your-username',
            apiToken: process.env.ZEPHYR_API_TOKEN || 'your-zephyr-api-token',
            projectKey: process.env.ZEPHYR_PROJECT_KEY || 'TEST',
            zephyrType: (process.env.ZEPHYR_TYPE as 'scale' | 'squad') || 'scale'
        });

        // Xray Configuration
        configureXrayIntegration({
            baseUrl: process.env.XRAY_BASE_URL || 'https://your-xray-instance.com',
            username: process.env.XRAY_USERNAME || 'your-username',
            apiToken: process.env.XRAY_API_TOKEN || 'your-xray-api-token',
            projectKey: process.env.XRAY_PROJECT_KEY || 'TEST',
            xrayType: (process.env.XRAY_TYPE as 'cloud' | 'server') || 'cloud'
        });

        console.log('✅ Test management integrations configured successfully');
        console.log('Integration status:', getIntegrationStatus());

    } catch (error) {
        console.log('⚠️  Integration configuration skipped - implementations not ready');
        console.log('This is expected for placeholder integrations');
    }
};

/**
 * Environment variables that should be set for integrations:
 *
 * JIRA_BASE_URL=https://your-company.atlassian.net
 * JIRA_USERNAME=your-email@company.com
 * JIRA_API_TOKEN=your-jira-api-token
 * JIRA_PROJECT_KEY=TEST
 *
 * ZEPHYR_BASE_URL=https://your-zephyr-instance.com
 * ZEPHYR_USERNAME=your-username
 * ZEPHYR_API_TOKEN=your-zephyr-api-token
 * ZEPHYR_PROJECT_KEY=TEST
 * ZEPHYR_TYPE=scale
 *
 * XRAY_BASE_URL=https://your-xray-instance.com
 * XRAY_USERNAME=your-username
 * XRAY_API_TOKEN=your-xray-api-token
 * XRAY_PROJECT_KEY=TEST
 * XRAY_TYPE=cloud
 */

// You can call this function in your test setup
// configureTestManagementIntegrations();

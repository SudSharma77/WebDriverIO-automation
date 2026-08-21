/**
 * Test Management Integrations Index
 *
 * This file exports all test management integration placeholders.
 * These integrations are ready to be implemented when needed.
 */

// JIRA Integration
export {
    configureJiraIntegration, getJiraIntegration, JiraIntegration
} from './JiraIntegration';

export type {
    JiraConfig,
    JiraIssue,
    TestResult
} from './JiraIntegration';

// Zephyr Integration
export {
    configureZephyrIntegration, getZephyrIntegration, ZephyrIntegration
} from './ZephyrIntegration';

export type {
    ZephyrConfig,
    ZephyrTestCase, ZephyrTestCycle, ZephyrTestExecution, ZephyrTestStep
} from './ZephyrIntegration';

// Xray Integration
export {
    configureXrayIntegration, getXrayIntegration, XrayIntegration
} from './XrayIntegration';

export type {
    XrayConfig, XrayEvidence, XrayTest, XrayTestExecution,
    XrayTestExecutionResult, XrayTestPlan,
    XrayTestSet, XrayTestStep
} from './XrayIntegration';

// Import the functions so we can use them in helper functions
import { getJiraIntegration } from './JiraIntegration';
import { getXrayIntegration } from './XrayIntegration';
import { getZephyrIntegration } from './ZephyrIntegration';

/**
 * Integration Helper Functions
 * These functions provide easy access to configured integrations
 */

/**
 * Check if JIRA integration is configured
 * @returns boolean - True if JIRA integration is configured
 */
export const isJiraConfigured = (): boolean => {
    try {
        getJiraIntegration();
        return true;
    } catch {
        return false;
    }
};

/**
 * Check if Zephyr integration is configured
 * @returns boolean - True if Zephyr integration is configured
 */
export const isZephyrConfigured = (): boolean => {
    try {
        getZephyrIntegration();
        return true;
    } catch {
        return false;
    }
};

/**
 * Check if Xray integration is configured
 * @returns boolean - True if Xray integration is configured
 */
export const isXrayConfigured = (): boolean => {
    try {
        getXrayIntegration();
        return true;
    } catch {
        return false;
    }
};

/**
 * Get configured integrations summary
 * @returns object - Summary of configured integrations
 */
export const getIntegrationStatus = () => {
    return {
        jira: isJiraConfigured(),
        zephyr: isZephyrConfigured(),
        xray: isXrayConfigured()
    };
};

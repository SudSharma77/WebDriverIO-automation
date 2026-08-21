import { config as sharedConfig } from './wdio.shared.config.js';

export const config = {
    ...sharedConfig,

    // Minimal capabilities for API tests (no actual browser needed)
    capabilities: [{
        // Use headless mode since we don't need to see the browser
        browserName: 'chrome',
        'goog:chromeOptions': {
            args: ['--headless', '--disable-gpu', '--no-sandbox']
        }
    }],

    // Test files pattern for API tests
    specs: [
        '**/api.simple.spec.ts'
    ],

    // Minimal services for API tests
    services: [],

    // Reporters
    reporters: [
        'spec',
        ['allure', {
            outputDir: 'allure-results',
            disableWebdriverStepsReporting: true,
            disableWebdriverScreenshotsReporting: true
        }]
    ],

    // API tests run much faster
    mochaOpts: {
        ui: 'bdd',
        timeout: 30000  // Reduced timeout for API tests
    },

    // Override hooks to remove browser-specific actions
    afterTest: function (test: any, _context: any, { error }: any) {
        if (error) {
            console.log(`API Test failed: ${test.title} - Error: ${error.message}`);
        }
    },

    // Remove browser screenshot on error since we have no browser
    beforeCommand: function (commandName: string, args: any[]) {
        if (process.env.DEBUG_MODE === 'true') {
            console.log(`API Command: ${commandName} with args: ${JSON.stringify(args)}`);
        }
    }
};

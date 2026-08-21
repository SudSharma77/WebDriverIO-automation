import { config as sharedConfig } from './wdio.shared.config.js';

export const config: WebdriverIO.Config = {
    ...sharedConfig,

    // Multiremote configuration - specify capabilities as multiremote object
    capabilities: {
        // Chrome browser instance
        chrome: {
            capabilities: {
                browserName: 'chrome',
                browserVersion: 'stable',
                'goog:chromeOptions': {
                    args: [
                        '--no-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--window-size=1920,1080'
                    ]
                }
            }
        },

        // Second Chrome instance for comparison
        chrome2: {
            capabilities: {
                browserName: 'chrome',
                browserVersion: 'stable',
                'goog:chromeOptions': {
                    args: [
                        '--no-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--window-size=1920,1080'
                    ]
                }
            }
        }
    } as any, // TypeScript workaround for multiremote capabilities

    // Test specs for multiremote
    specs: [
        './test/specs/**/*.multiremote.spec.ts'
    ],

    // Increase timeout for multiremote scenarios
    waitforTimeout: 15000,
    connectionRetryTimeout: 120000,
    connectionRetryCount: 3,

    // Framework configuration
    framework: 'mocha',
    mochaOpts: {
        ui: 'bdd',
        timeout: 120000 // Increased timeout for complex multiremote scenarios
    },

    // Hooks specific to multiremote
    beforeSession: function (config, capabilities) {
        console.log('Starting multiremote session with browsers:', Object.keys(capabilities as any));
    },

    beforeTest: function (test: any) {
        console.log(`Starting multiremote test: ${test.title}`);
    },

    afterTest: function (test: any, _context: any, { error }: any) {
        if (error) {
            // Take screenshots from all browser instances on failure
            const browserNames = Object.keys(browser as any);
            browserNames.forEach(async (browserName) => {
                try {
                    await (browser as any)[browserName].saveScreenshot(
                        `./screenshots/multiremote-error-${browserName}-${test.title}-${Date.now()}.png`
                    );
                } catch (screenshotError) {
                    console.log(`Failed to take screenshot for ${browserName}:`, screenshotError);
                }
            });
        }
    },

    afterSession: function () {
        console.log('Multiremote session completed');
    }
};

export const config = {
    // Test execution
    autoCompileOpts: {
        autoCompile: true,
        tsNodeOpts: {
            transpileOnly: true,
            project: './tsconfig.json'
        }
    },

    // Base configuration
    maxInstances: 1,
    logLevel: 'info' as const,
    bail: 0,
    waitforTimeout: 10000,
    connectionRetryTimeout: 120000,
    connectionRetryCount: 3,

    // Framework
    framework: 'mocha' as const,
    mochaOpts: {
        ui: 'bdd',
        timeout: 60000
    },

    // Hooks
    beforeSuite: function (suite: any) {
        console.log(`Starting test suite: ${suite.title}`);
    },

    beforeTest: function (test: any) {
        console.log(`Starting test: ${test.title}`);
    },

    afterTest: function (test: any, _context: any, { error }: any) {
        if (error) {
            browser.saveScreenshot(`./screenshots/error-${test.title}-${Date.now()}.png`);
        }
    },

    beforeCommand: function (commandName: string, args: any[]) {
        if (process.env.DEBUG_MODE === 'true') {
            console.log(`Executing command: ${commandName} with args: ${JSON.stringify(args)}`);
        }
    },

    afterCommand: function (commandName: string, args: any[], result: any, error: any) {
        if (error && process.env.DEBUG_MODE === 'true') {
            console.log(`Command ${commandName} failed with error: ${error.message}`);
        }
    },

    onComplete: function () {
        console.log('Test execution completed');
        if (process.env.GENERATE_ALLURE_REPORT === 'true') {
            const allure = require('allure-commandline');
            const generation = allure(['generate', 'allure-results', '--clean']);
            generation.on('exit', function() {
                console.log('Allure report generated successfully');
            });
        }
    }
};

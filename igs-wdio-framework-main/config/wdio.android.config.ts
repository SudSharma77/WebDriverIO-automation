import { config as sharedConfig } from './wdio.shared.config';

export const config = {
    ...sharedConfig,

    // Test execution
    specs: [
        './test/specs/**/*.android.spec.ts',
        './test/specs/**/mobile.*.spec.ts'
    ],
    exclude: [
        './test/specs/**/*.web.spec.ts',
        './test/specs/**/*.ios.spec.ts',
        './test/specs/**/*.api.spec.ts'
    ],

    // Android-specific settings
    maxInstances: 1,
    waitforTimeout: 30000,

    // Capabilities for Android
    capabilities: [{
        platformName: 'Android',
        'appium:deviceName': 'RZCW518S2GH',
        'appium:platformVersion': '14',
        'appium:automationName': 'UiAutomator2',
        // Use preinstalled Chrome browser for testing
        'appium:appPackage': 'com.android.chrome',
        'appium:appActivity': 'com.google.android.apps.chrome.Main',
        'appium:noReset': false,
        'appium:fullReset': false,
        'appium:newCommandTimeout': 240,
        'appium:autoGrantPermissions': true,
        'appium:skipDeviceInitialization': true,
        'appium:skipServerInstallation': true
    }],

    // Services
    services: [
        ['appium', {
            command: 'appium',
            args: {
                port: 4723,
                basePath: '/wd/hub',
                relaxedSecurity: true,
                address: '127.0.0.1',
                logLevel: 'info'
            },
            logPath: './logs/'
        }]
    ],

    // Mobile-specific Mocha configuration
    mochaOpts: {
        ...sharedConfig.mochaOpts,
        timeout: 120000
    },

    // Reporters
    reporters: [
        'spec',
        ['allure', {
            outputDir: 'allure-results',
            disableWebdriverStepsReporting: false,
            disableWebdriverScreenshotsReporting: false
        }],
        ['timeline', {
            outputDir: 'timeline-reports',
            embedImages: true,
            screenshotStrategy: 'on:error'
        }]
    ],

    // Hooks for better Appium management
    onPrepare: async function () {
        console.log('🚀 Starting Android mobile test execution...');
        console.log('📱 Checking for available Android devices...');

        // Add a small delay to ensure Appium service starts properly
        await new Promise(resolve => setTimeout(resolve, 2000));
    },

    onComplete: function (exitCode: any) {
        console.log('✅ Android mobile test execution completed');
        if (exitCode === 0) {
            console.log('🎉 All mobile tests passed!');
        } else {
            console.log('❌ Some mobile tests failed');
        }
    },

    beforeSession: function (_config: any, capabilities: any) {
        console.log('🔧 Initializing mobile session...');
        console.log(`📋 Target device: ${capabilities['appium:deviceName']}`);
        console.log(`🤖 Android version: ${capabilities['appium:platformVersion']}`);
    },

    afterSession: function () {
        console.log('🏁 Mobile session completed');
    }
};

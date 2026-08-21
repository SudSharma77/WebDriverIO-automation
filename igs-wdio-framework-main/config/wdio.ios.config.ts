import { config as sharedConfig } from './wdio.shared.config';

export const config = {
    ...sharedConfig,
    
    // Test execution
    specs: [
        './test/specs/**/*.ios.spec.ts'
    ],
    exclude: [
        './test/specs/**/*.web.spec.ts',
        './test/specs/**/*.android.spec.ts',
        './test/specs/**/*.api.spec.ts'
    ],
    
    // iOS-specific settings
    maxInstances: 1,
    waitforTimeout: 30000,
    
    // Capabilities for iOS
    capabilities: [{
        platformName: 'iOS',
        'appium:deviceName': process.env.IOS_DEVICE_NAME || 'iPhone 14',
        'appium:platformVersion': process.env.IOS_PLATFORM_VERSION || '16.0',
        'appium:automationName': 'XCUITest',
        'appium:app': process.env.IOS_APP_PATH || './apps/ios/IGSApp.app',
        'appium:bundleId': process.env.IOS_BUNDLE_ID || 'com.igs.testapp',
        'appium:noReset': false,
        'appium:fullReset': false,
        'appium:newCommandTimeout': 240,
        'appium:autoAcceptAlerts': false,
        'appium:autoDismissAlerts': false,
        'appium:useNewWDA': false,
        'appium:usePrebuiltWDA': true
    }],
    
    // Services
    services: [
        ['appium', {
            command: 'appium',
            args: {
                port: 4723,
                basePath: '/wd/hub',
                relaxedSecurity: true,
                address: '127.0.0.1'
            }
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
    ]
};

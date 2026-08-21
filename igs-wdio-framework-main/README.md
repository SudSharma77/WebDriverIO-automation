# IGS WebDriverIO Framework

A comprehensive test automation framework built with WebDriverIO v9 for cross-platform testing including web browsers, mobile devices (Android/iOS), multiremote cross-browser testing, and API testing capabilities.

## 🚀 Features

- **Multi-Platform Support**: Web, Android, iOS, and API testing
- **Multiremote Testing**: Cross-browser testing with multiple browser instances
- **TypeScript First**: Full type safety and IntelliSense support
- **Test Data Management**: Comprehensive CSV and JSON test data handling with caching, filtering, and validation
- **Test Management Integrations**: Ready-to-implement placeholders for JIRA, Zephyr, and Xray integrations
- **Comprehensive Utilities**: Pre-built helper utilities for common testing scenarios
- **Page Object Model**: Scalable and maintainable test structure
- **Advanced Reporting**: Allure and Timeline reports with screenshots
- **Configuration Management**: Environment-specific configurations
- **CI/CD Ready**: Easy integration with continuous integration pipelines

## 📁 Project Structure

```ini
├── config/                    # WebDriverIO configurations
│   ├── wdio.shared.config.ts  # Shared configuration
│   ├── wdio.web.config.ts     # Web browser testing
│   ├── wdio.android.config.ts # Android mobile testing
│   ├── wdio.ios.config.ts     # iOS mobile testing
│   └── wdio.multiremote.config.ts # Multiremote cross-browser testing
├── src/
│   ├── pageObjects/           # Page Object Model classes
│   │   ├── BasePage.ts        # Base page class
│   │   └── web/               # Web-specific pages
│   └── utilities/             # Helper utilities
│       ├── generic/           # Generic utility classes
│       │   ├── ApiHelper.ts       # API testing utilities
│       │   ├── BrowserHelper.ts   # Browser interaction utilities
│       │   ├── ConfigHelper.ts    # Configuration management
│       │   ├── DataGenerator.ts   # Test data generation
│       │   ├── ElementHelper.ts   # Element interaction utilities
│       │   ├── FormHelper.ts      # Form handling utilities
│       │   ├── MobileHelper.ts    # Mobile-specific utilities
│       │   ├── MultiremoteHelper.ts # Multiremote coordination utilities
│       │   ├── TestDataHelper.ts  # Test data management (CSV/JSON)
│       │   ├── ValidationHelper.ts # Assertion and validation utilities
│       │   └── WaitHelper.ts      # Advanced waiting mechanisms
│       ├── integrations/      # Test management integrations
│       │   ├── JiraIntegration.ts  # JIRA integration placeholder
│       │   ├── ZephyrIntegration.ts # Zephyr integration placeholder
│       │   ├── XrayIntegration.ts  # Xray integration placeholder
│       │   └── index.ts           # Integration exports
│       ├── business/          # Business logic utilities
│       └── index.ts           # Centralized exports
├── test/
│   ├── data/                  # Test data files
│   │   ├── users.json         # User test data (JSON)
│   │   ├── users.csv          # User test data (CSV)
│   │   ├── products.json      # Product test data (JSON)
│   │   └── products.csv       # Product test data (CSV)
│   └── specs/                 # Test specifications
│       ├── *.web.spec.ts      # Web browser tests
│       ├── *.android.spec.ts  # Android mobile tests
│       ├── *.ios.spec.ts      # iOS mobile tests
│       ├── *.multiremote.spec.ts # Multiremote cross-browser tests
│       └── testdata.example.spec.ts # Test data usage examples
├── docs/                      # Documentation
├── screenshots/               # Test screenshots
├── logs/                      # Test execution logs
└── allure-results/           # Allure test results
```

## 🛠️ Prerequisites

- **Node.js**: Version 16.13.0 or higher
- **npm**: Version 7 or higher
- **Java**: JDK 8 or higher (for mobile testing)
- **Android SDK**: For Android testing
- **Xcode**: For iOS testing (macOS only)

## 📦 Installation

1. **Clone the repository**:

```bash
git clone <repository-url>
cd igs-wdio-framework

```

2. **Install dependencies**:

```bash
npm install

```

3. **Set up environment variables**:

```bash
cp .env.example .env
# Edit .env file with your configuration

```

4. **Build the project**:

```bash
npm run build

```

## ⚡ Quick Start

### Web Testing

```bash
npm run test:web

```

### Mobile Testing

```bash
# Android
npm run test:android

# iOS
npm run test:ios

```

### Multiremote Cross-Browser Testing

```bash
# Run tests across Chrome, Firefox, and Edge simultaneously
npm run test:multiremote

```

### Generate Reports

```bash
# Generate Allure report
npm run allure:generate

# Open Allure report
npm run allure:open

# Serve Allure report
npm run allure:serve

```

## 🧰 Utility Helpers

The framework includes comprehensive utility helpers for common testing scenarios:

### Browser Utilities

```typescript
import { BrowserHelper } from '@utilities/index';

// Wait for page to load completely
await BrowserHelper.waitForPageLoad();

// Take screenshots
await BrowserHelper.takeScreenshot('test-screenshot');

// Manage windows and tabs
await BrowserHelper.openNewTab('https://example.com');
await BrowserHelper.closeCurrentTab();

// Scroll operations
await BrowserHelper.scrollToBottom();
await BrowserHelper.scrollToTop();

```

### Element Utilities

```typescript
import { ElementHelper } from '@utilities/index';

// Safe element interactions with retry
await ElementHelper.safeClick('.submit-button', 3);
await ElementHelper.safeType('#username', 'testuser');

// Element state checks
const isVisible = await ElementHelper.isElementVisible('.modal');
const isEnabled = await ElementHelper.isElementEnabled('button');

// Advanced interactions
await ElementHelper.dragAndDrop('.source', '.target');
await ElementHelper.uploadFile('#file-input', './test-file.pdf');

```

### Form Utilities

```typescript
import { FormHelper } from '@utilities/index';

// Fill entire forms with data objects
const formData = {
  '#username': 'testuser',
  '#password': 'password123',
  '#email': 'test@example.com'
};
await FormHelper.fillForm(formData);

// Handle different input types
await FormHelper.selectRadioButton('gender', 'male');
await FormHelper.setCheckbox('#newsletter', true);
await FormHelper.selectByText('#country', 'United States');

// Form validation
await FormHelper.submitForm('.submit-btn');
await FormHelper.validateFormSubmissionSuccess('.success-message');

```

### Multiremote Utilities

```typescript
import { MultiremoteHelper } from '@utilities/index';

// Navigate all browsers to the same page
await MultiremoteHelper.navigateAllTo('https://example.com');
await MultiremoteHelper.waitForPageLoadAll();

// Execute actions on specific browsers
await MultiremoteHelper.clickOnBrowser('chrome', '.login-button');
await MultiremoteHelper.typeOnBrowser('firefox', '#username', 'testuser');

// Coordinate actions across multiple browsers
await MultiremoteHelper.simulateCollaboration({
  chrome: async () => {
    await MultiremoteHelper.clickOnBrowser('chrome', '.add-item');
  },
  firefox: async () => {
    await MultiremoteHelper.clickOnBrowser('firefox', '.edit-item');
  }
});

// Take screenshots from all browsers
await MultiremoteHelper.takeScreenshotAll('collaboration-test');

// Verify consistency across browsers
await MultiremoteHelper.verifyTextAcrossBrowsers('.status', 'Updated');

```

### Validation Utilities

```typescript
import { ValidationHelper } from '@utilities/index';

// Element assertions
await ValidationHelper.assertElementVisible('.header');
await ValidationHelper.assertElementText('.title', 'Welcome');
await ValidationHelper.assertElementCount('.list-item', 5);

// Page assertions
await ValidationHelper.assertPageTitle('Home Page');
await ValidationHelper.assertPageUrl('/dashboard');

// Soft assertions (collect multiple failures)
await ValidationHelper.softAssert(
  async () => await ValidationHelper.assertElementVisible('.modal'),
  'Modal should be visible'
);
ValidationHelper.assertAllSoftAssertions(); // Throws if any failed

```

### Mobile Utilities

```typescript
import { MobileHelper } from '@utilities/index';

// Touch gestures
await MobileHelper.swipeDirection('up', 0.5);
await MobileHelper.longPress('.element', 2000);
await MobileHelper.pinchZoom(1.5);

// Device operations
await MobileHelper.hideKeyboard();
await MobileHelper.setOrientation('LANDSCAPE');

// App management
await MobileHelper.launchApp('com.example.app');
await MobileHelper.closeApp('com.example.app');

```

### API Utilities

```typescript
import { ApiHelper } from '@utilities/index';

// Setup
ApiHelper.setBaseURL('https://api.example.com');
ApiHelper.setAuthToken('your-token', 'Bearer');

// HTTP requests
const response = await ApiHelper.get('/users/1');
const createResponse = await ApiHelper.post('/users', userData);

// Validation
ApiHelper.validateStatusCode(response, 200);
ApiHelper.validateResponseData(response, 'name', 'John Doe');
ApiHelper.validateResponseSchema(response, {
  id: 'number',
  name: 'string',
  email: 'string'
});

// Test data management
const testData = ApiHelper.generateTestData({
  name: 'User {{random_string}}',
  email: '{{random_email}}'
});

```

### Test Data Management

```typescript
import { testDataHelper } from '@utilities/index';

// Load test data from JSON files
const users = testDataHelper.loadJsonData('users.json');
const testUser = testDataHelper.getRecordByIndex('users.json', 0);

// Load test data from CSV files
const csvUsers = testDataHelper.loadCsvData('users.csv');

// Filter data by criteria
const adminUsers = testDataHelper.filterRecords('users.json', { role: 'admin' });
const activeUsers = testDataHelper.filterRecords('users.json', { isActive: true });

// Find specific records
const user = testDataHelper.getRecordByField('users.json', 'email', 'testuser1@example.com');

// Use in tests
await browser.url('/login');
await $('#username').setValue(testUser.username);
await $('#password').setValue(testUser.password);

// Data-driven testing
for (const user of adminUsers) {
    // Test each admin user scenario
    console.log(`Testing admin user: ${user.username}`);
}

// Performance monitoring
const stats = testDataHelper.getPerformanceStats();
console.log(`Cache hit rate: ${stats.cacheHitRate}`);

```

## ⚙️ Configuration

### Environment Variables

Create a `.env` file based on `.env.example`:

```env
# Base Configuration
BASE_URL=https://your-test-site.com
DEBUG_MODE=false
GENERATE_ALLURE_REPORT=true

# Android Configuration
ANDROID_DEVICE_NAME=emulator-5554
ANDROID_PLATFORM_VERSION=11
ANDROID_APP_PATH=./apps/android/app-debug.apk
ANDROID_APP_PACKAGE=com.example.app
ANDROID_APP_ACTIVITY=.MainActivity

# iOS Configuration
IOS_DEVICE_NAME=iPhone 14
IOS_PLATFORM_VERSION=16.0
IOS_APP_PATH=./apps/ios/IGSApp.app
IOS_BUNDLE_ID=com.igs.testapp

```

### WebDriverIO Configurations

The framework uses separate configurations for different platforms:

- **`config/wdio.shared.config.ts`**: Common settings shared across all platforms
- **`config/wdio.web.config.ts`**: Web browser testing configuration
- **`config/wdio.android.config.ts`**: Android mobile testing configuration
- **`config/wdio.ios.config.ts`**: iOS mobile testing configuration

### Test Specifications

Organize your tests using naming conventions:

- **Web tests**: `*.web.spec.ts`
- **Android tests**: `*.android.spec.ts`
- **iOS tests**: `*.ios.spec.ts`
- **API tests**: `*.api.spec.ts`

## 📝 Writing Tests

### Basic Test Structure

```typescript
import { expect } from '@wdio/globals';
import { BrowserHelper, ElementHelper, ValidationHelper } from '@utilities/index';
import { HomePage } from '@pages/web/HomePage';

describe('Sample Test Suite', () => {
    let homePage: HomePage;

    beforeEach(async () => {
        homePage = new HomePage();
        await homePage.open();
        await BrowserHelper.waitForPageLoad();
    });

    it('should perform basic interaction', async () => {
        // Use helper utilities for interactions
        await ElementHelper.safeClick(homePage.loginButton);
        await ElementHelper.safeType(homePage.usernameInput, 'testuser');

        // Use validation helpers for assertions
        await ValidationHelper.assertElementVisible(homePage.welcomeMessage);
        await ValidationHelper.assertElementText(homePage.title, 'Welcome');
    });

    afterEach(async () => {
        // Take screenshot for debugging
        await BrowserHelper.takeScreenshot('test-completed');
    });
});

```

### Page Object Model

```typescript
import { BasePage } from './BasePage';

export class HomePage extends BasePage {
    // Selectors
    get loginButton() { return '#login-btn'; }
    get usernameInput() { return '#username'; }
    get welcomeMessage() { return '.welcome-message'; }
    get title() { return 'h1'; }

    // Page actions
    async open() {
        await super.open('/');
    }

    async login(username: string, password: string) {
        await ElementHelper.safeType(this.usernameInput, username);
        await ElementHelper.safeType('#password', password);
        await ElementHelper.safeClick(this.loginButton);
    }
}

```

## 🚀 Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript files |
| `npm run clean` | Clean build artifacts and reports |
| `npm run test:web` | Run web browser tests |
| `npm run test:android` | Run Android mobile tests |
| `npm run test:ios` | Run iOS mobile tests |
| `npm run test:multiremote` | Run multiremote cross-browser tests |
| `npm run allure:generate` | Generate Allure HTML report |
| `npm run allure:open` | Open Allure report in browser |
| `npm run allure:serve` | Serve Allure report |
| `npm run lint` | Run ESLint on source files |
| `npm run lint:fix` | Fix ESLint issues automatically |
| `npm start` | Shortcut for `npm run test:web` |

## 📊 Reporting

### Allure Reports

The framework generates detailed Allure reports with:

- Test execution timeline
- Screenshots on failure
- Step-by-step test details
- Environment information
- Trend analysis

### Timeline Reports

Timeline reports provide:

- Visual test execution timeline
- Performance metrics
- Resource usage
- Parallel execution overview

## 🔧 Best Practices

### Test Organization

- Use descriptive test names and descriptions
- Group related tests in describe blocks
- Implement proper setup and teardown
- Keep tests independent and atomic

### Page Objects

- Extend the BasePage class for common functionality
- Use getter methods for element selectors
- Implement page-specific actions as methods
- Keep selectors and actions separate

### Helper Usage

- Use appropriate helpers for different types of interactions
- Leverage retry mechanisms for flaky elements
- Implement proper waiting strategies
- Use validation helpers for consistent assertions

### Multiremote Testing

- Use MultiremoteHelper for coordinating actions across browsers
- Test cross-browser compatibility and real-time collaboration scenarios
- Take screenshots from all browsers for comprehensive debugging
- Verify consistency of behavior across different browser engines

### Configuration Management

- Use environment variables for test data
- Separate configurations by platform
- Keep sensitive data in environment files
- Document configuration options

### Error Handling

- Use try-catch blocks for expected failures
- Implement proper cleanup in afterEach hooks
- Take screenshots on test failures
- Log meaningful error messages

## 🔍 Debugging

### Debug Mode

Enable debug mode for verbose logging:

```bash
DEBUG_MODE=true npm run test:web
DEBUG_MODE=true npm run test:multiremote

```

### Screenshots

Screenshots are automatically taken:

- On test failures (from all browsers in multiremote mode)
- When explicitly called using `BrowserHelper.takeScreenshot()` or `MultiremoteHelper.takeScreenshotAll()`
- Stored in the `screenshots/` directory

### Logs

Test execution logs are stored in the `logs/` directory and include:

- WebDriver commands
- Test execution flow
- Error details
- Performance metrics
- Multiremote coordination logs

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Make your changes and add tests
4. Run the test suite: `npm test`
5. Commit your changes: `git commit -m 'Add new feature'`
6. Push to the branch: `git push origin feature/new-feature`
7. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 📞 Support

For questions and support:

- Create an issue in the repository
- Check the documentation in the `docs/` folder
- Review the example tests in `test/specs/`
- See the [Test Data Management Guide](docs/TEST_DATA_GUIDE.md) for comprehensive test data usage
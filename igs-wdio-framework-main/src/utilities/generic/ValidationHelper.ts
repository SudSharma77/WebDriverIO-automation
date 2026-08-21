/**
 * Validation Helper Utility
 * Provides comprehensive validation and assertion methods for testing
 */
export class ValidationHelper {
    /**
     * Assert element is visible
     * @param selector - Element selector
     * @param timeout - Timeout in milliseconds
     */
    static async assertElementVisible(selector: string, timeout: number = 10000): Promise<void> {
        const element = await $(selector);
        await element.waitForDisplayed({ 
            timeout,
            timeoutMsg: `Element '${selector}' was not visible within ${timeout}ms`
        });
        
        const isDisplayed = await element.isDisplayed();
        if (!isDisplayed) {
            throw new Error(`Element '${selector}' exists but is not visible`);
        }
    }

    /**
     * Assert element is not visible
     * @param selector - Element selector
     * @param timeout - Timeout in milliseconds
     */
    static async assertElementNotVisible(selector: string, timeout: number = 5000): Promise<void> {
        try {
            const element = await $(selector);
            await element.waitForDisplayed({ 
                timeout,
                reverse: true,
                timeoutMsg: `Element '${selector}' was still visible after ${timeout}ms`
            });
        } catch (error) {
            // Element might not exist, which is also valid for "not visible"
            const elements = await $$(selector);
            const length = await elements.length;
            if (length > 0) {
                throw error;
            }
        }
    }

    /**
     * Assert element exists in DOM
     * @param selector - Element selector
     * @param timeout - Timeout in milliseconds
     */
    static async assertElementExists(selector: string, timeout: number = 10000): Promise<void> {
        const element = await $(selector);
        await element.waitForExist({ 
            timeout,
            timeoutMsg: `Element '${selector}' does not exist in DOM within ${timeout}ms`
        });
    }

    /**
     * Assert element does not exist in DOM
     * @param selector - Element selector
     * @param timeout - Timeout in milliseconds
     */
    static async assertElementNotExists(selector: string, timeout: number = 5000): Promise<void> {
        const element = await $(selector);
        await element.waitForExist({ 
            timeout,
            reverse: true,
            timeoutMsg: `Element '${selector}' still exists in DOM after ${timeout}ms`
        });
    }

    /**
     * Assert element is clickable
     * @param selector - Element selector
     * @param timeout - Timeout in milliseconds
     */
    static async assertElementClickable(selector: string, timeout: number = 10000): Promise<void> {
        const element = await $(selector);
        await element.waitForClickable({ 
            timeout,
            timeoutMsg: `Element '${selector}' was not clickable within ${timeout}ms`
        });
    }

    /**
     * Assert element is enabled
     * @param selector - Element selector
     */
    static async assertElementEnabled(selector: string): Promise<void> {
        const element = await $(selector);
        await element.waitForDisplayed();
        
        const isEnabled = await element.isEnabled();
        if (!isEnabled) {
            throw new Error(`Element '${selector}' is not enabled`);
        }
    }

    /**
     * Assert element is disabled
     * @param selector - Element selector
     */
    static async assertElementDisabled(selector: string): Promise<void> {
        const element = await $(selector);
        await element.waitForDisplayed();
        
        const isEnabled = await element.isEnabled();
        if (isEnabled) {
            throw new Error(`Element '${selector}' is not disabled`);
        }
    }

    /**
     * Assert element text equals expected value
     * @param selector - Element selector
     * @param expectedText - Expected text
     * @param exact - Whether to match exactly or contain
     */
    static async assertElementText(selector: string, expectedText: string, exact: boolean = true): Promise<void> {
        const element = await $(selector);
        await element.waitForDisplayed();
        
        const actualText = await element.getText();
        
        if (exact) {
            if (actualText !== expectedText) {
                throw new Error(`Expected text '${expectedText}', but got '${actualText}'`);
            }
        } else {
            if (!actualText.includes(expectedText)) {
                throw new Error(`Expected text to contain '${expectedText}', but got '${actualText}'`);
            }
        }
    }

    /**
     * Assert element text matches regex pattern
     * @param selector - Element selector
     * @param pattern - Regex pattern
     */
    static async assertElementTextMatches(selector: string, pattern: RegExp): Promise<void> {
        const element = await $(selector);
        await element.waitForDisplayed();
        
        const actualText = await element.getText();
        
        if (!pattern.test(actualText)) {
            throw new Error(`Text '${actualText}' does not match pattern ${pattern}`);
        }
    }

    /**
     * Assert element attribute value
     * @param selector - Element selector
     * @param attribute - Attribute name
     * @param expectedValue - Expected attribute value
     */
    static async assertElementAttribute(selector: string, attribute: string, expectedValue: string): Promise<void> {
        const element = await $(selector);
        await element.waitForDisplayed();
        
        const actualValue = await element.getAttribute(attribute);
        
        if (actualValue !== expectedValue) {
            throw new Error(`Expected attribute '${attribute}' to be '${expectedValue}', but got '${actualValue}'`);
        }
    }

    /**
     * Assert element has CSS class
     * @param selector - Element selector
     * @param className - CSS class name
     */
    static async assertElementHasClass(selector: string, className: string): Promise<void> {
        const element = await $(selector);
        await element.waitForDisplayed();
        
        const classAttribute = await element.getAttribute('class');
        const classes = classAttribute ? classAttribute.split(' ') : [];
        
        if (!classes.includes(className)) {
            throw new Error(`Element '${selector}' does not have class '${className}'. Classes: ${classes.join(', ')}`);
        }
    }

    /**
     * Assert element does not have CSS class
     * @param selector - Element selector
     * @param className - CSS class name
     */
    static async assertElementNotHasClass(selector: string, className: string): Promise<void> {
        const element = await $(selector);
        await element.waitForDisplayed();
        
        const classAttribute = await element.getAttribute('class');
        const classes = classAttribute ? classAttribute.split(' ') : [];
        
        if (classes.includes(className)) {
            throw new Error(`Element '${selector}' should not have class '${className}', but it does`);
        }
    }

    /**
     * Assert page title
     * @param expectedTitle - Expected page title
     * @param exact - Whether to match exactly or contain
     */
    static async assertPageTitle(expectedTitle: string, exact: boolean = true): Promise<void> {
        const actualTitle = await browser.getTitle();
        
        if (exact) {
            if (actualTitle !== expectedTitle) {
                throw new Error(`Expected page title '${expectedTitle}', but got '${actualTitle}'`);
            }
        } else {
            if (!actualTitle.includes(expectedTitle)) {
                throw new Error(`Expected page title to contain '${expectedTitle}', but got '${actualTitle}'`);
            }
        }
    }

    /**
     * Assert page URL
     * @param expectedUrl - Expected URL or URL part
     * @param exact - Whether to match exactly or contain
     */
    static async assertPageUrl(expectedUrl: string, exact: boolean = false): Promise<void> {
        const actualUrl = await browser.getUrl();
        
        if (exact) {
            if (actualUrl !== expectedUrl) {
                throw new Error(`Expected URL '${expectedUrl}', but got '${actualUrl}'`);
            }
        } else {
            if (!actualUrl.includes(expectedUrl)) {
                throw new Error(`Expected URL to contain '${expectedUrl}', but got '${actualUrl}'`);
            }
        }
    }

    /**
     * Assert element count
     * @param selector - Element selector
     * @param expectedCount - Expected number of elements
     */
    static async assertElementCount(selector: string, expectedCount: number): Promise<void> {
        const elements = await $$(selector);
        const actualCount = await elements.length;
        
        if (actualCount !== expectedCount) {
            throw new Error(`Expected ${expectedCount} elements with selector '${selector}', but found ${actualCount}`);
        }
    }

    /**
     * Assert element count is greater than
     * @param selector - Element selector
     * @param minCount - Minimum expected count
     */
    static async assertElementCountGreaterThan(selector: string, minCount: number): Promise<void> {
        const elements = await $$(selector);
        const actualCount = await elements.length;
        
        if (actualCount <= minCount) {
            throw new Error(`Expected more than ${minCount} elements with selector '${selector}', but found ${actualCount}`);
        }
    }

    /**
     * Assert element count is less than
     * @param selector - Element selector
     * @param maxCount - Maximum expected count
     */
    static async assertElementCountLessThan(selector: string, maxCount: number): Promise<void> {
        const elements = await $$(selector);
        const actualCount = await elements.length;
        
        if (actualCount >= maxCount) {
            throw new Error(`Expected less than ${maxCount} elements with selector '${selector}', but found ${actualCount}`);
        }
    }

    /**
     * Assert dropdown selected option
     * @param selector - Dropdown selector
     * @param expectedOption - Expected selected option text
     */
    static async assertDropdownSelection(selector: string, expectedOption: string): Promise<void> {
        const dropdown = await $(selector);
        await dropdown.waitForDisplayed();
        
        const selectedOption = await dropdown.$('option:checked');
        const selectedText = await selectedOption.getText();
        
        if (selectedText !== expectedOption) {
            throw new Error(`Expected dropdown option '${expectedOption}', but got '${selectedText}'`);
        }
    }

    /**
     * Assert checkbox is checked
     * @param selector - Checkbox selector
     */
    static async assertCheckboxChecked(selector: string): Promise<void> {
        const checkbox = await $(selector);
        await checkbox.waitForDisplayed();
        
        const isChecked = await checkbox.isSelected();
        if (!isChecked) {
            throw new Error(`Checkbox '${selector}' should be checked but is not`);
        }
    }

    /**
     * Assert checkbox is unchecked
     * @param selector - Checkbox selector
     */
    static async assertCheckboxUnchecked(selector: string): Promise<void> {
        const checkbox = await $(selector);
        await checkbox.waitForDisplayed();
        
        const isChecked = await checkbox.isSelected();
        if (isChecked) {
            throw new Error(`Checkbox '${selector}' should be unchecked but is checked`);
        }
    }

    /**
     * Assert radio button is selected
     * @param selector - Radio button selector
     */
    static async assertRadioSelected(selector: string): Promise<void> {
        const radio = await $(selector);
        await radio.waitForDisplayed();
        
        const isSelected = await radio.isSelected();
        if (!isSelected) {
            throw new Error(`Radio button '${selector}' should be selected but is not`);
        }
    }

    /**
     * Assert element value
     * @param selector - Element selector
     * @param expectedValue - Expected value
     */
    static async assertElementValue(selector: string, expectedValue: string): Promise<void> {
        const element = await $(selector);
        await element.waitForDisplayed();
        
        const actualValue = await element.getValue();
        if (actualValue !== expectedValue) {
            throw new Error(`Expected element value '${expectedValue}', but got '${actualValue}'`);
        }
    }

    /**
     * Assert element CSS property
     * @param selector - Element selector
     * @param property - CSS property name
     * @param expectedValue - Expected property value
     */
    static async assertElementCSSProperty(selector: string, property: string, expectedValue: string): Promise<void> {
        const element = await $(selector);
        await element.waitForDisplayed();
        
        const cssProperty = await element.getCSSProperty(property);
        const actualValue = cssProperty.value;
        
        if (actualValue !== expectedValue) {
            throw new Error(`Expected CSS property '${property}' to be '${expectedValue}', but got '${actualValue}'`);
        }
    }

    /**
     * Assert element is in viewport
     * @param selector - Element selector
     */
    static async assertElementInViewport(selector: string): Promise<void> {
        const element = await $(selector);
        await element.waitForDisplayed();
        
        // Check if element is in viewport using JavaScript
        const isInViewport = await browser.execute((el) => {
            const rect = el.getBoundingClientRect();
            return (
                rect.top >= 0 &&
                rect.left >= 0 &&
                rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                rect.right <= (window.innerWidth || document.documentElement.clientWidth)
            );
        }, element);
        
        if (!isInViewport) {
            throw new Error(`Element '${selector}' is not in viewport`);
        }
    }

    /**
     * Assert alert is present
     * @param expectedText - Expected alert text (optional)
     */
    static async assertAlertPresent(expectedText?: string): Promise<void> {
        try {
            const alertText = await browser.getAlertText();
            
            if (expectedText && alertText !== expectedText) {
                throw new Error(`Expected alert text '${expectedText}', but got '${alertText}'`);
            }
        } catch {
            throw new Error('No alert is present');
        }
    }

    /**
     * Assert no alert is present
     */
    static async assertNoAlertPresent(): Promise<void> {
        try {
            await browser.getAlertText();
            throw new Error('Alert is present when none was expected');
        } catch (error) {
            // This is expected - no alert present
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes('no such alert')) {
                throw error;
            }
        }
    }

    /**
     * Assert page contains text
     * @param expectedText - Expected text to find on page
     */
    static async assertPageContainsText(expectedText: string): Promise<void> {
        const pageText = await $('body').getText();
        
        if (!pageText.includes(expectedText)) {
            throw new Error(`Page does not contain text '${expectedText}'`);
        }
    }

    /**
     * Assert page does not contain text
     * @param unexpectedText - Text that should not be on page
     */
    static async assertPageNotContainsText(unexpectedText: string): Promise<void> {
        const pageText = await $('body').getText();
        
        if (pageText.includes(unexpectedText)) {
            throw new Error(`Page contains unexpected text '${unexpectedText}'`);
        }
    }

    /**
     * Assert elements are in correct order
     * @param selectors - Array of element selectors in expected order
     */
    static async assertElementsOrder(selectors: string[]): Promise<void> {
        const positions: { selector: string; y: number }[] = [];
        
        for (const selector of selectors) {
            const element = await $(selector);
            await element.waitForDisplayed();
            const location = await element.getLocation();
            positions.push({ selector, y: location.y });
        }
        
        // Check if elements are in correct vertical order
        for (let i = 1; i < positions.length; i++) {
            if (positions[i].y < positions[i - 1].y) {
                throw new Error(
                    `Elements are not in correct order. Element '${positions[i].selector}' ` +
                    `should be after '${positions[i - 1].selector}'`
                );
            }
        }
    }

    /**
     * Soft assertion - collects failures without throwing immediately
     */
    private static softAssertions: string[] = [];

    /**
     * Add soft assertion
     * @param assertion - Assertion function
     * @param description - Description of the assertion
     */
    static async softAssert(assertion: () => Promise<void>, description: string): Promise<void> {
        try {
            await assertion();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.softAssertions.push(`${description}: ${message}`);
        }
    }

    /**
     * Assert all soft assertions passed
     */
    static assertAllSoftAssertions(): void {
        if (this.softAssertions.length > 0) {
            const allErrors = this.softAssertions.join('\\n');
            this.softAssertions = []; // Clear for next test
            throw new Error(`Soft assertions failed:\\n${allErrors}`);
        }
    }

    /**
     * Clear soft assertions
     */
    static clearSoftAssertions(): void {
        this.softAssertions = [];
    }
}

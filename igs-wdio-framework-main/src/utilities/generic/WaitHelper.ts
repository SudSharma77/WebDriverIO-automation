/**
 * Wait Helper Utility
 * Provides advanced waiting mechanisms for test automation
 */
export class WaitHelper {
    /**
     * Wait for element to be present in DOM
     * @param selector - Element selector
     * @param timeout - Timeout in milliseconds
     */
    static async waitForElementPresent(selector: string, timeout: number = 10000): Promise<void> {
        await browser.waitUntil(
            async () => {
                const elements = await $$(selector);
                const length = await elements.length;
                return length > 0;
            },
            {
                timeout,
                timeoutMsg: `Element with selector '${selector}' was not present within ${timeout}ms`
            }
        );
    }

    /**
     * Wait for element to be visible
     * @param selector - Element selector
     * @param timeout - Timeout in milliseconds
     */
    static async waitForElementVisible(selector: string, timeout: number = 10000): Promise<void> {
        const element = await $(selector);
        await element.waitForDisplayed({
            timeout,
            timeoutMsg: `Element with selector '${selector}' was not visible within ${timeout}ms`
        });
    }

    /**
     * Wait for element to be clickable
     * @param selector - Element selector
     * @param timeout - Timeout in milliseconds
     */
    static async waitForElementClickable(selector: string, timeout: number = 10000): Promise<void> {
        const element = await $(selector);
        await element.waitForClickable({
            timeout,
            timeoutMsg: `Element with selector '${selector}' was not clickable within ${timeout}ms`
        });
    }

    /**
     * Wait for element to contain specific text
     * @param selector - Element selector
     * @param text - Expected text
     * @param timeout - Timeout in milliseconds
     */
    static async waitForElementText(selector: string, text: string, timeout: number = 10000): Promise<void> {
        await browser.waitUntil(
            async () => {
                const element = await $(selector);
                const elementText = await element.getText();
                return elementText.includes(text);
            },
            {
                timeout,
                timeoutMsg: `Element with selector '${selector}' did not contain text '${text}' within ${timeout}ms`
            }
        );
    }

    /**
     * Wait for page URL to contain specific text
     * @param urlPart - Expected URL part
     * @param timeout - Timeout in milliseconds
     */
    static async waitForUrlContains(urlPart: string, timeout: number = 10000): Promise<void> {
        await browser.waitUntil(
            async () => {
                const currentUrl = await browser.getUrl();
                return currentUrl.includes(urlPart);
            },
            {
                timeout,
                timeoutMsg: `URL did not contain '${urlPart}' within ${timeout}ms`
            }
        );
    }

    /**
     * Wait for page title to contain specific text
     * @param titlePart - Expected title part
     * @param timeout - Timeout in milliseconds
     */
    static async waitForTitleContains(titlePart: string, timeout: number = 10000): Promise<void> {
        await browser.waitUntil(
            async () => {
                const title = await browser.getTitle();
                return title.includes(titlePart);
            },
            {
                timeout,
                timeoutMsg: `Page title did not contain '${titlePart}' within ${timeout}ms`
            }
        );
    }

    /**
     * Wait for a specific number of elements
     * @param selector - Element selector
     * @param count - Expected number of elements
     * @param timeout - Timeout in milliseconds
     */
    static async waitForElementCount(selector: string, count: number, timeout: number = 10000): Promise<void> {
        await browser.waitUntil(
            async () => {
                const elements = await $$(selector);
                const length = await elements.length;
                return length === count;
            },
            {
                timeout,
                timeoutMsg: `Expected ${count} elements with selector '${selector}' but condition was not met within ${timeout}ms`
            }
        );
    }

    /**
     * Wait for element to be enabled
     * @param selector - Element selector
     * @param timeout - Timeout in milliseconds
     */
    static async waitForElementEnabled(selector: string, timeout: number = 10000): Promise<void> {
        await browser.waitUntil(
            async () => {
                const element = await $(selector);
                return await element.isEnabled();
            },
            {
                timeout,
                timeoutMsg: `Element with selector '${selector}' was not enabled within ${timeout}ms`
            }
        );
    }

    /**
     * Wait for element to be selected (checkboxes, radio buttons)
     * @param selector - Element selector
     * @param timeout - Timeout in milliseconds
     */
    static async waitForElementSelected(selector: string, timeout: number = 10000): Promise<void> {
        await browser.waitUntil(
            async () => {
                const element = await $(selector);
                return await element.isSelected();
            },
            {
                timeout,
                timeoutMsg: `Element with selector '${selector}' was not selected within ${timeout}ms`
            }
        );
    }

    /**
     * Generic wait with custom condition
     * @param condition - Function that returns boolean
     * @param timeout - Timeout in milliseconds
     * @param timeoutMsg - Custom timeout message
     */
    static async waitForCondition(
        condition: () => Promise<boolean>,
        timeout: number = 10000,
        timeoutMsg: string = 'Condition was not met within timeout'
    ): Promise<void> {
        await browser.waitUntil(condition, {
            timeout,
            timeoutMsg: `${timeoutMsg} (${timeout}ms)`
        });
    }

    /**
     * Simple wait/pause
     * @param milliseconds - Time to wait in milliseconds
     */
    static async pause(milliseconds: number): Promise<void> {
        await browser.pause(milliseconds);
    }
}

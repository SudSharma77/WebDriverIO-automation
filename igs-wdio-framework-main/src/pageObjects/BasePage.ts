/**
 * Base Page Object Class
 * Provides common functionality for all page objects
 */
export abstract class BasePage {
    /**
     * Wait for an element to be displayed
     * @param element - WebdriverIO element
     * @param timeout - Timeout in milliseconds
     */
    protected async waitForDisplayed(element: any, timeout: number = 10000): Promise<void> {
        await element.waitForDisplayed({ timeout });
    }

    /**
     * Wait for an element to be clickable
     * @param element - WebdriverIO element
     * @param timeout - Timeout in milliseconds
     */
    protected async waitForClickable(element: any, timeout: number = 10000): Promise<void> {
        await element.waitForClickable({ timeout });
    }

    /**
     * Click an element with wait
     * @param element - WebdriverIO element
     */
    protected async clickElement(element: any): Promise<void> {
        await this.waitForClickable(element);
        await element.click();
    }

    /**
     * Type text into an element
     * @param element - WebdriverIO element
     * @param text - Text to type
     * @param clearFirst - Whether to clear the field first
     */
    protected async typeText(element: any, text: string, clearFirst: boolean = true): Promise<void> {
        await this.waitForDisplayed(element);
        if (clearFirst) {
            await element.clearValue();
        }
        await element.setValue(text);
    }

    /**
     * Get text from an element
     * @param element - WebdriverIO element
     * @returns Element text
     */
    protected async getText(element: any): Promise<string> {
        await this.waitForDisplayed(element);
        return await element.getText();
    }

    /**
     * Check if element is displayed
     * @param element - WebdriverIO element
     * @returns Boolean indicating if element is displayed
     */
    protected async isDisplayed(element: any): Promise<boolean> {
        try {
            return await element.isDisplayed();
        } catch {
            return false;
        }
    }

    /**
     * Scroll to an element
     * @param element - WebdriverIO element
     */
    protected async scrollToElement(element: any): Promise<void> {
        await element.scrollIntoView();
    }

    /**
     * Take a screenshot
     * @param name - Screenshot name
     */
    public async takeScreenshot(name: string): Promise<void> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        await browser.saveScreenshot(`./screenshots/${name}-${timestamp}.png`);
    }

    /**
     * Wait for page to load (override in specific page classes)
     */
    abstract waitForPageToLoad(): Promise<void>;
}

/**
 * MultiremoteHelper - Utility functions for multiremote WebDriverIO scenarios
 * Provides helpers for coordinating actions across multiple browser instances
 */
export class MultiremoteHelper {
    /**
     * Execute action on all browser instances
     * @param action Function to execute on each browser
     * @param browserNames Optional array of browser names, defaults to all
     */
    static async executeOnAllBrowsers(
        action: (browserInstance: WebdriverIO.Browser, browserName: string) => Promise<void>,
        browserNames?: string[]
    ): Promise<void> {
        const browsers = browserNames || Object.keys(browser as any);
        
        for (const browserName of browsers) {
            const browserInstance = (browser as any)[browserName];
            await action(browserInstance, browserName);
        }
    }

    /**
     * Execute action on all browsers in parallel
     * @param action Function to execute on each browser
     * @param browserNames Optional array of browser names, defaults to all
     */
    static async executeOnAllBrowsersParallel(
        action: (browserInstance: WebdriverIO.Browser, browserName: string) => Promise<void>,
        browserNames?: string[]
    ): Promise<void> {
        const browsers = browserNames || Object.keys(browser as any);
        
        const promises = browsers.map(browserName => {
            const browserInstance = (browser as any)[browserName];
            return action(browserInstance, browserName);
        });
        
        await Promise.all(promises);
    }

    /**
     * Navigate all browsers to the same URL
     * @param url URL to navigate to
     * @param browserNames Optional array of browser names, defaults to all
     */
    static async navigateAllTo(url: string, browserNames?: string[]): Promise<void> {
        await this.executeOnAllBrowsersParallel(async (browserInstance) => {
            await browserInstance.url(url);
        }, browserNames);
    }

    /**
     * Wait for page load on all browsers
     * @param browserNames Optional array of browser names, defaults to all
     */
    static async waitForPageLoadAll(browserNames?: string[]): Promise<void> {
        await this.executeOnAllBrowsersParallel(async (browserInstance) => {
            await browserInstance.waitUntil(
                async () => await browserInstance.execute(() => document.readyState === 'complete'),
                {
                    timeout: 30000,
                    timeoutMsg: 'Page did not load completely'
                }
            );
        }, browserNames);
    }

    /**
     * Take screenshots from all browsers
     * @param filename Base filename for screenshots
     * @param browserNames Optional array of browser names, defaults to all
     */
    static async takeScreenshotAll(filename: string, browserNames?: string[]): Promise<void> {
        await this.executeOnAllBrowsersParallel(async (browserInstance, browserName) => {
            await browserInstance.saveScreenshot(`./screenshots/${filename}-${browserName}-${Date.now()}.png`);
        }, browserNames);
    }

    /**
     * Get element from specific browser instance
     * @param browserName Name of the browser instance
     * @param selector Element selector
     */
    static async getElementFromBrowser(browserName: string, selector: string): Promise<WebdriverIO.Element> {
        const browserInstance = (browser as any)[browserName];
        return await browserInstance.$(selector);
    }

    /**
     * Click element on specific browser
     * @param browserName Name of the browser instance
     * @param selector Element selector
     */
    static async clickOnBrowser(browserName: string, selector: string): Promise<void> {
        const element = await this.getElementFromBrowser(browserName, selector);
        await element.click();
    }

    /**
     * Type text on specific browser
     * @param browserName Name of the browser instance
     * @param selector Element selector
     * @param text Text to type
     */
    static async typeOnBrowser(browserName: string, selector: string, text: string): Promise<void> {
        const element = await this.getElementFromBrowser(browserName, selector);
        await element.setValue(text);
    }

    /**
     * Verify element text across all browsers
     * @param selector Element selector
     * @param expectedText Expected text content
     * @param browserNames Optional array of browser names, defaults to all
     */
    static async verifyTextAcrossBrowsers(
        selector: string, 
        expectedText: string, 
        browserNames?: string[]
    ): Promise<void> {
        await this.executeOnAllBrowsers(async (browserInstance, browserName) => {
            const element = await browserInstance.$(selector);
            const actualText = await element.getText();
            if (actualText !== expectedText) {
                throw new Error(`Text mismatch on ${browserName}: expected "${expectedText}", got "${actualText}"`);
            }
        }, browserNames);
    }

    /**
     * Wait for element to appear on all browsers
     * @param selector Element selector
     * @param timeout Optional timeout in milliseconds
     * @param browserNames Optional array of browser names, defaults to all
     */
    static async waitForElementOnAllBrowsers(
        selector: string, 
        timeout: number = 10000, 
        browserNames?: string[]
    ): Promise<void> {
        await this.executeOnAllBrowsersParallel(async (browserInstance) => {
            const element = await browserInstance.$(selector);
            await element.waitForExist({ timeout });
        }, browserNames);
    }

    /**
     * Simulate real-time collaboration scenario
     * @param actions Object mapping browser names to actions
     */
    static async simulateCollaboration(actions: Record<string, () => Promise<void>>): Promise<void> {
        const promises = Object.entries(actions).map(([browserName, action]) => {
            console.log(`Executing action on ${browserName}`);
            return action();
        });
        
        await Promise.all(promises);
    }

    /**
     * Get current URL from all browsers
     * @param browserNames Optional array of browser names, defaults to all
     * @returns Object mapping browser names to their current URLs
     */
    static async getCurrentUrlsFromAllBrowsers(browserNames?: string[]): Promise<Record<string, string>> {
        const browsers = browserNames || Object.keys(browser as any);
        const urls: Record<string, string> = {};
        
        for (const browserName of browsers) {
            const browserInstance = (browser as any)[browserName];
            urls[browserName] = await browserInstance.getUrl();
        }
        
        return urls;
    }

    /**
     * Refresh all browsers
     * @param browserNames Optional array of browser names, defaults to all
     */
    static async refreshAllBrowsers(browserNames?: string[]): Promise<void> {
        await this.executeOnAllBrowsersParallel(async (browserInstance) => {
            await browserInstance.refresh();
        }, browserNames);
    }

    /**
     * Close specific browser instance
     * @param browserName Name of the browser to close
     */
    static async closeBrowser(browserName: string): Promise<void> {
        const browserInstance = (browser as any)[browserName];
        await browserInstance.deleteSession();
    }

    /**
     * Execute custom JavaScript on all browsers
     * @param script JavaScript code to execute
     * @param browserNames Optional array of browser names, defaults to all
     * @returns Object mapping browser names to execution results
     */
    static async executeScriptOnAllBrowsers(
        script: string | Function, 
        browserNames?: string[]
    ): Promise<Record<string, any>> {
        const browsers = browserNames || Object.keys(browser as any);
        const results: Record<string, any> = {};
        
        for (const browserName of browsers) {
            const browserInstance = (browser as any)[browserName];
            results[browserName] = await browserInstance.execute(script);
        }
        
        return results;
    }

    /**
     * Log message with browser context
     * @param message Message to log
     * @param browserName Browser name for context
     */
    static log(message: string, browserName?: string): void {
        const prefix = browserName ? `[${browserName}]` : '[MultiRemote]';
        console.log(`${prefix} ${message}`);
    }
}

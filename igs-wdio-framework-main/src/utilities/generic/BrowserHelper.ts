/**
 * Browser Helper Utility
 * Provides common browser interaction methods
 */
export class BrowserHelper {
    /**
     * Wait for page to load completely
     * @param timeout - Timeout in milliseconds
     */
    static async waitForPageLoad(timeout: number = 10000): Promise<void> {
        await browser.waitUntil(
            async () => {
                const readyState = await browser.execute(() => document.readyState);
                return readyState === 'complete';
            },
            {
                timeout,
                timeoutMsg: 'Page did not load within the specified timeout'
            }
        );
    }

    /**
     * Switch to a specific window/tab
     * @param windowIndex - Index of the window to switch to
     */
    static async switchToWindow(windowIndex: number): Promise<void> {
        const handles = await browser.getWindowHandles();
        if (handles[windowIndex]) {
            await browser.switchToWindow(handles[windowIndex]);
        } else {
            throw new Error(`Window at index ${windowIndex} does not exist`);
        }
    }

    /**
     * Open a new tab and switch to it
     * @param url - URL to open in the new tab
     */
    static async openNewTab(url?: string): Promise<void> {
        await browser.newWindow('tab');
        if (url) {
            await browser.url(url);
        }
    }

    /**
     * Close current tab and switch to previous
     */
    static async closeCurrentTab(): Promise<void> {
        await browser.closeWindow();
        const handles = await browser.getWindowHandles();
        if (handles.length > 0) {
            await browser.switchToWindow(handles[handles.length - 1]);
        }
    }

    /**
     * Scroll to top of page
     */
    static async scrollToTop(): Promise<void> {
        await browser.execute(() => {
            window.scrollTo(0, 0);
        });
    }

    /**
     * Scroll to bottom of page
     */
    static async scrollToBottom(): Promise<void> {
        await browser.execute(() => {
            window.scrollTo(0, document.body.scrollHeight);
        });
    }

    /**
     * Scroll to specific coordinates
     * @param x - X coordinate
     * @param y - Y coordinate
     */
    static async scrollTo(x: number, y: number): Promise<void> {
        await browser.execute((xPos, yPos) => {
            window.scrollTo(xPos, yPos);
        }, x, y);
    }

    /**
     * Get current page title
     * @returns Page title
     */
    static async getPageTitle(): Promise<string> {
        return await browser.getTitle();
    }

    /**
     * Get current page URL
     * @returns Current URL
     */
    static async getCurrentUrl(): Promise<string> {
        return await browser.getUrl();
    }

    /**
     * Refresh the current page
     */
    static async refreshPage(): Promise<void> {
        await browser.refresh();
    }

    /**
     * Navigate back in browser history
     */
    static async navigateBack(): Promise<void> {
        await browser.back();
    }

    /**
     * Navigate forward in browser history
     */
    static async navigateForward(): Promise<void> {
        await browser.forward();
    }

    /**
     * Set browser window size
     * @param width - Window width
     * @param height - Window height
     */
    static async setWindowSize(width: number, height: number): Promise<void> {
        await browser.setWindowSize(width, height);
    }

    /**
     * Maximize browser window
     */
    static async maximizeWindow(): Promise<void> {
        await browser.maximizeWindow();
    }

    /**
     * Accept alert dialog
     */
    static async acceptAlert(): Promise<void> {
        await browser.acceptAlert();
    }

    /**
     * Dismiss alert dialog
     */
    static async dismissAlert(): Promise<void> {
        await browser.dismissAlert();
    }

    /**
     * Get alert text
     * @returns Alert text
     */
    static async getAlertText(): Promise<string> {
        return await browser.getAlertText();
    }

    /**
     * Take a screenshot
     * @param filename - Screenshot filename
     */
    static async takeScreenshot(filename: string): Promise<void> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        await browser.saveScreenshot(`./screenshots/${filename}-${timestamp}.png`);
    }
}

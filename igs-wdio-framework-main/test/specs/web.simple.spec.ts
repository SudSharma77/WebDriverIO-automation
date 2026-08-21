import { BrowserHelper, ElementHelper } from '@utilities/index';
import { expect } from '@wdio/globals';

describe('🌐 Web Quick Verification', () => {

    it('should verify web browser functionality', async () => {
        // Quick navigation test to a more reliable URL
        await browser.url('https://www.google.com');
        await BrowserHelper.waitForPageLoad();

        // Verify page loaded successfully
        const title = await browser.getTitle();
        expect(title).toBeDefined();
        expect(title.length).toBeGreaterThan(0);

        // Check the actual URL we ended up at
        const currentUrl = await browser.getUrl();
        console.log('Actual URL loaded: ' + currentUrl);
        console.log('Page title: ' + title);

        // Verify we can interact with DOM
        const body = await $('body');
        await expect(body).toBeDisplayed();

        // Check if we actually loaded a real page
        const pageText = await body.getText();
        expect(pageText.length).toBeGreaterThan(50); // Real page should have substantial content

        console.log('✅ Web test passed - Title: "' + title + '"');
        console.log('✅ Page content length: ' + pageText.length + ' characters');
    });

    it('should verify element interaction utilities', async () => {
        await browser.url('https://www.google.com');
        await BrowserHelper.waitForPageLoad();

        // Test basic element operations
        const body = await $('body');
        await expect(body).toBeDisplayed();

        // Check what URL we actually have
        const actualUrl = await browser.getUrl();
        console.log('Element test - Actual URL: ' + actualUrl);

        // Verify ElementHelper works
        const pageText = await ElementHelper.getTextWithRetry('body');
        expect(pageText).toBeDefined();
        expect(pageText.length).toBeGreaterThan(50); // Should have substantial content

        console.log('✅ Element interaction verified - Page has content (' + pageText.length + ' chars)');
    });

    it('should verify browser helper utilities', async () => {
        await browser.url('https://www.google.com');
        await BrowserHelper.waitForPageLoad();

        // Test browser utilities
        const currentUrl = await browser.getUrl();
        console.log('Browser utilities test - Current URL: ' + currentUrl);

        // More thorough URL validation
        expect(currentUrl).toContain('google.com');

        // Check if we can actually see the page
        const title = await browser.getTitle();
        console.log('Page title: ' + title);
        expect(title.length).toBeGreaterThan(0);

        // Test screenshot functionality
        await BrowserHelper.takeScreenshot('quick-web-verification');

        console.log('✅ Browser utilities verified - URL: ' + currentUrl);
    });
});

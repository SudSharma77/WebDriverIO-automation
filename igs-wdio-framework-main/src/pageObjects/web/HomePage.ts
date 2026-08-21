import { BasePage } from '../BasePage';

/**
 * Sample Home Page Object
 * Demonstrates the page object pattern for web applications
 */
export class HomePage extends BasePage {
    // Page elements
    private get headerTitle() {
        return $('h1');
    }

    private get navigationMenu() {
        return $('.navigation');
    }

    private get loginButton() {
        return $('[data-testid="login-button"]');
    }

    private get signupButton() {
        return $('[data-testid="signup-button"]');
    }

    private get searchInput() {
        return $('[data-testid="search-input"]');
    }

    private get searchButton() {
        return $('[data-testid="search-button"]');
    }

    private get featuredItems() {
        return $$('.featured-item');
    }

    /**
     * Navigate to the home page
     */
    async open(): Promise<void> {
        await browser.url('/');
        await this.waitForPageToLoad();
    }

    /**
     * Wait for home page to load
     */
    async waitForPageToLoad(): Promise<void> {
        await this.waitForDisplayed(this.headerTitle);
        await this.waitForDisplayed(this.navigationMenu);
    }

    /**
     * Get the page title
     * @returns Page title text
     */
    async getPageTitle(): Promise<string> {
        return await this.getText(this.headerTitle);
    }

    /**
     * Click the login button
     */
    async clickLogin(): Promise<void> {
        await this.clickElement(this.loginButton);
    }

    /**
     * Click the signup button
     */
    async clickSignup(): Promise<void> {
        await this.clickElement(this.signupButton);
    }

    /**
     * Perform a search
     * @param searchTerm - Term to search for
     */
    async search(searchTerm: string): Promise<void> {
        await this.typeText(this.searchInput, searchTerm);
        await this.clickElement(this.searchButton);
    }

    /**
     * Get the number of featured items
     * @returns Number of featured items
     */
    async getFeaturedItemsCount(): Promise<number> {
        const items = await this.featuredItems;
        return items.length;
    }

    /**
     * Check if login button is displayed
     * @returns Boolean indicating if login button is visible
     */
    async isLoginButtonDisplayed(): Promise<boolean> {
        return await this.isDisplayed(this.loginButton);
    }

    /**
     * Check if user is logged in (login button not visible)
     * @returns Boolean indicating if user appears to be logged in
     */
    async isUserLoggedIn(): Promise<boolean> {
        return !(await this.isLoginButtonDisplayed());
    }
}

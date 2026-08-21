/**
 * MobileBusinessHelper - Business logic utilities for mobile application testing
 * Contains common business workflows and operations for mobile testing
 */

import { ElementHelper } from '../generic/ElementHelper';
import { WaitHelper } from '../generic/WaitHelper';
import { MobileHelper } from '../generic/MobileHelper';

export class MobileBusinessHelper {
    /**
     * Complete mobile app onboarding workflow
     * @param onboardingData Object containing onboarding information
     */
    static async completeOnboarding(onboardingData: {
        skipIntro?: boolean;
        acceptTerms?: boolean;
        allowPermissions?: boolean;
        setupProfile?: {
            name: string;
            email: string;
            preferences: string[];
        };
    }): Promise<void> {
        console.log('Starting mobile onboarding workflow...');

        // Skip intro screens if needed
        if (onboardingData.skipIntro) {
            const skipButton = await $('[accessibility-id="skip-intro"]');
            if (await skipButton.isDisplayed()) {
                await ElementHelper.safeClick('[accessibility-id="skip-intro"]');
            }
        }

        // Accept terms and conditions
        if (onboardingData.acceptTerms) {
            await WaitHelper.waitForElementPresent('[accessibility-id="terms-checkbox"]', 10000);
            await ElementHelper.safeClick('[accessibility-id="terms-checkbox"]');
            await ElementHelper.safeClick('[accessibility-id="accept-terms"]');
        }

        // Handle permissions
        if (onboardingData.allowPermissions) {
            const permissionButtons = await $$('[accessibility-id*="allow-permission"]');
            for (const button of permissionButtons) {
                if (await button.isDisplayed()) {
                    await button.click();
                }
            }
        }

        // Setup profile if provided
        if (onboardingData.setupProfile) {
            await ElementHelper.safeType('[accessibility-id="profile-name"]', onboardingData.setupProfile.name);
            await ElementHelper.safeType('[accessibility-id="profile-email"]', onboardingData.setupProfile.email);
            
            // Select preferences
            for (const preference of onboardingData.setupProfile.preferences) {
                await ElementHelper.safeClick(`[accessibility-id="preference-${preference}"]`);
            }
            
            await ElementHelper.safeClick('[accessibility-id="complete-profile"]');
        }

        console.log('Mobile onboarding workflow completed');
    }

    /**
     * Complete mobile authentication workflow
     * @param credentials Authentication credentials
     */
    static async authenticateUser(credentials: {
        email?: string;
        username?: string;
        password: string;
        biometric?: boolean;
        rememberMe?: boolean;
    }): Promise<void> {
        console.log('Starting mobile authentication workflow...');

        // Wait for login screen
        await WaitHelper.waitForElementPresent('[accessibility-id="login-form"]', 10000);

        // Handle biometric authentication first if enabled
        if (credentials.biometric) {
            const biometricButton = await $('[accessibility-id="biometric-login"]');
            if (await biometricButton.isDisplayed()) {
                await ElementHelper.safeClick('[accessibility-id="biometric-login"]');
                return; // Exit early for biometric auth
            }
        }

        // Use email or username
        if (credentials.email) {
            await ElementHelper.safeType('[accessibility-id="email-input"]', credentials.email);
        } else if (credentials.username) {
            await ElementHelper.safeType('[accessibility-id="username-input"]', credentials.username);
        }

        // Enter password
        await ElementHelper.safeType('[accessibility-id="password-input"]', credentials.password);

        // Toggle remember me if needed
        if (credentials.rememberMe) {
            await ElementHelper.safeClick('[accessibility-id="remember-me-checkbox"]');
        }

        // Submit login
        await ElementHelper.safeClick('[accessibility-id="login-button"]');

        // Wait for successful authentication
        await WaitHelper.waitForElementPresent('[accessibility-id="home-screen"]', 15000);
        
        console.log('Mobile authentication workflow completed');
    }

    /**
     * Navigate through mobile app sections
     * @param navigationPath Array of navigation steps
     */
    static async navigateToSection(navigationPath: string[]): Promise<void> {
        console.log('Starting mobile navigation workflow...');

        for (const section of navigationPath) {
            // Handle tab navigation
            if (section.startsWith('tab:')) {
                const tabName = section.replace('tab:', '');
                await ElementHelper.safeClick(`[accessibility-id="tab-${tabName}"]`);
            }
            // Handle menu navigation
            else if (section.startsWith('menu:')) {
                const menuItem = section.replace('menu:', '');
                await ElementHelper.safeClick('[accessibility-id="menu-button"]');
                await WaitHelper.waitForElementPresent('[accessibility-id="menu-overlay"]', 5000);
                await ElementHelper.safeClick(`[accessibility-id="menu-${menuItem}"]`);
            }
            // Handle direct navigation
            else {
                await ElementHelper.safeClick(`[accessibility-id="${section}"]`);
            }

            // Wait for navigation to complete
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log('Mobile navigation workflow completed');
    }

    /**
     * Complete mobile shopping workflow
     * @param shoppingData Shopping session data
     */
    static async completeShopping(shoppingData: {
        searchQuery?: string;
        category?: string;
        filters?: string[];
        itemsToAdd: string[];
        checkoutInfo?: {
            shippingAddress: any;
            paymentMethod: string;
        };
    }): Promise<void> {
        console.log('Starting mobile shopping workflow...');

        // Navigate to shopping section
        await this.navigateToSection(['tab:shop']);

        // Search for products if query provided
        if (shoppingData.searchQuery) {
            await ElementHelper.safeType('[accessibility-id="search-input"]', shoppingData.searchQuery);
            await ElementHelper.safeClick('[accessibility-id="search-button"]');
            await WaitHelper.waitForElementPresent('[accessibility-id="search-results"]', 5000);
        }

        // Browse by category if specified
        if (shoppingData.category) {
            await ElementHelper.safeClick(`[accessibility-id="category-${shoppingData.category}"]`);
            await WaitHelper.waitForElementPresent('[accessibility-id="category-products"]', 5000);
        }

        // Apply filters if provided
        if (shoppingData.filters && shoppingData.filters.length > 0) {
            await ElementHelper.safeClick('[accessibility-id="filter-button"]');
            for (const filter of shoppingData.filters) {
                await ElementHelper.safeClick(`[accessibility-id="filter-${filter}"]`);
            }
            await ElementHelper.safeClick('[accessibility-id="apply-filters"]');
        }

        // Add items to cart
        for (const item of shoppingData.itemsToAdd) {
            await ElementHelper.safeClick(`[accessibility-id="add-to-cart-${item}"]`);
            await WaitHelper.waitForElementPresent('[accessibility-id="cart-updated"]', 3000);
        }

        // Proceed to checkout if checkout info provided
        if (shoppingData.checkoutInfo) {
            await ElementHelper.safeClick('[accessibility-id="cart-icon"]');
            await ElementHelper.safeClick('[accessibility-id="checkout-button"]');
            
            // Fill shipping information
            // This would need to be implemented based on actual form structure
            console.log('Checkout process initiated');
        }

        console.log('Mobile shopping workflow completed');
    }

    /**
     * Handle mobile app notifications
     * @param action Action to take with notifications
     */
    static async handleNotifications(action: 'allow' | 'deny' | 'dismiss'): Promise<void> {
        console.log('Handling mobile notifications...');

        const notificationDialog = await $('[accessibility-id="notification-permission"]');
        if (await notificationDialog.isDisplayed()) {
            switch (action) {
                case 'allow':
                    await ElementHelper.safeClick('[accessibility-id="allow-notifications"]');
                    break;
                case 'deny':
                    await ElementHelper.safeClick('[accessibility-id="deny-notifications"]');
                    break;
                case 'dismiss':
                    await ElementHelper.safeClick('[accessibility-id="dismiss-notifications"]');
                    break;
            }
        }

        console.log('Notification handling completed');
    }

    /**
     * Perform mobile app gestures and interactions
     * @param gestureData Gesture configuration
     */
    static async performGestures(gestureData: {
        type: 'swipe' | 'pinch' | 'rotate' | 'scroll';
        direction?: 'up' | 'down' | 'left' | 'right';
        element?: string;
        distance?: number;
    }): Promise<void> {
        console.log('Performing mobile gestures...');

        switch (gestureData.type) {
            case 'swipe':
                if (gestureData.element) {
                    await MobileHelper.scrollToElement(gestureData.element);
                } else {
                    // Perform full screen swipe based on direction
                    console.log(`Performing ${gestureData.direction} swipe`);
                }
                break;

            case 'scroll':
                if (gestureData.element) {
                    await MobileHelper.scrollToElement(gestureData.element);
                } else {
                    console.log('Performing scroll gesture');
                }
                break;

            case 'pinch':
                console.log('Performing pinch gesture');
                break;

            case 'rotate':
                console.log('Performing rotate gesture');
                break;
        }

        console.log('Mobile gesture completed');
    }

    /**
     * Handle mobile app settings and configuration
     * @param settingsData Settings to configure
     */
    static async configureSettings(settingsData: {
        notifications?: boolean;
        location?: boolean;
        darkMode?: boolean;
        language?: string;
        privacy?: {
            analytics: boolean;
            crashReporting: boolean;
        };
    }): Promise<void> {
        console.log('Configuring mobile app settings...');

        // Navigate to settings
        await this.navigateToSection(['menu:settings']);

        // Configure notifications
        if (settingsData.notifications !== undefined) {
            const notificationToggle = await $('[accessibility-id="notification-toggle"]');
            const isEnabled = await notificationToggle.getAttribute('checked');
            if ((settingsData.notifications && !isEnabled) || (!settingsData.notifications && isEnabled)) {
                await ElementHelper.safeClick('[accessibility-id="notification-toggle"]');
            }
        }

        // Configure location services
        if (settingsData.location !== undefined) {
            const locationToggle = await $('[accessibility-id="location-toggle"]');
            const isEnabled = await locationToggle.getAttribute('checked');
            if ((settingsData.location && !isEnabled) || (!settingsData.location && isEnabled)) {
                await ElementHelper.safeClick('[accessibility-id="location-toggle"]');
            }
        }

        // Configure dark mode
        if (settingsData.darkMode !== undefined) {
            const darkModeToggle = await $('[accessibility-id="dark-mode-toggle"]');
            const isEnabled = await darkModeToggle.getAttribute('checked');
            if ((settingsData.darkMode && !isEnabled) || (!settingsData.darkMode && isEnabled)) {
                await ElementHelper.safeClick('[accessibility-id="dark-mode-toggle"]');
            }
        }

        // Configure language
        if (settingsData.language) {
            await ElementHelper.safeClick('[accessibility-id="language-selector"]');
            await ElementHelper.safeClick(`[accessibility-id="language-${settingsData.language}"]`);
        }

        // Configure privacy settings
        if (settingsData.privacy) {
            await ElementHelper.safeClick('[accessibility-id="privacy-settings"]');
            
            if (settingsData.privacy.analytics !== undefined) {
                const analyticsToggle = await $('[accessibility-id="analytics-toggle"]');
                const isEnabled = await analyticsToggle.getAttribute('checked');
                if ((settingsData.privacy.analytics && !isEnabled) || (!settingsData.privacy.analytics && isEnabled)) {
                    await ElementHelper.safeClick('[accessibility-id="analytics-toggle"]');
                }
            }

            if (settingsData.privacy.crashReporting !== undefined) {
                const crashToggle = await $('[accessibility-id="crash-reporting-toggle"]');
                const isEnabled = await crashToggle.getAttribute('checked');
                if ((settingsData.privacy.crashReporting && !isEnabled) || (!settingsData.privacy.crashReporting && isEnabled)) {
                    await ElementHelper.safeClick('[accessibility-id="crash-reporting-toggle"]');
                }
            }
        }

        console.log('Mobile app settings configuration completed');
    }
}

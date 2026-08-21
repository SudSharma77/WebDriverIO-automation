/**
 * WebBusinessHelper - Business logic utilities for web application testing
 * Contains common business workflows and operations for web testing
 */

import { ElementHelper } from '../generic/ElementHelper';
import { WaitHelper } from '../generic/WaitHelper';

export class WebBusinessHelper {
    /**
     * Complete user login workflow
     * @param username User's username or email
     * @param password User's password
     * @param loginUrl Optional login page URL
     * @param usernameSelector Selector for username field
     * @param passwordSelector Selector for password field
     * @param submitSelector Selector for submit button
     */
    static async loginUser(
        username: string,
        password: string,
        loginUrl?: string,
        usernameSelector: string = '#username',
        passwordSelector: string = '#password',
        submitSelector: string = 'button[type="submit"]'
    ): Promise<void> {
        if (loginUrl) {
            await browser.url(loginUrl);
            // Use available WaitHelper method
            await WaitHelper.waitForElementPresent('body', 10000);
        }

        await ElementHelper.safeType(usernameSelector, username);
        await ElementHelper.safeType(passwordSelector, password);
        await ElementHelper.safeClick(submitSelector);
        
        // Wait for navigation or success indicator
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    /**
     * Complete user registration workflow
     * @param userData Object containing registration data
     * @param formSelectors Object mapping field names to selectors
     */
    static async registerUser(
        userData: {
            firstName: string;
            lastName: string;
            email: string;
            password: string;
            confirmPassword: string;
            phone?: string;
            dateOfBirth?: string;
            agreeToTerms?: boolean;
        },
        formSelectors?: {
            firstName?: string;
            lastName?: string;
            email?: string;
            password?: string;
            confirmPassword?: string;
            phone?: string;
            dateOfBirth?: string;
            termsCheckbox?: string;
            submitButton?: string;
        }
    ): Promise<void> {
        const selectors = {
            firstName: '#firstName',
            lastName: '#lastName',
            email: '#email',
            password: '#password',
            confirmPassword: '#confirmPassword',
            phone: '#phone',
            dateOfBirth: '#dateOfBirth',
            termsCheckbox: '#agreeToTerms',
            submitButton: 'button[type="submit"]',
            ...formSelectors
        };

        // Fill required fields
        await ElementHelper.safeType(selectors.firstName, userData.firstName);
        await ElementHelper.safeType(selectors.lastName, userData.lastName);
        await ElementHelper.safeType(selectors.email, userData.email);
        await ElementHelper.safeType(selectors.password, userData.password);
        await ElementHelper.safeType(selectors.confirmPassword, userData.confirmPassword);

        // Fill optional fields
        if (userData.phone) {
            await ElementHelper.safeType(selectors.phone, userData.phone);
        }
        if (userData.dateOfBirth) {
            await ElementHelper.safeType(selectors.dateOfBirth, userData.dateOfBirth);
        }

        // Handle terms agreement
        if (userData.agreeToTerms) {
            await ElementHelper.safeClick(selectors.termsCheckbox);
        }

        // Submit form
        await ElementHelper.safeClick(selectors.submitButton);
        
        // Wait for registration completion
        await WaitHelper.waitForElementPresent('.success-message, .welcome-message, .dashboard', 10000);
    }

    /**
     * Search for products/items
     * @param searchTerm Search term
     * @param searchSelector Selector for search input
     * @param submitSelector Selector for search submit button
     */
    static async searchForItems(searchTerm: string, searchSelector: string = '#search', submitSelector?: string): Promise<void> {
        await ElementHelper.safeType(searchSelector, searchTerm);
        
        if (submitSelector) {
            await ElementHelper.safeClick(submitSelector);
        } else {
            await browser.keys('Enter');
        }
        
        await WaitHelper.waitForElementPresent('.search-results', 5000);
    }

    /**
     * Add item to shopping cart
     * @param itemSelector Selector for the item to add
     * @param quantity Quantity to add
     */
    static async addToCart(itemSelector: string, quantity: number = 1): Promise<void> {
        // Navigate to item if needed
        try {
            await ElementHelper.safeClick(itemSelector);
            await WaitHelper.waitForElementPresent('.product-details, .item-details', 5000);
        } catch {
            console.log('Item might already be on detail page');
        }

        // Set quantity if quantity selector exists
        try {
            const quantitySelector = '#quantity, .quantity-input, [name="quantity"]';
            await ElementHelper.safeType(quantitySelector, quantity.toString());
        } catch {
            console.log('Quantity selector not found, using default quantity');
        }

        // Add to cart
        await ElementHelper.safeClick('.add-to-cart, .add-cart, #add-to-cart, [data-testid="add-to-cart"]');
        
        // Wait for confirmation
        await WaitHelper.waitForElementPresent('.cart-confirmation, .added-to-cart', 5000);
    }

    /**
     * Complete checkout process
     * @param shippingInfo Shipping information
     * @param billingInfo Billing information  
     * @param paymentInfo Payment information
     */
    static async completeCheckout(
        shippingInfo: {
            firstName: string;
            lastName: string;
            address: string;
            city: string;
            state: string;
            zipCode: string;
            country: string;
        },
        billingInfo?: {
            firstName: string;
            lastName: string;
            address: string;
            city: string;
            state: string;
            zipCode: string;
            country: string;
        },
        paymentInfo?: {
            cardNumber: string;
            expiryDate: string;
            cvv: string;
            nameOnCard: string;
        }
    ): Promise<void> {
        // Navigate to checkout
        await ElementHelper.safeClick('.checkout, .proceed-checkout, #checkout');
        
        // Fill shipping information
        await ElementHelper.safeType('#shipping-first-name', shippingInfo.firstName);
        await ElementHelper.safeType('#shipping-last-name', shippingInfo.lastName);
        await ElementHelper.safeType('#shipping-address', shippingInfo.address);
        await ElementHelper.safeType('#shipping-city', shippingInfo.city);
        await ElementHelper.safeType('#shipping-state', shippingInfo.state);
        await ElementHelper.safeType('#shipping-zip', shippingInfo.zipCode);
        
        // Handle country selection
        try {
            await ElementHelper.selectByText('#shipping-country', shippingInfo.country);
        } catch {
            console.log('Country selection failed, might need different approach');
        }

        // Fill billing information if different from shipping
        if (billingInfo) {
            await ElementHelper.safeClick('#different-billing');
            await ElementHelper.safeType('#billing-first-name', billingInfo.firstName);
            await ElementHelper.safeType('#billing-last-name', billingInfo.lastName);
            await ElementHelper.safeType('#billing-address', billingInfo.address);
            await ElementHelper.safeType('#billing-city', billingInfo.city);
            await ElementHelper.safeType('#billing-state', billingInfo.state);
            await ElementHelper.safeType('#billing-zip', billingInfo.zipCode);
            try {
                await ElementHelper.selectByText('#billing-country', billingInfo.country);
            } catch {
                console.log('Billing country selection failed');
            }
        }

        // Continue to payment
        await ElementHelper.safeClick('.continue-payment, .next-step, #continue-to-payment');
        await WaitHelper.waitForElementPresent('.payment-form', 5000);

        // Fill payment information if provided
        if (paymentInfo) {
            await ElementHelper.safeType('#card-number', paymentInfo.cardNumber);
            await ElementHelper.safeType('#expiry-date', paymentInfo.expiryDate);
            await ElementHelper.safeType('#cvv', paymentInfo.cvv);
            await ElementHelper.safeType('#name-on-card', paymentInfo.nameOnCard);
        }

        // Complete order
        await ElementHelper.safeClick('.place-order, .complete-order, #place-order');
        
        // Wait for order confirmation
        await WaitHelper.waitForElementPresent('.order-confirmation, .success-message', 15000);
    }

    /**
     * Complete multi-step wizard/form
     * @param stepsData Array of step data objects
     */
    static async completeWizard(stepsData: Array<{
        stepName: string;
        fields: Record<string, string>;
        nextButtonSelector?: string;
    }>): Promise<void> {
        for (let i = 0; i < stepsData.length; i++) {
            const step = stepsData[i];
            console.log(`Completing step: ${step.stepName}`);

            // Fill fields for current step
            for (const [fieldSelector, value] of Object.entries(step.fields)) {
                try {
                    await ElementHelper.safeType(fieldSelector, value);
                } catch {
                    console.log(`Field ${fieldSelector} not found in step ${step.stepName}`);
                }
            }

            // Move to next step (except for last step)
            if (i < stepsData.length - 1) {
                const nextButton = step.nextButtonSelector || '.next, .continue, .next-step';
                await ElementHelper.safeClick(nextButton);
                
                // Wait for next step to load
                await WaitHelper.waitForElementPresent('body', 3000);
            } else {
                // Last step - submit/finish
                await ElementHelper.safeClick('.submit, .finish, .complete, .done');
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    /**
     * Handle file upload workflow
     * @param filePath Path to file to upload
     * @param uploadSelector Selector for file input
     * @param description Optional description for the file
     */
    static async uploadFile(
        filePath: string, 
        uploadSelector: string = 'input[type="file"]',
        description?: string
    ): Promise<void> {
        // Set file path
        await ElementHelper.uploadFile(uploadSelector, filePath);
        
        // Add description if provided
        if (description) {
            try {
                await ElementHelper.safeType('.file-description, #description', description);
            } catch {
                console.log('Description field not found');
            }
        }

        // Submit upload
        try {
            await ElementHelper.safeClick('.upload-submit, .upload-file, #upload');
        } catch {
            console.log('Upload submit button not found, file might upload automatically');
        }

        // Wait for upload completion
        await WaitHelper.waitForElementPresent('.upload-success, .file-uploaded', 10000);
    }

    /**
     * Perform table operations (sort, filter, paginate)
     * @param operations Object containing table operations
     */
    static async performTableOperations(operations: {
        sortBy?: { column: string; direction: 'asc' | 'desc' };
        filterBy?: { column: string; value: string };
        goToPage?: number;
        selectRows?: number[];
        action?: string;
    }): Promise<void> {
        // Sort table
        if (operations.sortBy) {
            const sortSelector = `[data-sort="${operations.sortBy.column}"], .sort-${operations.sortBy.column}`;
            await ElementHelper.safeClick(sortSelector);
            
            // Click again for descending if needed
            if (operations.sortBy.direction === 'desc') {
                await new Promise(resolve => setTimeout(resolve, 500));
                await ElementHelper.safeClick(sortSelector);
            }
        }

        // Filter table
        if (operations.filterBy) {
            const filterSelector = `[data-filter="${operations.filterBy.column}"], .filter-${operations.filterBy.column}`;
            await ElementHelper.safeType(filterSelector, operations.filterBy.value);
            await browser.keys('Enter');
            await WaitHelper.waitForElementPresent('tbody tr', 5000);
        }

        // Navigate to specific page
        if (operations.goToPage) {
            try {
                const pageSelector = `[data-page="${operations.goToPage}"], .page-${operations.goToPage}`;
                await ElementHelper.safeClick(pageSelector);
                await WaitHelper.waitForElementPresent('tbody tr', 5000);
            } catch {
                console.log('Page navigation failed');
            }
        }

        // Select rows
        if (operations.selectRows && operations.selectRows.length > 0) {
            for (const rowIndex of operations.selectRows) {
                const rowSelector = `tbody tr:nth-child(${rowIndex + 1}) input[type="checkbox"]`;
                try {
                    await ElementHelper.safeClick(rowSelector);
                } catch {
                    console.log(`Row ${rowIndex} selection failed`);
                }
            }
        }

        // Perform action on selected rows
        if (operations.action) {
            const actionSelectors = [
                `.${operations.action}-button`,
                `#${operations.action}`,
                `[data-action="${operations.action}"]`,
                `.action-${operations.action}`
            ];

            for (const selector of actionSelectors) {
                try {
                    await ElementHelper.safeClick(selector);
                    break;
                } catch {
                    continue;
                }
            }
        }
    }

    /**
     * Handle modal dialog interactions
     * @param action Action to perform (open, close, confirm, cancel)
     * @param modalSelector Selector for the modal
     * @param triggerSelector Selector for element that opens modal (if opening)
     */
    static async handleModal(
        action: 'open' | 'close' | 'confirm' | 'cancel',
        modalSelector: string = '.modal, .dialog',
        triggerSelector?: string
    ): Promise<void> {
        switch (action) {
            case 'open':
                if (triggerSelector) {
                    await ElementHelper.safeClick(triggerSelector);
                    await WaitHelper.waitForElementPresent(modalSelector, 5000);
                }
                break;

            case 'close':
                try {
                    await ElementHelper.safeClick('.modal-close, .close, .x');
                } catch {
                    // Try escape key
                    await browser.keys('Escape');
                }
                break;

            case 'confirm':
                await ElementHelper.safeClick('.confirm, .ok, .yes, .save');
                break;

            case 'cancel':
                await ElementHelper.safeClick('.cancel, .no, .close');
                break;
        }

        // Wait for modal to disappear (except when opening)
        if (action !== 'open') {
            try {
                await browser.waitUntil(
                    async () => {
                        const modal = await $(modalSelector);
                        return !(await modal.isDisplayed());
                    },
                    {
                        timeout: 5000,
                        timeoutMsg: 'Modal did not disappear'
                    }
                );
            } catch {
                console.log('Could not verify modal disappeared');
            }
        }
    }

    /**
     * Navigate through breadcrumbs
     * @param breadcrumbLevel Level to navigate to (0-based index)
     */
    static async navigateBreadcrumb(breadcrumbLevel: number): Promise<void> {
        const breadcrumbSelector = `.breadcrumb li:nth-child(${breadcrumbLevel + 1}) a, .breadcrumb-item:nth-child(${breadcrumbLevel + 1}) a`;
        await ElementHelper.safeClick(breadcrumbSelector);
        await WaitHelper.waitForElementPresent('body', 3000);
    }

    /**
     * Handle dynamic loading and infinite scroll
     * @param targetElementsCount Minimum number of elements to wait for
     * @param elementSelector Selector for elements being loaded
     */
    static async handleDynamicContent(targetElementsCount: number, elementSelector: string): Promise<void> {
        let currentCount = 0;
        let attempts = 0;
        const maxAttempts = 10;

        while (currentCount < targetElementsCount && attempts < maxAttempts) {
            // Scroll to bottom to trigger loading
            await browser.execute(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });

            // Wait for new content
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Count current elements
            const elements = await $$(elementSelector);
            currentCount = await elements.length;
            attempts++;

            console.log(`Loaded ${currentCount} elements, target: ${targetElementsCount}`);
        }

        if (currentCount < targetElementsCount) {
            console.log(`Warning: Only loaded ${currentCount} elements, target was ${targetElementsCount}`);
        }
    }
}

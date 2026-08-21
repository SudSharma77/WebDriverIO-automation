/**
 * Form Helper Utility
 * Provides methods for form interactions and validations
 */
export class FormHelper {
    /**
     * Fill form with data object
     * @param formData - Object containing field selectors and values
     * @param clearFirst - Whether to clear fields before filling
     */
    static async fillForm(formData: Record<string, string>, clearFirst: boolean = true): Promise<void> {
        for (const [selector, value] of Object.entries(formData)) {
            const element = await $(selector);
            await element.waitForDisplayed();
            
            if (clearFirst) {
                await element.clearValue();
            }
            
            await element.setValue(value);
        }
    }

    /**
     * Submit form using submit button or Enter key
     * @param submitSelector - Submit button selector (optional)
     */
    static async submitForm(submitSelector?: string): Promise<void> {
        if (submitSelector) {
            const submitButton = await $(submitSelector);
            await submitButton.waitForClickable();
            await submitButton.click();
        } else {
            // Submit using Enter key on active element
            await browser.keys('Enter');
        }
    }

    /**
     * Validate form field error messages
     * @param fieldSelector - Field selector
     * @param errorSelector - Error message selector
     * @param expectedError - Expected error text
     */
    static async validateFieldError(
        fieldSelector: string,
        errorSelector: string,
        expectedError: string
    ): Promise<void> {
        // Trigger validation by interacting with field
        const field = await $(fieldSelector);
        await field.waitForDisplayed();
        await field.click();
        await field.setValue(''); // Clear to trigger validation
        
        // Check for error message
        const errorElement = await $(errorSelector);
        await errorElement.waitForDisplayed();
        const errorText = await errorElement.getText();
        
        if (!errorText.includes(expectedError)) {
            throw new Error(`Expected error '${expectedError}', but got '${errorText}'`);
        }
    }

    /**
     * Check if form field is required
     * @param selector - Field selector
     * @returns True if field is required
     */
    static async isFieldRequired(selector: string): Promise<boolean> {
        const element = await $(selector);
        await element.waitForDisplayed();
        
        const required = await element.getAttribute('required');
        const ariaRequired = await element.getAttribute('aria-required');
        
        return required !== null || ariaRequired === 'true';
    }

    /**
     * Get form field value
     * @param selector - Field selector
     * @returns Field value
     */
    static async getFieldValue(selector: string): Promise<string> {
        const element = await $(selector);
        await element.waitForDisplayed();
        return await element.getValue();
    }

    /**
     * Check if form field is valid
     * @param selector - Field selector
     * @returns True if field is valid
     */
    static async isFieldValid(selector: string): Promise<boolean> {
        const element = await $(selector);
        await element.waitForDisplayed();
        
        // Check HTML5 validity
        const isValid = await browser.execute((el) => {
            return (el as HTMLInputElement).checkValidity();
        }, element);
        
        return isValid;
    }

    /**
     * Select radio button by value
     * @param name - Radio group name
     * @param value - Value to select
     */
    static async selectRadioButton(name: string, value: string): Promise<void> {
        const radioButton = await $(`input[name="${name}"][value="${value}"]`);
        await radioButton.waitForDisplayed();
        await radioButton.click();
    }

    /**
     * Check checkbox
     * @param selector - Checkbox selector
     * @param checked - Desired state
     */
    static async setCheckbox(selector: string, checked: boolean): Promise<void> {
        const checkbox = await $(selector);
        await checkbox.waitForDisplayed();
        
        const isCurrentlyChecked = await checkbox.isSelected();
        if (isCurrentlyChecked !== checked) {
            await checkbox.click();
        }
    }

    /**
     * Select multiple checkboxes
     * @param selectors - Array of checkbox selectors
     * @param checked - Desired state for all checkboxes
     */
    static async setMultipleCheckboxes(selectors: string[], checked: boolean): Promise<void> {
        for (const selector of selectors) {
            await this.setCheckbox(selector, checked);
        }
    }

    /**
     * Upload file to file input
     * @param selector - File input selector
     * @param filePath - Path to file
     */
    static async uploadFile(selector: string, filePath: string): Promise<void> {
        const fileInput = await $(selector);
        await fileInput.waitForDisplayed();
        await fileInput.setValue(filePath);
    }

    /**
     * Upload multiple files
     * @param selector - File input selector
     * @param filePaths - Array of file paths
     */
    static async uploadMultipleFiles(selector: string, filePaths: string[]): Promise<void> {
        const fileInput = await $(selector);
        await fileInput.waitForDisplayed();
        
        // Join file paths with newline for multiple file upload
        const filesString = filePaths.join('\\n');
        await fileInput.setValue(filesString);
    }

    /**
     * Clear form field
     * @param selector - Field selector
     */
    static async clearField(selector: string): Promise<void> {
        const element = await $(selector);
        await element.waitForDisplayed();
        await element.clearValue();
    }

    /**
     * Clear entire form
     * @param formSelector - Form container selector
     */
    static async clearForm(formSelector: string): Promise<void> {
        const form = await $(formSelector);
        await form.waitForDisplayed();
        
        // Find all input, textarea, and select elements within the form
        const inputs = await form.$$('input, textarea, select');
        
        for (const input of inputs) {
            const tagName = await input.getTagName();
            const type = await input.getAttribute('type');
            
            if (tagName === 'input' && (type === 'text' || type === 'email' || type === 'password' || type === 'number')) {
                await input.clearValue();
            } else if (tagName === 'textarea') {
                await input.clearValue();
            } else if (tagName === 'select') {
                // Reset to first option or empty value
                await input.selectByIndex(0);
            } else if (type === 'checkbox' || type === 'radio') {
                const isSelected = await input.isSelected();
                if (isSelected) {
                    await input.click();
                }
            }
        }
    }

    /**
     * Get form data as object
     * @param formSelector - Form container selector
     * @returns Object with field names and values
     */
    static async getFormData(formSelector: string): Promise<Record<string, string>> {
        const form = await $(formSelector);
        await form.waitForDisplayed();
        
        const formData: Record<string, string> = {};
        const inputs = await form.$$('input, textarea, select');
        
        for (const input of inputs) {
            const name = await input.getAttribute('name');
            const tagName = await input.getTagName();
            const type = await input.getAttribute('type');
            
            if (name) {
                if (tagName === 'select') {
                    const selectedOption = await input.$('option:checked');
                    if (await selectedOption.isExisting()) {
                        formData[name] = await selectedOption.getText();
                    }
                } else if (type === 'checkbox' || type === 'radio') {
                    const isSelected = await input.isSelected();
                    if (isSelected) {
                        const value = await input.getAttribute('value');
                        formData[name] = value || 'checked';
                    }
                } else {
                    formData[name] = await input.getValue();
                }
            }
        }
        
        return formData;
    }

    /**
     * Validate form submission success
     * @param successSelector - Success message/indicator selector
     * @param expectedMessage - Expected success message (optional)
     */
    static async validateFormSubmissionSuccess(
        successSelector: string,
        expectedMessage?: string
    ): Promise<void> {
        const successElement = await $(successSelector);
        await successElement.waitForDisplayed();
        
        if (expectedMessage) {
            const actualMessage = await successElement.getText();
            if (!actualMessage.includes(expectedMessage)) {
                throw new Error(`Expected success message '${expectedMessage}', but got '${actualMessage}'`);
            }
        }
    }

    /**
     * Wait for form validation to complete
     * @param formSelector - Form selector
     * @param timeout - Timeout in milliseconds
     */
    static async waitForFormValidation(formSelector: string, timeout: number = 5000): Promise<void> {
        await browser.waitUntil(
            async () => {
                const form = await $(formSelector);
                const isValid = await browser.execute((formEl) => {
                    return (formEl as HTMLFormElement).checkValidity();
                }, form);
                return isValid;
            },
            {
                timeout,
                timeoutMsg: `Form validation did not complete within ${timeout}ms`
            }
        );
    }

    /**
     * Count form validation errors
     * @param errorSelector - Error message selector pattern
     * @returns Number of validation errors
     */
    static async countValidationErrors(errorSelector: string): Promise<number> {
        const errorElements = await $$(errorSelector);
        const visibleErrors = [];
        
        for (const error of errorElements) {
            const isDisplayed = await error.isDisplayed();
            if (isDisplayed) {
                visibleErrors.push(error);
            }
        }
        
        return visibleErrors.length;
    }

    /**
     * Type with delays between characters (for special inputs)
     * @param selector - Field selector
     * @param text - Text to type
     * @param delay - Delay between characters in milliseconds
     */
    static async typeSlowly(selector: string, text: string, delay: number = 100): Promise<void> {
        const element = await $(selector);
        await element.waitForDisplayed();
        await element.clearValue();
        
        for (const char of text) {
            await element.addValue(char);
            await browser.pause(delay);
        }
    }

    /**
     * Focus and blur field to trigger validation
     * @param selector - Field selector
     */
    static async triggerFieldValidation(selector: string): Promise<void> {
        const element = await $(selector);
        await element.waitForDisplayed();
        await element.click(); // Focus
        await browser.keys('Tab'); // Blur by moving to next field
    }

    /**
     * Check if form has unsaved changes
     * @param formSelector - Form selector
     * @param originalData - Original form data to compare against
     * @returns True if form has changes
     */
    static async hasUnsavedChanges(
        formSelector: string,
        originalData: Record<string, string>
    ): Promise<boolean> {
        const currentData = await this.getFormData(formSelector);
        
        for (const [key, value] of Object.entries(originalData)) {
            if (currentData[key] !== value) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Auto-fill form using data attributes
     * @param formData - Data to fill
     * @param attributeName - Data attribute name (default: 'data-testid')
     */
    static async autoFillForm(
        formData: Record<string, string>,
        attributeName: string = 'data-testid'
    ): Promise<void> {
        for (const [testId, value] of Object.entries(formData)) {
            const selector = `[${attributeName}="${testId}"]`;
            const element = await $(selector);
            
            if (await element.isExisting()) {
                await element.waitForDisplayed();
                const tagName = await element.getTagName();
                const type = await element.getAttribute('type');
                
                if (tagName === 'select') {
                    await element.selectByVisibleText(value);
                } else if (type === 'checkbox' || type === 'radio') {
                    if (value === 'true' || value === 'checked') {
                        const isSelected = await element.isSelected();
                        if (!isSelected) {
                            await element.click();
                        }
                    }
                } else {
                    await element.clearValue();
                    await element.setValue(value);
                }
            }
        }
    }
}

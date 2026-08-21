/**
 * Element Helper Utility
 * Provides advanced element interaction methods for web testing
 */
export class ElementHelper {
    /**
     * Safe click with retry mechanism
     * @param selector - Element selector
     * @param retries - Number of retry attempts
     * @param timeout - Timeout for each attempt
     */
    static async safeClick(selector: string, retries: number = 3, timeout: number = 5000): Promise<void> {
        for (let i = 0; i < retries; i++) {
            try {
                const element = await $(selector);
                await element.waitForClickable({ timeout });
                await element.click();
                return;
            } catch (error) {
                if (i === retries - 1) {
                    throw new Error(`Failed to click element '${selector}' after ${retries} attempts: ${error}`);
                }
                await browser.pause(1000);
            }
        }
    }

    /**
     * Safe type with clear input field
     * @param selector - Element selector
     * @param text - Text to type
     * @param clearFirst - Whether to clear field first
     */
    static async safeType(selector: string, text: string, clearFirst: boolean = true): Promise<void> {
        const element = await $(selector);
        await element.waitForDisplayed();
        
        if (clearFirst) {
            await element.clearValue();
        }
        
        await element.setValue(text);
        
        // Verify the text was entered correctly
        const value = await element.getValue();
        if (value !== text) {
            throw new Error(`Text verification failed. Expected: '${text}', Actual: '${value}'`);
        }
    }

    /**
     * Select dropdown option by visible text
     * @param selector - Dropdown selector
     * @param optionText - Text of the option to select
     */
    static async selectByText(selector: string, optionText: string): Promise<void> {
        const dropdown = await $(selector);
        await dropdown.waitForDisplayed();
        await dropdown.selectByVisibleText(optionText);
    }

    /**
     * Select dropdown option by value
     * @param selector - Dropdown selector
     * @param value - Value of the option to select
     */
    static async selectByValue(selector: string, value: string): Promise<void> {
        const dropdown = await $(selector);
        await dropdown.waitForDisplayed();
        await dropdown.selectByAttribute('value', value);
    }

    /**
     * Select dropdown option by index
     * @param selector - Dropdown selector
     * @param index - Index of the option to select
     */
    static async selectByIndex(selector: string, index: number): Promise<void> {
        const dropdown = await $(selector);
        await dropdown.waitForDisplayed();
        await dropdown.selectByIndex(index);
    }

    /**
     * Check if element exists in DOM
     * @param selector - Element selector
     * @returns True if element exists
     */
    static async isElementPresent(selector: string): Promise<boolean> {
        try {
            const elements = await $$(selector);
            const length = await elements.length;
            return length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Check if element is visible
     * @param selector - Element selector
     * @returns True if element is visible
     */
    static async isElementVisible(selector: string): Promise<boolean> {
        try {
            const element = await $(selector);
            return await element.isDisplayed();
        } catch {
            return false;
        }
    }

    /**
     * Check if element is enabled
     * @param selector - Element selector
     * @returns True if element is enabled
     */
    static async isElementEnabled(selector: string): Promise<boolean> {
        try {
            const element = await $(selector);
            return await element.isEnabled();
        } catch {
            return false;
        }
    }

    /**
     * Get element text with retry
     * @param selector - Element selector
     * @param retries - Number of retry attempts
     * @returns Element text
     */
    static async getTextWithRetry(selector: string, retries: number = 3): Promise<string> {
        for (let i = 0; i < retries; i++) {
            try {
                const element = await $(selector);
                await element.waitForDisplayed();
                return await element.getText();
            } catch (error) {
                if (i === retries - 1) {
                    throw new Error(`Failed to get text from element '${selector}' after ${retries} attempts: ${error}`);
                }
                await browser.pause(1000);
            }
        }
        return '';
    }

    /**
     * Get element attribute value
     * @param selector - Element selector
     * @param attributeName - Name of the attribute
     * @returns Attribute value
     */
    static async getAttribute(selector: string, attributeName: string): Promise<string | null> {
        const element = await $(selector);
        await element.waitForDisplayed();
        return await element.getAttribute(attributeName);
    }

    /**
     * Get CSS property value
     * @param selector - Element selector
     * @param propertyName - Name of the CSS property
     * @returns CSS property value
     */
    static async getCSSProperty(selector: string, propertyName: string): Promise<string> {
        const element = await $(selector);
        await element.waitForDisplayed();
        const cssProperty = await element.getCSSProperty(propertyName);
        return cssProperty.value || '';
    }

    /**
     * Hover over element
     * @param selector - Element selector
     */
    static async hoverOver(selector: string): Promise<void> {
        const element = await $(selector);
        await element.waitForDisplayed();
        await element.moveTo();
    }

    /**
     * Double click on element
     * @param selector - Element selector
     */
    static async doubleClick(selector: string): Promise<void> {
        const element = await $(selector);
        await element.waitForClickable();
        await element.doubleClick();
    }

    /**
     * Right click on element
     * @param selector - Element selector
     */
    static async rightClick(selector: string): Promise<void> {
        const element = await $(selector);
        await element.waitForClickable();
        await element.click({ button: 'right' });
    }

    /**
     * Drag and drop from source to target
     * @param sourceSelector - Source element selector
     * @param targetSelector - Target element selector
     */
    static async dragAndDrop(sourceSelector: string, targetSelector: string): Promise<void> {
        const sourceElement = await $(sourceSelector);
        const targetElement = await $(targetSelector);
        
        await sourceElement.waitForDisplayed();
        await targetElement.waitForDisplayed();
        
        await sourceElement.dragAndDrop(targetElement);
    }

    /**
     * Upload file to input element
     * @param selector - File input selector
     * @param filePath - Path to the file to upload
     */
    static async uploadFile(selector: string, filePath: string): Promise<void> {
        const fileInput = await $(selector);
        await fileInput.setValue(filePath);
    }

    /**
     * Get all options from a dropdown
     * @param selector - Dropdown selector
     * @returns Array of option texts
     */
    static async getDropdownOptions(selector: string): Promise<string[]> {
        const dropdown = await $(selector);
        await dropdown.waitForDisplayed();
        
        const options = await dropdown.$$('option');
        const optionTexts: string[] = [];
        
        for (const option of options) {
            const text = await option.getText();
            optionTexts.push(text);
        }
        
        return optionTexts;
    }

    /**
     * Check if checkbox is checked
     * @param selector - Checkbox selector
     * @returns True if checkbox is checked
     */
    static async isCheckboxChecked(selector: string): Promise<boolean> {
        const checkbox = await $(selector);
        await checkbox.waitForDisplayed();
        return await checkbox.isSelected();
    }

    /**
     * Set checkbox state
     * @param selector - Checkbox selector
     * @param checked - Desired state (true for checked, false for unchecked)
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
     * Scroll element into view
     * @param selector - Element selector
     */
    static async scrollIntoView(selector: string): Promise<void> {
        const element = await $(selector);
        await element.scrollIntoView();
    }

    /**
     * Wait for element to be stable (not moving)
     * @param selector - Element selector
     * @param timeout - Timeout in milliseconds
     */
    static async waitForElementStable(selector: string, timeout: number = 5000): Promise<void> {
        const element = await $(selector);
        await element.waitForDisplayed();
        
        let previousLocation = await element.getLocation();
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            await browser.pause(100);
            const currentLocation = await element.getLocation();
            
            if (previousLocation.x === currentLocation.x && previousLocation.y === currentLocation.y) {
                return;
            }
            
            previousLocation = currentLocation;
        }
        
        throw new Error(`Element '${selector}' did not stabilize within ${timeout}ms`);
    }
}

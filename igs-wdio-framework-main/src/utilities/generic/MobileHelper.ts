/**
 * Mobile Helper Utility
 * Provides mobile-specific interaction methods for Android and iOS testing
 */
export class MobileHelper {
    /**
     * Tap on element by coordinates
     * @param x - X coordinate
     * @param y - Y coordinate
     */
    static async tapByCoordinates(x: number, y: number): Promise<void> {
        await driver.touchAction({
            action: 'tap',
            x: x,
            y: y
        });
    }

    /**
     * Long press on element
     * @param selector - Element selector
     * @param duration - Duration of long press in milliseconds
     */
    static async longPress(selector: string, duration: number = 1000): Promise<void> {
        const element = await $(selector);
        await element.waitForDisplayed();
        
        const location = await element.getLocation();
        await driver.touchAction([
            { action: 'press', x: location.x, y: location.y },
            { action: 'wait', ms: duration },
            { action: 'release' }
        ]);
    }

    /**
     * Swipe from one element to another
     * @param fromSelector - Source element selector
     * @param toSelector - Target element selector
     */
    static async swipe(fromSelector: string, toSelector: string): Promise<void> {
        const fromElement = await $(fromSelector);
        const toElement = await $(toSelector);
        
        await fromElement.waitForDisplayed();
        await toElement.waitForDisplayed();
        
        const fromLocation = await fromElement.getLocation();
        const toLocation = await toElement.getLocation();
        
        await driver.touchAction([
            { action: 'press', x: fromLocation.x, y: fromLocation.y },
            { action: 'wait', ms: 100 },
            { action: 'moveTo', x: toLocation.x, y: toLocation.y },
            { action: 'release' }
        ]);
    }

    /**
     * Swipe in a specific direction
     * @param direction - Direction to swipe (up, down, left, right)
     * @param distance - Distance to swipe (0-1 as percentage of screen)
     */
    static async swipeDirection(direction: 'up' | 'down' | 'left' | 'right', distance: number = 0.5): Promise<void> {
        const windowSize = await driver.getWindowSize();
        const centerX = windowSize.width / 2;
        const centerY = windowSize.height / 2;
        
        let startX = centerX;
        let startY = centerY;
        let endX = centerX;
        let endY = centerY;
        
        switch (direction) {
            case 'up':
                startY = centerY + (windowSize.height * distance / 2);
                endY = centerY - (windowSize.height * distance / 2);
                break;
            case 'down':
                startY = centerY - (windowSize.height * distance / 2);
                endY = centerY + (windowSize.height * distance / 2);
                break;
            case 'left':
                startX = centerX + (windowSize.width * distance / 2);
                endX = centerX - (windowSize.width * distance / 2);
                break;
            case 'right':
                startX = centerX - (windowSize.width * distance / 2);
                endX = centerX + (windowSize.width * distance / 2);
                break;
        }
        
        await driver.touchAction([
            { action: 'press', x: startX, y: startY },
            { action: 'wait', ms: 100 },
            { action: 'moveTo', x: endX, y: endY },
            { action: 'release' }
        ]);
    }

    /**
     * Pinch to zoom
     * @param scale - Scale factor (< 1 for zoom out, > 1 for zoom in)
     */
    static async pinchZoom(scale: number): Promise<void> {
        const windowSize = await driver.getWindowSize();
        const centerX = windowSize.width / 2;
        const centerY = windowSize.height / 2;
        
        if (scale < 1) {
            // Zoom out - fingers move together
            const distance = Math.min(windowSize.width, windowSize.height) * (1 - scale) / 4;
            
            // Perform two separate touch actions for pinch
            await driver.touchAction([
                { action: 'press', x: centerX - distance, y: centerY },
                { action: 'wait', ms: 100 },
                { action: 'moveTo', x: centerX - distance * 2, y: centerY },
                { action: 'release' }
            ]);
            
            await driver.touchAction([
                { action: 'press', x: centerX + distance, y: centerY },
                { action: 'wait', ms: 100 },
                { action: 'moveTo', x: centerX + distance * 2, y: centerY },
                { action: 'release' }
            ]);
        } else {
            // Zoom in - fingers move apart
            const distance = Math.min(windowSize.width, windowSize.height) * (scale - 1) / 4;
            
            // Perform two separate touch actions for zoom
            await driver.touchAction([
                { action: 'press', x: centerX, y: centerY },
                { action: 'wait', ms: 100 },
                { action: 'moveTo', x: centerX - distance, y: centerY },
                { action: 'release' }
            ]);
            
            await driver.touchAction([
                { action: 'press', x: centerX, y: centerY },
                { action: 'wait', ms: 100 },
                { action: 'moveTo', x: centerX + distance, y: centerY },
                { action: 'release' }
            ]);
        }
    }

    /**
     * Hide keyboard (mobile specific)
     */
    static async hideKeyboard(): Promise<void> {
        try {
            await driver.hideKeyboard();
        } catch {
            // Keyboard might not be visible, ignore error
        }
    }

    /**
     * Get device orientation
     * @returns Current orientation
     */
    static async getOrientation(): Promise<string> {
        return await driver.getOrientation();
    }

    /**
     * Set device orientation
     * @param orientation - Desired orientation (PORTRAIT or LANDSCAPE)
     */
    static async setOrientation(orientation: 'PORTRAIT' | 'LANDSCAPE'): Promise<void> {
        await driver.setOrientation(orientation);
    }

    /**
     * Press device back button (Android)
     */
    static async pressBack(): Promise<void> {
        await driver.back();
    }

    /**
     * Press device home button
     */
    static async pressHome(): Promise<void> {
        await driver.pressKeyCode(3); // Android home key code
    }

    /**
     * Press device menu button (Android)
     */
    static async pressMenu(): Promise<void> {
        await driver.pressKeyCode(82); // Android menu key code
    }

    /**
     * Open notifications panel (Android)
     */
    static async openNotifications(): Promise<void> {
        await driver.openNotifications();
    }

    /**
     * Start activity (Android)
     * @param appPackage - App package name
     * @param appActivity - Activity name
     */
    static async startActivity(appPackage: string, appActivity: string): Promise<void> {
        await driver.startActivity(appPackage, appActivity);
    }

    /**
     * Get current activity (Android)
     * @returns Current activity name
     */
    static async getCurrentActivity(): Promise<string> {
        return await driver.getCurrentActivity();
    }

    /**
     * Get current package (Android)
     * @returns Current package name
     */
    static async getCurrentPackage(): Promise<string> {
        return await driver.getCurrentPackage();
    }

    /**
     * Install app from path
     * @param appPath - Path to the app file
     */
    static async installApp(appPath: string): Promise<void> {
        await driver.installApp(appPath);
    }

    /**
     * Remove app
     * @param appId - App package/bundle ID
     */
    static async removeApp(appId: string): Promise<void> {
        await driver.removeApp(appId);
    }

    /**
     * Check if app is installed
     * @param appId - App package/bundle ID
     * @returns True if app is installed
     */
    static async isAppInstalled(appId: string): Promise<boolean> {
        return await driver.isAppInstalled(appId);
    }

    /**
     * Launch app
     * @param appId - App package/bundle ID
     */
    static async launchApp(appId?: string): Promise<void> {
        if (appId) {
            await driver.activateApp(appId);
        } else {
            await driver.launchApp();
        }
    }

    /**
     * Close app
     * @param appId - App package/bundle ID
     */
    static async closeApp(appId?: string): Promise<void> {
        if (appId) {
            await driver.terminateApp(appId);
        } else {
            await driver.closeApp();
        }
    }

    /**
     * Reset app data
     */
    static async resetApp(): Promise<void> {
        // For WebDriverIO, use driver restart or app restart
        await driver.reloadSession();
    }

    /**
     * Get device time
     * @returns Device time
     */
    static async getDeviceTime(): Promise<string> {
        return await driver.getDeviceTime();
    }

    /**
     * Set clipboard text
     * @param text - Text to set in clipboard
     */
    static async setClipboard(text: string): Promise<void> {
        const base64Text = Buffer.from(text, 'utf8').toString('base64');
        await driver.setClipboard(base64Text, 'plaintext');
    }

    /**
     * Get clipboard text
     * @returns Clipboard text
     */
    static async getClipboard(): Promise<string> {
        const base64Text = await driver.getClipboard();
        return Buffer.from(base64Text, 'base64').toString('utf8');
    }

    /**
     * Toggle WiFi (Android)
     */
    static async toggleWiFi(): Promise<void> {
        await driver.toggleWiFi();
    }

    /**
     * Toggle mobile data (Android)
     */
    static async toggleData(): Promise<void> {
        await driver.toggleData();
    }

    /**
     * Toggle airplane mode
     */
    static async toggleAirplaneMode(): Promise<void> {
        await driver.toggleAirplaneMode();
    }

    /**
     * Shake device
     */
    static async shake(): Promise<void> {
        await driver.shake();
    }

    /**
     * Lock device
     * @param seconds - Duration to lock in seconds
     */
    static async lock(seconds?: number): Promise<void> {
        await driver.lock(seconds);
    }

    /**
     * Unlock device
     */
    static async unlock(): Promise<void> {
        await driver.unlock();
    }

    /**
     * Check if device is locked
     * @returns True if device is locked
     */
    static async isLocked(): Promise<boolean> {
        return await driver.isLocked();
    }

    /**
     * Scroll to element using mobile scroll
     * @param selector - Element selector to scroll to
     * @param direction - Scroll direction
     * @param maxSwipes - Maximum number of swipes
     */
    static async scrollToElement(
        selector: string, 
        direction: 'up' | 'down' = 'down',
        maxSwipes: number = 10
    ): Promise<void> {
        for (let i = 0; i < maxSwipes; i++) {
            const elements = await $$(selector);
            const length = await elements.length;
            
            if (length > 0) {
                const element = elements[0];
                const isDisplayed = await element.isDisplayed();
                if (isDisplayed) {
                    await element.scrollIntoView();
                    return;
                }
            }
            
            await this.swipeDirection(direction, 0.8);
            await driver.pause(500);
        }
        
        throw new Error(`Element '${selector}' not found after ${maxSwipes} swipes`);
    }
}

import { faker } from '@faker-js/faker';

/**
 * Test Data Generator Utility
 * Provides methods to generate test data using Faker.js
 */
export class DataGenerator {
    /**
     * Generate a random email
     * @returns Random email address
     */
    static generateEmail(): string {
        return faker.internet.email();
    }

    /**
     * Generate a random password
     * @param length - Password length
     * @returns Random password
     */
    static generatePassword(length: number = 8): string {
        return faker.internet.password({ length });
    }

    /**
     * Generate a random first name
     * @returns Random first name
     */
    static generateFirstName(): string {
        return faker.person.firstName();
    }

    /**
     * Generate a random last name
     * @returns Random last name
     */
    static generateLastName(): string {
        return faker.person.lastName();
    }

    /**
     * Generate a random full name
     * @returns Random full name
     */
    static generateFullName(): string {
        return faker.person.fullName();
    }

    /**
     * Generate a random phone number
     * @returns Random phone number
     */
    static generatePhoneNumber(): string {
        return faker.phone.number();
    }

    /**
     * Generate a random address
     * @returns Random address object
     */
    static generateAddress() {
        return {
            street: faker.location.streetAddress(),
            city: faker.location.city(),
            state: faker.location.state(),
            zipCode: faker.location.zipCode(),
            country: faker.location.country()
        };
    }

    /**
     * Generate a random company name
     * @returns Random company name
     */
    static generateCompanyName(): string {
        return faker.company.name();
    }

    /**
     * Generate a random date in the past
     * @param years - Years in the past
     * @returns Random past date
     */
    static generatePastDate(years: number = 1): Date {
        return faker.date.past({ years });
    }

    /**
     * Generate a random date in the future
     * @param years - Years in the future
     * @returns Random future date
     */
    static generateFutureDate(years: number = 1): Date {
        return faker.date.future({ years });
    }

    /**
     * Generate a random number between min and max
     * @param min - Minimum value
     * @param max - Maximum value
     * @returns Random number
     */
    static generateNumber(min: number = 1, max: number = 100): number {
        return faker.number.int({ min, max });
    }

    /**
     * Generate a random UUID
     * @returns Random UUID
     */
    static generateUUID(): string {
        return faker.string.uuid();
    }

    /**
     * Generate random text
     * @param sentenceCount - Number of sentences
     * @returns Random text
     */
    static generateText(sentenceCount: number = 3): string {
        return faker.lorem.sentences(sentenceCount);
    }

    /**
     * Generate a random credit card number
     * @returns Random credit card number
     */
    static generateCreditCardNumber(): string {
        return faker.finance.creditCardNumber();
    }

    /**
     * Generate random user data
     * @returns Random user object
     */
    static generateUser() {
        return {
            firstName: this.generateFirstName(),
            lastName: this.generateLastName(),
            email: this.generateEmail(),
            password: this.generatePassword(),
            phoneNumber: this.generatePhoneNumber(),
            address: this.generateAddress(),
            dateOfBirth: this.generatePastDate(50)
        };
    }
}
